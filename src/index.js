// dsh-session-delete Host 半区:侧栏会话行「…」菜单的「删除此会话」后端 + 对话重试后端。
//
// 删除:官方持久层只有 create/open/stat/list,没有删除原语,所以按「产物处置 →
// 工作区解绑 → 摘掉宿主内存实例」执行;会话运行中(agent.status === 'running')一律拒绝。
// 重试:官方事件日志 append-only、没有「就地重生成」API,所以重试 = 把该消息对应的
// 用户输入经官方 sessionController.prompt 重新投递一次(旧回复保留,新回复追加)。
//
// 路由:
//   GET  /api/session-delete/status?sessionId=...              删除资格(菜单/确认框用)
//   POST /api/session-delete/delete {sessionId, confirm:true}   执行删除
//   GET  /api/session-delete/retry-source?sessionId&messageId   解析该消息要重发的文本(只读)
//
// 浏览器半区(src/client.js)在 sidebar.workspaces.session.menu.item 注册菜单行、
// 在 shell.overlay 注册确认弹窗、在 conversation.chat.assistant-actions 注册 AI 回复的
// 「重试」,并用 DOM 注入给用户消息行补同款按钮。

import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { stat, rm, realpath } from 'node:fs/promises'

import { moveToQuarantine, trashPath } from './trash.mjs'
import { resolveRetryText } from './retry.mjs'

export const name = 'dsh-session-delete'

// 空 inject:所有宿主服务都在 apply 内软注入,插件激活本身不需要任何服务,
// 因此任一服务缺失都不会让本条目 pending(不阻塞 web boot)。
export const inject = []

// 处置执行器出口:进程级唯一 OS 副作用注入点(永久删除 / 回收站 / 回收区搬移),
// 测试经此桩替;宿主也可整体替换。
export const executor = {
  purgePath: async (path) => {
    await rm(path, { recursive: true, force: true })
  },
  trashPath,
  moveToQuarantine,
}

/** 路由响应文案;导出供测试与实现同步。 */
export const MESSAGES = {
  unsupportedBackend: '当前存储后端不支持按会话删除',
  unknownSession: '会话不存在',
  running: '此会话正在运行,无法删除',
  missingArtifact: '产物已不存在,将只清理会话列表',
  badRequest: '请求缺少 sessionId',
  badJsonBody: '请求体不是合法 JSON',
  trashFailed: '删除失败(系统回收站与插件回收区均不可用)',
  purgedLocked: '删除失败(会话产物被占用,请先刷新页面或重启 DSH 后重试)',
  deleted: '已删除会话',
  ghostCleanup: '产物已不存在,已完成列表清理',
  detachFailed: '会话已删除,但解除工作区关联失败',
  inFlight: '该会话正在删除中,请稍后重试',
  systemError: '操作失败(系统级错误,详见服务端日志)',
  retryNoTarget: '找不到这条消息对应的可重发输入',
  retryNoText: '这条消息没有可重发的文本内容',
  missingConfirm: '缺少确认标记',
  bulkEmpty: '没有要删除的会话',
  bulkTooMany: '一次最多删除 200 个会话,请分批处理',
}

const NS = 'dsh-session-delete'
const ROUTE_STATUS = '/api/session-delete/status'
const ROUTE_DELETE = '/api/session-delete/delete'
const ROUTE_SWEEP = '/api/session-delete/sweep'
const ROUTE_RETRY_SOURCE = '/api/session-delete/retry-source'
const ROUTE_SESSIONS = '/api/session-delete/sessions'
const ROUTE_DELETE_MANY = '/api/session-delete/delete-many'
const BODY_LIMIT_BYTES = 64 * 1024
const DETACH_ATTEMPTS = 6
const DETACH_RETRY_MS = 150
const DETACH_TIMEOUT_MS = 10 * 1000
/** 会话清单默认/最大返回条数,以及单次批删上限。 */
const LIST_LIMIT_DEFAULT = 300
const LIST_LIMIT_MAX = 1000
const BULK_DELETE_MAX = 200

/** 同 id 并发删除集合:第二次进入直接拒绝,避免同产物两次处置。 */
const inFlight = new Set()

/** 聚合多工作区解绑错误为一条消息。 */
export function summarizeDetachErrors(errors) {
  return errors.map((error) => String((error && error.message) || error)).join('; ')
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(body)
}

// 业务错误(无 fs 错误码)原样透传中文文案;系统级错误(带 fs 错误码、
// message 内嵌绝对路径)收敛为固定文案并只落服务端日志。
function respondError(ctx, res, error) {
  const isSystem = Boolean(error && typeof error.code === 'string' && error.code !== '')
  if (isSystem && ctx.logger) ctx.logger.warn(`${NS} 系统级错误: ` + String((error && error.stack) || error))
  const message = isSystem
    ? MESSAGES.systemError
    : ((error && error.message) ? error.message : String(error))
  sendJson(res, 400, { error: message })
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let bytes = 0
    req.on('data', (chunk) => {
      bytes += chunk.length
      if (bytes > BODY_LIMIT_BYTES) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('error', reject)
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim()
      if (text === '') return resolve({})
      try {
        const parsed = JSON.parse(text)
        resolve(parsed && typeof parsed === 'object' ? parsed : {})
      } catch (error) {
        reject(new Error(MESSAGES.badJsonBody))
      }
    })
  })
}

/** 运行中判定:agent 注册表 status 为 running 即运行中,与官方归档抑制同款判据。 */
export function isSessionRunning(agents, sessionId) {
  const agent = agents && typeof agents.get === 'function' ? agents.get(sessionId) : undefined
  return Boolean(agent && agent.status === 'running')
}

/** 按 id 取会话头(存盘记录);不存在返回 undefined。 */
async function findHeader(ctx, sessionId) {
  const query = ctx.get('sessionQuery')
  if (!query || typeof query.listSessions !== 'function') return undefined
  const records = await query.listSessions()
  for (const record of records) {
    if (String(record.header.id) === sessionId) return record.header
  }
  return undefined
}

function samePath(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false
  return left.replace(/[\\/]+$/, '').toLowerCase() === right.replace(/[\\/]+$/, '').toLowerCase()
}

async function canonicalDirectory(path) {
  try {
    return await realpath(path)
  } catch {
    return undefined
  }
}

/**
 * 收集该会话关联的全部工作区句柄(账本 sessionIds 优先,cwd 回退),
 * 在 `attempt` 内物化一次列表。
 */
async function locateOwningWorkspaces(ctx, sessionId, header, attempt = 0) {
  const registry = ctx.get('workspaceRegistry')
  if (!registry || typeof registry.list !== 'function') return []
  const workspaces = registry.list()
  const accounted = workspaces.filter((workspace) => (workspace.sessionIds ?? []).map(String).includes(sessionId))
  if (accounted.length > 0) return accounted

  const cwd = header && header.cwd
  if (typeof cwd !== 'string' || cwd === '') return []
  const canonical = await canonicalDirectory(cwd)
  const target = canonical ?? cwd
  const matched = workspaces.filter((workspace) => samePath(workspace.path, target))
  if (matched.length > 0) return matched

  // 账本写队列可能滞后于刚创建的会话:重试物化,不命中即无关联(幂等)
  if (attempt >= DETACH_ATTEMPTS) return []
  await new Promise((resolve) => setTimeout(resolve, DETACH_RETRY_MS))
  return locateOwningWorkspaces(ctx, sessionId, header, attempt + 1)
}

async function withTimeout(promise, timeoutMs) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('解除工作区关联超时')), timeoutMs)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** 解绑:逐个工作区移除,不因首个失败中断;返回失败消息列表。 */
async function detachSession(ctx, sessionId, header) {
  let workspaces = []
  try {
    workspaces = await locateOwningWorkspaces(ctx, sessionId, header)
  } catch (error) {
    return [String((error && error.message) || error)]
  }
  const errors = []
  for (const workspace of workspaces) {
    try {
      await withTimeout(Promise.resolve(workspace.detachSession(sessionId)), DETACH_TIMEOUT_MS)
    } catch (error) {
      errors.push(error)
    }
  }
  return errors
}

/** 归档集合残留在删除后仅剩记录价值,清掉以免面板行以空壳复活。 */
async function removeArchivedId(ctx, sessionId) {
  const registry = ctx.get('workspaceRegistry')
  if (!registry) return
  const archived = registry.archivedSessionIds
  if (!Array.isArray(archived) || !archived.map(String).includes(sessionId)) return
  const storageDomain = ctx.get('storageDomain')
  const domain = storageDomain && typeof storageDomain.get === 'function' ? storageDomain.get('workspace') : undefined
  if (!domain || !domain.global) return
  const current = await domain.global.get()
  const next = (current.archivedSessionIds ?? []).filter((id) => String(id) !== sessionId)
  if (next.length === (current.archivedSessionIds ?? []).length) return
  await domain.global.set({ ...current, archivedSessionIds: next })
}

/**
 * 通知客户端"这个会话没了"。这是删除可见与否的关键一步。
 *
 * 官方契约(api-session-controller Host 半区):
 *   ctx.on('session/disposed', (session) => { ctx.emit('api-session/removed', session.id) })
 * 客户端 `ctx.remote.$on('api-session/removed', id)` → sessions.handleSessionRemoved(id)
 * → 立刻从列表移除该行。
 *
 * 只有**活着的**会话才会走 session/disposed;用 detachEntered 摘掉内存实例时官方会发它,
 * 但冷会话(没加载进内存)没有条目可摘 → 没有任何通知 → 客户端保留一行幽灵,
 * 点开就报 `session/not-found`。所以删除成功后**无论冷热**都要补发这条事件。
 *
 * @returns 是否成功发出(emit 不可用时静默降级为 false,行会残留到下次刷新)
 */
export function announceRemoval(ctx, sessionId) {
  try {
    if (!ctx || typeof ctx.emit !== 'function') return false
    ctx.emit('api-session/removed', sessionId)
    return true
  } catch {
    return false
  }
}

function artifactDirectoryOf(persistence, header) {
  if (!persistence || typeof persistence.locate !== 'function') return undefined
  const location = persistence.locate(header)
  if (!location || typeof location.path !== 'string' || location.path === '') return undefined
  return dirname(location.path)
}

/**
 * 面板上可能还有行的会话 id 全集:工作区账本(含归档集合)+ 宿主内存 store
 * (SessionStore / AgentRegistry 都持有公开的 `store` Map)。
 */
function collectRowCandidates(ctx) {
  const ids = new Set()
  const registry = ctx.get('workspaceRegistry')
  if (registry && typeof registry.list === 'function') {
    for (const workspace of registry.list()) {
      for (const id of workspace.sessionIds ?? []) ids.add(String(id))
    }
  }
  if (registry && Array.isArray(registry.archivedSessionIds)) {
    for (const id of registry.archivedSessionIds) ids.add(String(id))
  }
  for (const service of [ctx.get('sessions'), ctx.get('agents')]) {
    const store = service && service.store
    if (store instanceof Map) for (const key of store.keys()) ids.add(String(key))
  }
  return [...ids]
}

async function resolveDeleteTarget(ctx, sessionId) {
  if (isSessionRunning(ctx.get('agents'), sessionId)) return { error: MESSAGES.running }
  const header = await findHeader(ctx, sessionId)
  if (header === undefined) return { error: MESSAGES.unknownSession }
  const persistence = ctx.get('sessionPersistence')
  const artifactDir = artifactDirectoryOf(persistence, header)
  if (artifactDir === undefined) return { error: MESSAGES.unsupportedBackend }
  let artifactExists = false
  try {
    artifactExists = (await stat(artifactDir)).isDirectory()
  } catch (error) {
    if (!error || error.code !== 'ENOENT') throw error
  }
  // 产物缺失不再拒绝:这正是「已被删过、但宿主内存里还活着的幽灵行」的收尾路径
  return { header, artifactDir, artifactExists }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 单会话删除核心 —— 单删路由与批删路由共用这一条管线,保证两条入口行为完全一致。
 *
 * 顺序:定位产物 → 处置产物(purge / 系统回收站 / 回收区降级) → 摘宿主内存实例 →
 * 解绑工作区 → 清归档集合残留 → 补发官方 `api-session/removed`。
 *
 * @param ctx - 服务齐备的宿主上下文。
 * @param sessionId - 目标会话。
 * @param options - `{ quarantineDir, trashMode }`。
 * @returns 成功时的结果对象(mode / heldPath / disposed / detached / announced / message)。
 * @throws 业务错误(message 可直接回给客户端)或系统错误(带 code,按系统错误处理)。
 */
async function purgeSession(ctx, sessionId, options) {
  const { quarantineDir, trashMode } = options
  const target = await resolveDeleteTarget(ctx, sessionId)
  if (target.error !== undefined) throw new Error(target.error)
  const { header, artifactDir, artifactExists } = target

  // 产物处置:purge 直接永久删除;recycle 优先系统回收站,不可用时降级回收区。
  // 产物已被删过(幽灵行)时跳过处置,只做列表收尾。
  let mode = artifactExists ? undefined : 'ghost'
  let heldPath
  let disposed = { agent: false, session: false }
  if (artifactExists && trashMode === 'recycle') {
    mode = 'recycle'
    try {
      await executor.trashPath(artifactDir)
    } catch (trashError) {
      ctx.logger && ctx.logger.warn(`${NS} 系统回收站不可用(${sessionId}),尝试回收区降级: ` + String(trashError))
      try {
        heldPath = await executor.moveToQuarantine(artifactDir, quarantineDir)
        mode = 'quarantine'
      } catch (heldError) {
        throw new Error(`${MESSAGES.trashFailed}: ` + String((heldError && heldError.message) || heldError))
      }
    }
  } else if (artifactExists) {
    mode = 'purge'
    try {
      await executor.purgePath(artifactDir)
    } catch (purgeError) {
      // Windows 上会话日志可能仍被宿主进程的写句柄占用:先摘掉运行时实例
      // (agent/session)让它释放写入,再重试一次永久删除。
      ctx.logger && ctx.logger.warn(`${NS} 永久删除失败(${sessionId}),先摘运行时实例后重试: ` + String(purgeError))
      disposed = mergeDisposed(disposed, disposeLiveInstances(ctx, sessionId))
      await delay(300)
      try {
        await executor.purgePath(artifactDir)
      } catch (retryError) {
        ctx.logger && ctx.logger.warn(`${NS} 重试永久删除仍失败(${sessionId}): ` + String(retryError))
        try {
          heldPath = await executor.moveToQuarantine(artifactDir, quarantineDir)
          mode = 'quarantine'
        } catch (heldError) {
          ctx.logger && ctx.logger.warn(`${NS} 回收区降级亦失败(${sessionId}): ` + String(heldError))
          throw new Error(MESSAGES.purgedLocked)
        }
      }
    }
  }

  // 关键收尾:产物没了还不够——宿主 session.list 以 live 优先,内存里的
  // Session/Agent 实例会让该行继续以「未分组」残留。这里按官方自身的
  // detach 路径把它们摘掉(幂等),并触发 session/disposed → 客户端移除该行。
  disposed = mergeDisposed(disposed, disposeLiveInstances(ctx, sessionId))

  const detachErrors = await detachSession(ctx, sessionId, header)
  if (detachErrors.length > 0) {
    ctx.logger && ctx.logger.warn(`${NS} 解绑工作区失败(${sessionId}): ` + summarizeDetachErrors(detachErrors))
  }
  try {
    await removeArchivedId(ctx, sessionId)
  } catch (error) {
    ctx.logger && ctx.logger.warn(`${NS} 归档集合清理失败(${sessionId}): ` + String((error && error.stack) || error))
  }
  // 冷会话没有内存实例可摘,官方那条 session/disposed 不会发;这里补发
  // api-session/removed,客户端立刻掉行(否则会留一行点开就 not-found 的幽灵)。
  const announced = announceRemoval(ctx, sessionId)

  return {
    mode,
    ...(heldPath === undefined ? {} : { heldPath }),
    disposed,
    detached: detachErrors.length === 0,
    announced,
    ...(mode === 'ghost' ? { message: MESSAGES.ghostCleanup } : {}),
    ...(detachErrors.length === 0 ? {} : { message: MESSAGES.detachFailed }),
  }
}

/** 系统级错误(带 code)只回通用文案;业务错误原样回给客户端。 */
export function describeError(error) {
  const isSystem = Boolean(error && typeof error.code === 'string' && error.code !== '')
  if (isSystem) return MESSAGES.systemError
  return (error && error.message) ? String(error.message) : String(error)
}

/** 会话清单(批删选择器用):标题 / 时间 / 运行中 / 日志是否还在。 */
async function listSessionRows(ctx, limit) {
  const query = ctx.get('sessionQuery')
  if (!query || typeof query.listSessions !== 'function') throw new Error(MESSAGES.unknownSession)
  const records = await query.listSessions()
  const agents = ctx.get('agents')
  const persistence = ctx.get('sessionPersistence')
  const slice = records.slice(0, limit)

  // 标题是日志里 fold 出来的(SessionHeader 不带标题):官方提供批量折叠入口,一次读完。
  const titles = new Map()
  if (typeof query.readTitleSnapshots === 'function' && slice.length > 0) {
    try {
      const observations = await query.readTitleSnapshots(slice.map((record) => String(record.header.id)))
      for (const observation of observations) {
        if (observation && observation.status === 'fulfilled' && observation.value && observation.value.title) {
          titles.set(String(observation.sessionId), String(observation.value.title.title))
        }
      }
    } catch (error) {
      ctx.logger && ctx.logger.warn(`${NS} 读取会话标题失败(清单仍可用): ` + String((error && error.message) || error))
    }
  }

  const sessions = []
  for (const record of slice) {
    const sessionId = String(record.header.id)
    const running = isSessionRunning(agents, sessionId)
    const artifactDir = artifactDirectoryOf(persistence, record.header)
    let artifactExists = false
    if (artifactDir !== undefined) {
      try {
        artifactExists = (await stat(artifactDir)).isDirectory()
      } catch (error) {
        if (!error || error.code !== 'ENOENT') throw error
      }
    }
    sessions.push({
      sessionId,
      title: titles.get(sessionId) ?? '',
      createdAt: record.header.createdAt,
      cwd: record.header.cwd,
      live: record.live === true,
      persisted: record.persisted === true,
      running,
      artifactKnown: artifactDir !== undefined,
      artifactExists,
      deletable: !running,
      ...(running ? { reason: MESSAGES.running } : {}),
    })
  }
  return { total: records.length, returned: sessions.length, sessions }
}

/**
 * 摘掉宿主内存里的运行时实例(agent 先、session 后),让官方 session.list 不再
 * 以 live 优先返回该会话,并触发 session/disposed → api-session/removed,
 * 客户端列表行随即消失。
 *
 * 依据:SessionStore / AgentRegistry 都持有公开字段 `store`(Map)与
 * `detachEntered(entry)`(移除条目 + 发配对通知),官方自身的 detach 走的就是它;
 * 两者都是幂等的,官方后续自己的 teardown 再跑一次是 no-op。
 * 内部结构缺失时静默降级(返回 false),由调用方按「行会残留到重启」提示。
 *
 * @returns {{ agent: boolean, session: boolean }} 实际摘掉的实例
 */
export function disposeLiveInstances(ctx, sessionId) {
  const result = { agent: false, session: false }
  const dispose = (service) => {
    try {
      const store = service && service.store
      if (!(store instanceof Map) || typeof service.detachEntered !== 'function') return false
      const entry = store.get(sessionId)
      if (entry === undefined) return false
      service.detachEntered(entry)
      return true
    } catch {
      return false
    }
  }
  // agent 先摘:避免它继续对已删除的会话追加事件
  result.agent = dispose(ctx.get('agents'))
  result.session = dispose(ctx.get('sessions'))
  return result
}

function mergeDisposed(left, right) {
  return { agent: left.agent || right.agent, session: left.session || right.session }
}

/** 在服务齐备的 scoped 上下文里注册两条路由。 */
function installRoutes(ctx, options) {
  const { quarantineDir, trashMode } = options

  const requireMethod = (req, res, method) => {
    if (req.method === method) return true
    res.writeHead(405, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: `仅支持 ${method}` }))
    return false
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE_STATUS,
    handler: async (req, res) => {
      if (!requireMethod(req, res, 'GET')) return
      try {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const sessionId = url.searchParams.get('sessionId') ?? ''
        if (sessionId === '') {
          sendJson(res, 400, { error: MESSAGES.badRequest })
          return
        }
        const running = isSessionRunning(ctx.get('agents'), sessionId)
        const header = await findHeader(ctx, sessionId)
        if (header === undefined) {
          sendJson(res, 404, { error: MESSAGES.unknownSession })
          return
        }
        const persistence = ctx.get('sessionPersistence')
        const artifactDir = artifactDirectoryOf(persistence, header)
        let artifactExists = false
        if (artifactDir !== undefined) {
          try {
            artifactExists = (await stat(artifactDir)).isDirectory()
          } catch (error) {
            if (!error || error.code !== 'ENOENT') throw error
          }
        }
        sendJson(res, 200, {
          sessionId,
          running,
          artifactExists,
          // 产物缺失也允许删:那是「删过但宿主内存还活着」的幽灵行,需要收尾清理
          deletable: !running,
          reason: running ? MESSAGES.running
            : artifactDir === undefined ? MESSAGES.unsupportedBackend
              : artifactExists ? undefined : MESSAGES.missingArtifact,
        })
      } catch (error) {
        respondError(ctx, res, error)
      }
    },
  }), `${NS}: status route`)

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE_DELETE,
    handler: async (req, res) => {
      if (!requireMethod(req, res, 'POST')) return
      let sessionId
      try {
        const body = await readJsonBody(req)
        sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
        if (sessionId === '') {
          sendJson(res, 400, { error: MESSAGES.badRequest })
          return
        }
        // 显式确认:UI 确认框置位;缺失即拒绝,避免误触直接删数据
        if (body.confirm !== true) {
          sendJson(res, 400, { error: '缺少确认标记' })
          return
        }
      } catch (error) {
        respondError(ctx, res, error)
        return
      }

      if (inFlight.has(sessionId)) {
        sendJson(res, 409, { error: MESSAGES.inFlight })
        return
      }
      inFlight.add(sessionId)
      try {
        const result = await purgeSession(ctx, sessionId, { quarantineDir, trashMode })
        sendJson(res, 200, { ok: true, sessionId, ...result })
      } catch (error) {
        respondError(ctx, res, error)
      } finally {
        inFlight.delete(sessionId)
      }
    },
  }), `${NS}: delete route`)

  // ---- 会话清单(批量删除的选择器数据源)----
  //
  // 走官方 sessionQuery.listSessions(SessionHeader 本身不带标题,标题用官方批量折叠
  // 入口 readTitleSnapshots 取),再补齐「运行中 / 日志是否还在」两个删除相关的判定。
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE_SESSIONS,
    handler: async (req, res) => {
      if (!requireMethod(req, res, 'GET')) return
      try {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const requested = Number(url.searchParams.get('limit'))
        const limit = Number.isFinite(requested) && requested > 0
          ? Math.min(Math.trunc(requested), LIST_LIMIT_MAX)
          : LIST_LIMIT_DEFAULT
        sendJson(res, 200, await listSessionRows(ctx, limit))
      } catch (error) {
        respondError(ctx, res, error)
      }
    },
  }), `${NS}: sessions route`)

  // ---- 批量删除 ----
  //
  // 逐条走与单删完全相同的 purgeSession 管线(顺序执行,避免同时处置多个产物目录),
  // 逐条汇报结果:运行中的会话由核心拒绝并被记为失败项,其余照常删除。
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE_DELETE_MANY,
    handler: async (req, res) => {
      if (!requireMethod(req, res, 'POST')) return
      let ids
      try {
        const body = await readJsonBody(req)
        const raw = Array.isArray(body.sessionIds) ? body.sessionIds : []
        ids = [...new Set(raw.filter((id) => typeof id === 'string' && id !== ''))]
        if (ids.length === 0) {
          sendJson(res, 400, { error: MESSAGES.bulkEmpty })
          return
        }
        if (body.confirm !== true) {
          sendJson(res, 400, { error: MESSAGES.missingConfirm })
          return
        }
        if (ids.length > BULK_DELETE_MAX) {
          sendJson(res, 400, { error: MESSAGES.bulkTooMany })
          return
        }
      } catch (error) {
        respondError(ctx, res, error)
        return
      }

      const results = []
      for (const sessionId of ids) {
        if (inFlight.has(sessionId)) {
          results.push({ sessionId, ok: false, error: MESSAGES.inFlight })
          continue
        }
        inFlight.add(sessionId)
        try {
          const result = await purgeSession(ctx, sessionId, { quarantineDir, trashMode })
          results.push({ sessionId, ok: true, ...result })
        } catch (error) {
          if (error && typeof error.code === 'string' && error.code !== '') {
            ctx.logger && ctx.logger.warn(`${NS} 批量删除系统级错误(${sessionId}): ` + String((error && error.stack) || error))
          }
          results.push({ sessionId, ok: false, error: describeError(error) })
        } finally {
          inFlight.delete(sessionId)
        }
      }

      const deleted = results.filter((item) => item.ok === true).length
      sendJson(res, 200, {
        ok: results.every((item) => item.ok === true),
        total: results.length,
        deleted,
        failed: results.length - deleted,
        results,
      })
    },
  }), `${NS}: delete-many route`)

  // ---- 失效行清理(幽灵行) ----
  //
  // 只清「持久化里已经没有、但工作区账本/内存 store 里还留着 id」的行 —— 也就是
  // 历史遗留(删除时没发 api-session/removed)导致的、点开就 `session/not-found` 的空壳行。
  // 判定为幽灵的唯一条件就是**产物不存在**;任何日志还在的会话一律保留(kept),绝不误删。
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE_SWEEP,
    handler: async (req, res) => {
      if (!requireMethod(req, res, 'POST')) return
      try {
        const candidates = collectRowCandidates(ctx)
        const cleaned = []
        const kept = []
        for (const sessionId of candidates) {
          let target
          try {
            target = await resolveDeleteTarget(ctx, sessionId)
          } catch (error) {
            ctx.logger && ctx.logger.warn(`${NS} 清理探测失败(${sessionId}): ` + String((error && error.message) || error))
            kept.push(sessionId)
            continue
          }
          if (target !== undefined && target.error !== undefined) {
            // unknownSession = 持久化里查不到 → 幽灵;runing / 不支持的持久化后端 → 保守保留
            if (target.error !== MESSAGES.unknownSession) {
              kept.push(sessionId)
              continue
            }
          } else if (target !== undefined && target.artifactExists) {
            kept.push(sessionId)
            continue
          }
          const disposed = disposeLiveInstances(ctx, sessionId)
          const detachErrors = await detachSession(ctx, sessionId, target && target.header)
          if (detachErrors.length > 0) {
            ctx.logger && ctx.logger.warn(`${NS} 清理解绑失败(${sessionId}): ` + summarizeDetachErrors(detachErrors))
          }
          try {
            await removeArchivedId(ctx, sessionId)
          } catch (error) {
            ctx.logger && ctx.logger.warn(`${NS} 清理归档集合失败(${sessionId}): ` + String((error && error.message) || error))
          }
          const announced = announceRemoval(ctx, sessionId)
          cleaned.push({ sessionId, announced, disposed, detached: detachErrors.length === 0 })
        }
        sendJson(res, 200, { ok: true, scanned: candidates.length, cleaned, kept })
      } catch (error) {
        respondError(ctx, res, error)
      }
    },
  }), `${NS}: sweep route`)

  // ---- 对话重试 ----

  const loadEvents = async (sessionId) => {
    const query = ctx.get('sessionQuery')
    if (!query || typeof query.readSession !== 'function') throw new Error(MESSAGES.retryNoTarget)
    const snapshot = await query.readSession(sessionId)
    return snapshot && Array.isArray(snapshot.events) ? snapshot.events : []
  }

  // 解析「这条消息要重发什么」:AI 回复 → 其前最近一条用户输入;用户消息 → 它自己。
  // 只读:host 不投递 prompt(见下方注释)。
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE_RETRY_SOURCE,
    handler: async (req, res) => {
      if (!requireMethod(req, res, 'GET')) return
      try {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const sessionId = url.searchParams.get('sessionId') ?? ''
        const messageId = url.searchParams.get('messageId') ?? ''
        if (sessionId === '' || messageId === '') {
          sendJson(res, 400, { error: MESSAGES.badRequest })
          return
        }
        const resolved = resolveRetryText(await loadEvents(sessionId), messageId)
        if (resolved === undefined) {
          sendJson(res, 404, { error: MESSAGES.retryNoTarget })
          return
        }
        if (resolved.text === '') {
          sendJson(res, 400, { error: MESSAGES.retryNoText })
          return
        }
        sendJson(res, 200, { ...resolved, mode: 'queue' })
      } catch (error) {
        respondError(ctx, res, error)
      }
    },
  }), `${NS}: retry-source route`)

  // 注意:重试的「投递」不在 host 侧做。sessionController.prompt 是 @Remote 方法,
  // 它要求网关注入的 signal(cancellation: { parameter: 'signal' }),插件直接调用会抛
  // `Cannot read properties of undefined (reading 'throwIfAborted')`。官方正确姿势是客户端
  // 会话绑定:`sessions.using(id, …, ref => ref.binding.session.prompt(content, 'queue'))`
  // —— 与输入框发送同一条路。host 只负责从会话日志里解析出要重发的文本(只读)。
}

export function apply(ctx, config) {
  const settings = config && typeof config === 'object' ? config : {}
  const quarantineDir = (typeof settings.quarantineDir === 'string' && settings.quarantineDir !== '')
    ? settings.quarantineDir
    : join(homedir(), '.dsh', 'trash', 'session-delete')
  // 处置模式:purge = 直接永久删除(默认);recycle = 优先系统回收站,失败降级回收区
  const trashMode = settings.trashMode === 'recycle' ? 'recycle' : 'purge'

  // 软注入:任一服务缺失都只是不注册路由,绝不把本条目变成 pending 而拖垮 web boot
  ctx.inject(['webServer', 'sessionQuery', 'workspaceRegistry', 'agents'], (scoped) => {
    installRoutes(scoped, { quarantineDir, trashMode })
  })
}
