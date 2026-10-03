// 本地测试:host 路由与删除流程(真实临时目录 + 注入桩),client 半区加载面。
// 用法:node --test test/

import { readFileSync } from 'node:fs'
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import test from 'node:test'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const host = await import(pathToFileURL(join(root, 'src', 'index.js')).href)
const retry = await import(pathToFileURL(join(root, 'src', 'retry.mjs')).href)

function makeReq(method, url) {
  const listeners = {}
  return {
    method,
    url,
    on(event, fn) {
      listeners[event] = listeners[event] ?? []
      listeners[event].push(fn)
    },
    destroy() {},
    emitBody(text) {
      for (const fn of listeners.data ?? []) fn(Buffer.from(text))
      for (const fn of listeners.end ?? []) fn()
    },
  }
}

function makeRes() {
  const res = { status: 0, body: '' }
  res.writeHead = (status) => {
    res.status = status
  }
  res.end = (chunk) => {
    res.body = chunk ?? ''
  }
  return res
}

/**
 * 在临时根目录下搭一座最小宿主:产物目录、工作区账本、会话头。
 * @returns 路由、桩记录与清理函数。
 */
async function bootstrap({ config = {}, headers = {}, running = [], detachThrows = [], events = [], withController = true, ghostIds = [], titles = {} } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-session-delete-'))
  const artifactDirOf = (id) => join(dir, id)
  for (const id of Object.keys(headers)) {
    await mkdir(artifactDirOf(id), { recursive: true })
    await writeFile(join(artifactDirOf(id), 'session.jsonl.zstd'), 'log')
  }
  const calls = { purged: [], trashed: [], quarantined: [], detached: [], disposedAgents: [], disposedSessions: [], prompts: [], emitted: [] }
  const eventState = { events }
  const originalPurge = host.executor.purgePath
  const originalTrash = host.executor.trashPath
  const originalMove = host.executor.moveToQuarantine
  host.executor.purgePath = async (path) => {
    calls.purged.push(path)
    await rm(path, { recursive: true, force: true })
  }
  host.executor.trashPath = async (path) => {
    calls.trashed.push(path)
    await rm(path, { recursive: true, force: true })
  }
  host.executor.moveToQuarantine = async (path) => {
    calls.quarantined.push(path)
    await rm(path, { recursive: true, force: true })
    return `${path}.held`
  }

  const routes = []
  const workspaces = [{
    id: 'ws-1',
    path: join(dir, 'ws'),
    sessionIds: [...Object.keys(headers), ...ghostIds],
    detachSession: async (id) => {
      if (detachThrows.includes(id)) throw new Error('detach failed')
      calls.detached.push(id)
    },
  }]
  // 宿主内存实例:store(Map) + detachEntered(entry) —— 与官方 SessionStore/AgentRegistry 同形
  const liveSessions = new Map()
  const liveAgents = new Map()
  const sessions = {
    store: liveSessions,
    detachEntered: (entry) => {
      if (liveSessions.get(entry.id) !== entry) return
      liveSessions.delete(entry.id)
      calls.disposedSessions.push(entry.id)
    },
  }
  const agents = {
    store: liveAgents,
    get: (id) => (running.includes(id) ? { id, status: 'running' } : { id, status: 'idle' }),
    detachEntered: (entry) => {
      if (liveAgents.get(entry.id) !== entry) return
      liveAgents.delete(entry.id)
      calls.disposedAgents.push(entry.id)
    },
  }
  const ctx = {
    logger: { warn() {} },
    effect: (fn) => {
      fn()
      return () => {}
    },
    // 官方客户端行的移除靠这条事件传播:session/disposed → api-session/removed
    emit: (event, payload) => {
      calls.emitted.push({ event, payload })
    },
    // 软注入:插件用 ctx.inject([...], cb) 注册路由;测试直接立即回调同一上下文
    inject: (_services, callback) => {
      callback(ctx)
      return () => {}
    },
    webServer: { register: (route) => { routes.push(route); return () => {} } },
    get(name) {
      if (name === 'agents') return agents
      if (name === 'sessions') return sessions
      if (name === 'sessionQuery') {
        return {
          listSessions: async () => Object.entries(headers).map(([id, header]) => ({ header: { id, ...header }, live: false, persisted: true })),
          readSession: async () => ({ session: { id: 'session-2' }, inheritedEventCount: 0, events: eventState.events }),
          // 官方批量标题折叠入口:标题来自日志(SessionHeader 本身不带标题)
          readTitleSnapshots: async (ids) => ids.map((sessionId) => ({
            sessionId,
            status: 'fulfilled',
            value: {
              session: { id: sessionId },
              title: titles[sessionId] === undefined
                ? undefined
                : { title: titles[sessionId], eventSeq: 1, updatedAt: 1, messageSeqs: [], source: { kind: 'user' } },
            },
          })),
        }
      }
      if (name === 'workspaceRegistry') return { list: () => workspaces, archivedSessionIds: [] }
      if (name === 'sessionPersistence') return { locate: (header) => ({ path: join(artifactDirOf(header.id), 'session.jsonl.zstd') }) }
      if (name === 'sessionController') {
        if (!withController) return undefined
        return {
          prompt: async (request) => {
            calls.prompts.push(request)
            return { accepted: true }
          },
        }
      }
      return undefined
    },
  }

  host.apply(ctx, { quarantineDir: join(dir, 'quarantine'), ...config })
  const statusRoute = routes.find((route) => route.path === '/api/session-delete/status')
  const deleteRoute = routes.find((route) => route.path === '/api/session-delete/delete')
  const sweepRoute = routes.find((route) => route.path === '/api/session-delete/sweep')
  const sessionsRoute = routes.find((route) => route.path === '/api/session-delete/sessions')
  const deleteManyRoute = routes.find((route) => route.path === '/api/session-delete/delete-many')
  const retrySourceRoute = routes.find((route) => route.path === '/api/session-delete/retry-source')
  const retryRoute = routes.find((route) => route.path === '/api/session-delete/retry')
  return {
    dir,
    calls,
    statusRoute,
    deleteRoute,
    sweepRoute,
    sessionsRoute,
    deleteManyRoute,
    retrySourceRoute,
    retryRoute,
    artifactDirOf,
    headers,
    setEvents: (next) => {
      eventState.events = next
    },
    /** 造一个"宿主内存里还活着"的会话/agent 实例 */
    makeLive(sessionId) {
      const sessionEntry = { id: sessionId }
      const agentEntry = { id: sessionId, agent: { id: sessionId } }
      liveSessions.set(sessionId, sessionEntry)
      liveAgents.set(sessionId, agentEntry)
      return { sessionEntry, agentEntry }
    },
    isLive: (sessionId) => liveSessions.has(sessionId) || liveAgents.has(sessionId),
    async dispose() {
      host.executor.purgePath = originalPurge
      host.executor.trashPath = originalTrash
      host.executor.moveToQuarantine = originalMove
      await rm(dir, { recursive: true, force: true })
    },
  }
}

const HEADERS = {
  'session-1': { createdAt: 1, cwd: 'C:\\ws', isSeeded: false },
  'session-2': { createdAt: 1, cwd: 'C:\\ws', isSeeded: false },
}

test('导出面:name/inject/apply/executor', () => {
  assert.equal(host.name, 'dsh-session-delete')
  // 空 inject:宿主服务全部软注入,本条目永不因服务缺失而 pending
  assert.deepEqual(host.inject, [])
  assert.equal(typeof host.apply, 'function')
  assert.equal(typeof host.executor.trashPath, 'function')
  assert.equal(typeof host.executor.moveToQuarantine, 'function')
})

test('软注入:服务缺失时 apply 不抛错且不注册路由', () => {
  const bare = {
    logger: { warn() {} },
    effect: (fn) => {
      fn()
      return () => {}
    },
    inject: (_services, callback) => {
      // 模拟服务永不就绪:ctx.inject 的回调不被调用
      void callback
      return () => {}
    },
  }
  assert.doesNotThrow(() => host.apply(bare, {}))
})

test('软注入:服务齐备时注册六条路由', () => {
  const routes = []
  const ctx = {
    logger: { warn() {} },
    effect: (fn) => {
      fn()
      return () => {}
    },
    inject: (_services, callback) => {
      callback(ctx)
      return () => {}
    },
    webServer: { register: (route) => { routes.push(route); return () => {} } },
    get: () => undefined,
  }
  host.apply(ctx, {})
  assert.deepEqual(routes.map((route) => route.path).sort(), [
    '/api/session-delete/delete',
    '/api/session-delete/delete-many',
    '/api/session-delete/retry-source',
    '/api/session-delete/sessions',
    '/api/session-delete/status',
    '/api/session-delete/sweep',
  ])
})

test('重试目标解析:AI 回复取它之前的用户输入,用户消息取它自己', () => {
  const { resolveRetryText, messageText, normalizeMode } = retry
  const events = [
    { type: 'user/message', data: { message: { id: 'u1', content: [{ type: 'text', text: '第一个问题' }] } } },
    { type: 'assistant/message', data: { message: { id: 'a1', content: [{ type: 'text', text: '第一个回答' }] } } },
    { type: 'user/message', data: { message: { id: 'u2', content: [{ type: 'text', text: '第二个问题' }, { type: 'image', attachment: {} }] } } },
    { type: 'assistant/message', data: { message: { id: 'a2', content: [{ type: 'text', text: '第二个回答' }] } } },
  ]
  assert.deepEqual(resolveRetryText(events, 'a2'), { role: 'assistant', text: '第二个问题', userMessageId: 'u2' })
  assert.deepEqual(resolveRetryText(events, 'u2'), { role: 'user', text: '第二个问题', userMessageId: 'u2' })
  assert.deepEqual(resolveRetryText(events, 'a1'), { role: 'assistant', text: '第一个问题', userMessageId: 'u1' })
  assert.equal(resolveRetryText(events, 'nope'), undefined)
  assert.equal(resolveRetryText([{ type: 'assistant/message', data: { message: { id: 'a9', content: [] } } }], 'a9'), undefined)
  assert.equal(messageText({ content: [{ type: 'text', text: ' a ' }, { type: 'text', text: 'b' }] }), 'a \nb')
  assert.equal(normalizeMode('steer'), 'steer')
  assert.equal(normalizeMode(undefined), 'queue')
})

test('retry-source 路由:按 messageId 解析 / 缺参 / 找不到', async () => {
  const h = await bootstrap({
    headers: HEADERS,
    events: [
      { type: 'user/message', data: { message: { id: 'u1', content: [{ type: 'text', text: '帮我看看这个 bug' }] } } },
      { type: 'assistant/message', data: { message: { id: 'a1', content: [{ type: 'text', text: '好的' }] } } },
    ],
  })
  try {
    {
      const res = makeRes()
      await h.retrySourceRoute.handler(makeReq('GET', '/api/session-delete/retry-source?sessionId=session-2&messageId=a1'), res)
      assert.equal(res.status, 200, res.body)
      assert.deepEqual(JSON.parse(res.body), { role: 'assistant', text: '帮我看看这个 bug', userMessageId: 'u1', mode: 'queue' })
    }
    {
      const res = makeRes()
      await h.retrySourceRoute.handler(makeReq('GET', '/api/session-delete/retry-source?sessionId=session-2'), res)
      assert.equal(res.status, 400)
    }
    {
      const res = makeRes()
      await h.retrySourceRoute.handler(makeReq('GET', '/api/session-delete/retry-source?sessionId=session-2&messageId=zzz'), res)
      assert.equal(res.status, 404)
    }
  } finally {
    await h.dispose()
  }
})

test('retry-source 路由:AI 回复解析出前一条用户输入并附 queue 模式', async () => {
  const h = await bootstrap({
    headers: HEADERS,
    events: [
      { type: 'user/message', data: { message: { id: 'u1', content: [{ type: 'text', text: '再讲一遍' }] } } },
      { type: 'assistant/message', data: { message: { id: 'a1', content: [{ type: 'text', text: '好的' }] } } },
    ],
  })
  try {
    const res = makeRes()
    await h.retrySourceRoute.handler(makeReq('GET', '/api/session-delete/retry-source?sessionId=session-2&messageId=a1'), res)
    assert.equal(res.status, 200, res.body)
    assert.deepEqual(JSON.parse(res.body), {
      role: 'assistant',
      text: '再讲一遍',
      userMessageId: 'u1',
      mode: 'queue',
    })
  } finally {
    await h.dispose()
  }
})

test('host 不注册投递路由(投递在客户端会话绑定里做)', async () => {
  const h = await bootstrap({ headers: HEADERS })
  try {
    // 之前的 POST /api/session-delete/retry 已移除:@Remote 方法需要网关注入的 signal,
    // 插件直调会抛 throwIfAborted,所以投递改走客户端 sessions.using(...).prompt(...)
    assert.equal(h.retryRoute, undefined)
  } finally {
    await h.dispose()
  }
})

test('运行中判定:仅 status === running 为运行中', () => {
  const agents = { get: (id) => ({ 'a': { status: 'running' }, 'b': { status: 'idle' } }[id]) }
  assert.equal(host.isSessionRunning(agents, 'a'), true)
  assert.equal(host.isSessionRunning(agents, 'b'), false)
  assert.equal(host.isSessionRunning(agents, 'missing'), false)
  assert.equal(host.isSessionRunning(undefined, 'a'), false)
})

test('status 路由:运行中 / 可删 / 缺参 / 未知会话', async () => {
  const h = await bootstrap({ headers: HEADERS, running: ['session-1'] })
  try {
    {
      const res = makeRes()
      await h.statusRoute.handler(makeReq('GET', '/api/session-delete/status?sessionId=session-1'), res)
      assert.equal(res.status, 200)
      assert.deepEqual(JSON.parse(res.body).deletable, false)
      assert.equal(JSON.parse(res.body).running, true)
    }
    {
      const res = makeRes()
      await h.statusRoute.handler(makeReq('GET', '/api/session-delete/status?sessionId=session-2'), res)
      assert.equal(res.status, 200)
      assert.equal(JSON.parse(res.body).deletable, true)
      assert.equal(JSON.parse(res.body).artifactExists, true)
    }
    {
      const res = makeRes()
      await h.statusRoute.handler(makeReq('GET', '/api/session-delete/status'), res)
      assert.equal(res.status, 400)
    }
    {
      const res = makeRes()
      await h.statusRoute.handler(makeReq('GET', '/api/session-delete/status?sessionId=session-9'), res)
      assert.equal(res.status, 404)
    }
  } finally {
    await h.dispose()
  }
})

test('delete 路由:方法闸与确认标记', async () => {
  const h = await bootstrap({ headers: HEADERS })
  try {
    {
      const res = makeRes()
      await h.deleteRoute.handler(makeReq('GET', '/api/session-delete/delete'), res)
      assert.equal(res.status, 405)
    }
    {
      const req = makeReq('POST', '/api/session-delete/delete')
      const res = makeRes()
      const pending = h.deleteRoute.handler(req, res)
      req.emitBody(JSON.stringify({ sessionId: 'session-2' }))
      await pending
      assert.equal(res.status, 400)
      assert.match(JSON.parse(res.body).error, /确认/)
    }
    {
      const req = makeReq('POST', '/api/session-delete/delete')
      const res = makeRes()
      const pending = h.deleteRoute.handler(req, res)
      req.emitBody('{')
      await pending
      assert.equal(res.status, 400)
    }
  } finally {
    await h.dispose()
  }
})

test('delete 路由:purge 物理删除产物并解绑工作区', async () => {
  const h = await bootstrap({ headers: HEADERS })
  try {
    const req = makeReq('POST', '/api/session-delete/delete')
    const res = makeRes()
    const pending = h.deleteRoute.handler(req, res)
    req.emitBody(JSON.stringify({ sessionId: 'session-2', confirm: true }))
    await pending
    const payload = JSON.parse(res.body)
    assert.equal(res.status, 200, res.body)
    assert.equal(payload.ok, true)
    assert.equal(payload.mode, 'purge')
    assert.equal(payload.detached, true)
    // 产物目录真的没了
    await assert.rejects(readdir(h.artifactDirOf('session-2')))
    // 另一个会话的产物没被误删
    assert.deepEqual(await readdir(h.artifactDirOf('session-1')), ['session.jsonl.zstd'])
    assert.deepEqual(h.calls.detached, ['session-2'])
    assert.deepEqual(h.calls.trashed, [])
    assert.deepEqual(h.calls.purged, [h.artifactDirOf('session-2')])
    // 必须补发官方那条通知,否则冷会话(没有内存实例可摘)会在面板留下点开即 not-found 的幽灵行
    assert.deepEqual(h.calls.emitted, [{ event: 'api-session/removed', payload: 'session-2' }])
    assert.equal(payload.announced, true)
  } finally {
    await h.dispose()
  }
})

test('announceRemoval:emit 缺失时静默降级(不抛错)', () => {
  assert.equal(host.announceRemoval(undefined, 'session-1'), false)
  assert.equal(host.announceRemoval({}, 'session-1'), false)
  const seen = []
  assert.equal(host.announceRemoval({ emit: (event, payload) => seen.push([event, payload]) }, 'session-9'), true)
  assert.deepEqual(seen, [['api-session/removed', 'session-9']])
  assert.equal(host.announceRemoval({ emit: () => { throw new Error('boom') } }, 'session-9'), false)
})

test('sweep 路由:只清产物已不在的幽灵行,真实会话一律保留', async () => {
  // session-1 / session-2 有产物;ghost-a / ghost-b 只在工作区账本里(产物已被删掉)
  const h = await bootstrap({ headers: HEADERS, ghostIds: ['ghost-a', 'ghost-b'] })
  try {
    h.makeLive('ghost-a')
    const req = makeReq('POST', '/api/session-delete/sweep')
    const res = makeRes()
    const pending = h.sweepRoute.handler(req, res)
    req.emitBody('{}')
    await pending
    const payload = JSON.parse(res.body)
    assert.equal(res.status, 200, res.body)
    assert.equal(payload.ok, true)
    assert.equal(payload.scanned, 4)
    assert.deepEqual(payload.cleaned.map((item) => item.sessionId).sort(), ['ghost-a', 'ghost-b'])
    assert.deepEqual(payload.kept.sort(), ['session-1', 'session-2'])
    // 真实会话的产物没被动过
    assert.deepEqual(await readdir(h.artifactDirOf('session-1')), ['session.jsonl.zstd'])
    assert.deepEqual(await readdir(h.artifactDirOf('session-2')), ['session.jsonl.zstd'])
    // 幽灵行拿到了官方移除通知,并被解绑
    assert.deepEqual(h.calls.emitted.map((item) => item.payload).sort(), ['ghost-a', 'ghost-b'])
    assert.deepEqual(h.calls.detached.sort(), ['ghost-a', 'ghost-b'])
    // 活着的幽灵实例被摘掉(官方 detach 路径)
    assert.equal(h.isLive('ghost-a'), false)
  } finally {
    await h.dispose()
  }
})

test('sweep 路由:方法闸 + 空账本时零操作', async () => {
  const h = await bootstrap({ headers: HEADERS })
  try {
    {
      const res = makeRes()
      await h.sweepRoute.handler(makeReq('GET', '/api/session-delete/sweep'), res)
      assert.equal(res.status, 405)
    }
    const req = makeReq('POST', '/api/session-delete/sweep')
    const res = makeRes()
    const pending = h.sweepRoute.handler(req, res)
    req.emitBody('{}')
    await pending
    const payload = JSON.parse(res.body)
    assert.deepEqual(payload.cleaned, [])
    assert.deepEqual(payload.kept.sort(), ['session-1', 'session-2'])
    assert.deepEqual(h.calls.emitted, [])
  } finally {
    await h.dispose()
  }
})

test('delete 路由:摘掉宿主内存实例,列表行不再以未分组残留', async () => {
  const h = await bootstrap({ headers: HEADERS })
  try {
    // 模拟官方激活:该会话同时活在 SessionStore 与 AgentRegistry 里
    h.makeLive('session-2')
    assert.equal(h.isLive('session-2'), true)

    const req = makeReq('POST', '/api/session-delete/delete')
    const res = makeRes()
    const pending = h.deleteRoute.handler(req, res)
    req.emitBody(JSON.stringify({ sessionId: 'session-2', confirm: true }))
    await pending
    const payload = JSON.parse(res.body)
    assert.equal(res.status, 200, res.body)
    assert.deepEqual(payload.disposed, { agent: true, session: true })
    // 两个 store 都不再持有该 id → 官方 session.list 不再返回它
    assert.equal(h.isLive('session-2'), false)
    assert.deepEqual(h.calls.disposedAgents, ['session-2'])
    assert.deepEqual(h.calls.disposedSessions, ['session-2'])
    // 其他会话不受影响
    h.makeLive('session-1')
    assert.equal(h.isLive('session-1'), true)
    assert.equal(h.isLive('session-2'), false)
  } finally {
    await h.dispose()
  }
})

test('delete 路由:产物已缺失时走幽灵清理(仅摘实例+解绑)', async () => {
  const h = await bootstrap({ headers: HEADERS })
  try {
    // 模拟"已经被删过、只剩内存实例"的幽灵行
    await rm(h.artifactDirOf('session-2'), { recursive: true, force: true })
    h.makeLive('session-2')

    const req = makeReq('POST', '/api/session-delete/delete')
    const res = makeRes()
    const pending = h.deleteRoute.handler(req, res)
    req.emitBody(JSON.stringify({ sessionId: 'session-2', confirm: true }))
    await pending
    const payload = JSON.parse(res.body)
    assert.equal(res.status, 200, res.body)
    assert.equal(payload.mode, 'ghost')
    assert.match(payload.message, /列表清理|不存在/)
    assert.equal(h.isLive('session-2'), false)
    assert.deepEqual(h.calls.detached, ['session-2'])
    assert.deepEqual(h.calls.purged, [])
  } finally {
    await h.dispose()
  }
})

test('status 路由:产物缺失也允许删除(幽灵行收尾)', async () => {
  const h = await bootstrap({ headers: HEADERS })
  try {
    await rm(h.artifactDirOf('session-2'), { recursive: true, force: true })
    const res = makeRes()
    await h.statusRoute.handler(makeReq('GET', '/api/session-delete/status?sessionId=session-2'), res)
    const payload = JSON.parse(res.body)
    assert.equal(res.status, 200, res.body)
    assert.equal(payload.artifactExists, false)
    assert.equal(payload.deletable, true)
    assert.match(payload.reason, /列表清理|不存在/)
  } finally {
    await h.dispose()
  }
})

test('delete 路由:产物被占用时先摘实例再重试永久删除', async () => {
  const h = await bootstrap({ headers: HEADERS })
  try {
    h.makeLive('session-2')
    const order = []
    const originalPurge = host.executor.purgePath
    let attempt = 0
    host.executor.purgePath = async (path) => {
      attempt += 1
      order.push(`purge#${attempt}`)
      if (attempt === 1) throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' })
      return originalPurge(path)
    }
    const sessionDetach = h.calls.disposedSessions
    const req = makeReq('POST', '/api/session-delete/delete')
    const res = makeRes()
    const pending = h.deleteRoute.handler(req, res)
    req.emitBody(JSON.stringify({ sessionId: 'session-2', confirm: true }))
    await pending
    const payload = JSON.parse(res.body)
    assert.equal(res.status, 200, res.body)
    assert.equal(payload.mode, 'purge')
    assert.deepEqual(order, ['purge#1', 'purge#2'])
    // 重试发生在摘实例之后
    assert.deepEqual(sessionDetach, ['session-2'])
    await assert.rejects(readdir(h.artifactDirOf('session-2')))
  } finally {
    await h.dispose()
  }
})

test('delete 路由:运行中会话被拒且无副作用', async () => {
  const h = await bootstrap({ headers: HEADERS, running: ['session-2'] })
  try {
    const req = makeReq('POST', '/api/session-delete/delete')
    const res = makeRes()
    const pending = h.deleteRoute.handler(req, res)
    req.emitBody(JSON.stringify({ sessionId: 'session-2', confirm: true }))
    await pending
    assert.equal(res.status, 400)
    assert.match(JSON.parse(res.body).error, /运行/)
    assert.deepEqual(await readdir(h.artifactDirOf('session-2')), ['session.jsonl.zstd'])
    assert.deepEqual(h.calls.detached, [])
  } finally {
    await h.dispose()
  }
})

test('delete 路由:解绑失败仍视为删除成功并附提示', async () => {
  const h = await bootstrap({ headers: HEADERS, detachThrows: ['session-2'] })
  try {
    const req = makeReq('POST', '/api/session-delete/delete')
    const res = makeRes()
    const pending = h.deleteRoute.handler(req, res)
    req.emitBody(JSON.stringify({ sessionId: 'session-2', confirm: true }))
    await pending
    const payload = JSON.parse(res.body)
    assert.equal(res.status, 200, res.body)
    assert.equal(payload.detached, false)
    assert.match(payload.message, /解绑|关联/)
    await assert.rejects(readdir(h.artifactDirOf('session-2')))
  } finally {
    await h.dispose()
  }
})

test('delete 路由:recycle 模式走系统回收站', async () => {
  const h = await bootstrap({ headers: HEADERS, config: { trashMode: 'recycle' } })
  try {
    const req = makeReq('POST', '/api/session-delete/delete')
    const res = makeRes()
    const pending = h.deleteRoute.handler(req, res)
    req.emitBody(JSON.stringify({ sessionId: 'session-2', confirm: true }))
    await pending
    const payload = JSON.parse(res.body)
    assert.equal(res.status, 200, res.body)
    assert.equal(payload.mode, 'recycle')
    assert.deepEqual(h.calls.trashed, [h.artifactDirOf('session-2')])
  } finally {
    await h.dispose()
  }
})

test('delete 路由:回收站与回收区都失败则拒绝且产物保留', async () => {
  const h = await bootstrap({ headers: HEADERS, config: { trashMode: 'recycle' } })
  try {
    host.executor.trashPath = async () => {
      throw new Error('no gio')
    }
    host.executor.moveToQuarantine = async () => {
      throw new Error('no quarantine')
    }
    const req = makeReq('POST', '/api/session-delete/delete')
    const res = makeRes()
    const pending = h.deleteRoute.handler(req, res)
    req.emitBody(JSON.stringify({ sessionId: 'session-2', confirm: true }))
    await pending
    assert.equal(res.status, 400)
    assert.match(JSON.parse(res.body).error, /失败/)
    assert.deepEqual(await readdir(h.artifactDirOf('session-2')), ['session.jsonl.zstd'])
  } finally {
    await h.dispose()
  }
})

test('delete 路由:同 id 并发第二次被拒', async () => {
  const h = await bootstrap({ headers: HEADERS })
  try {
    // 首个请求在解析请求体后、完成删除前,第二个请求进入:inFlight 判据应拦住它
    const req1 = makeReq('POST', '/api/session-delete/delete')
    const res1 = makeRes()
    const pending1 = h.deleteRoute.handler(req1, res1)
    req1.emitBody(JSON.stringify({ sessionId: 'session-2', confirm: true }))
    const req2 = makeReq('POST', '/api/session-delete/delete')
    const res2 = makeRes()
    const pending2 = h.deleteRoute.handler(req2, res2)
    req2.emitBody(JSON.stringify({ sessionId: 'session-2', confirm: true }))
    await Promise.all([pending1, pending2])
    assert.equal(res1.status, 200)
    assert.equal(res2.status, 409)
    assert.match(JSON.parse(res2.body).error, /删除中/)
    assert.deepEqual(h.calls.detached, ['session-2'])
  } finally {
    await h.dispose()
  }
})

test('client 半区:加载面、三个注册项与用户消息按钮挂载', async () => {
  const source = readFileSync(join(root, 'src', 'client.js'), 'utf8')
  let loaded = null

  // 最小 DOM 桩:证明 apply() 在没有真实 DOM 的环境里也能安全挂载/卸载
  const created = []
  const styles = []
  const appendChild = (node) => styles.push(node)
  globalThis.document = {
    head: { appendChild },
    body: {},
    createElement: () => {
      const node = {
        style: { cssText: '' },
        className: '',
        innerHTML: '',
        textContent: '',
        disabled: false,
        title: '',
        type: '',
        parentElement: null,
        attributes: {},
        children: [],
        setAttribute(name, value) {
          node.attributes[name] = value
        },
        addEventListener() {},
        append(...nodesToAppend) {
          node.children.push(...nodesToAppend)
        },
        remove() {},
        after() {},
      }
      created.push(node)
      return node
    },
    querySelector: () => null,
    querySelectorAll: () => [],
  }
  globalThis.MutationObserver = class {
    observe() {}
    disconnect() {}
  }
  globalThis.window = {
    __ModuleLoader__: { load: (definition) => { loaded = definition } },
    setTimeout: () => 0,
    clearTimeout: () => {},
  }

  const modules = {
    react: {
      createElement: () => null,
      Fragment: Symbol('Fragment'),
      useState: () => [undefined, () => {}],
      useEffect: () => {},
      useRef: () => ({ current: undefined }),
      useCallback: (fn) => fn,
      useSyncExternalStore: () => undefined,
    },
    '@deepseek-ai/dsh-client-ui-primitives': {
      Button: () => null,
      Modal: () => null,
      MenuItemButton: () => null,
      IconTrashOutlineRegular: () => null,
    },
  }
  await import(`data:text/javascript,${encodeURIComponent(source)}`)
  assert.notEqual(loaded, null)
  assert.equal(loaded.id, 'dsh-session-delete')
  const clientExports = loaded.factory((id) => {
    const found = modules[id]
    if (found === undefined) throw new Error(`unexpected require(${id})`)
    return found
  })
  assert.equal(typeof clientExports.apply, 'function')
  assert.deepEqual(clientExports.inject, ['slots'])

  const injections = []
  const effects = []
  const sent = []
  const usingCalls = []
  const sessionsStub = {
    refresh: () => Promise.resolve(),
    list: { getSnapshot: () => ({ byId: { 'session-2': { id: 'session-2', retainedBy: { mainView: 1 } } } }) },
    // 官方客户端会话绑定:与输入框发送同一条
    using: async (id, options, operation) => {
      usingCalls.push({ id, options })
      return operation({
        binding: {
          session: {
            prompt: async (content, mode) => {
              sent.push({ id, content, mode })
              return { ok: true, value: { accepted: true } }
            },
          },
        },
      })
    },
  }
  const clientCtx = {
    get: (name) => (name === 'sessions' ? sessionsStub : undefined),
    effect: (fn) => {
      effects.push(fn)
      const disposer = fn()
      return () => {
        if (typeof disposer === 'function') disposer()
      }
    },
    slots: {
      inject: (key, callback) => {
        injections.push({ key, callback })
        return () => {}
      },
      register: (options, component) => ({ options, component }),
    },
  }
  // retryByMessageId 会先打 host 只读路由解析文本;批量删除页打清单/批删两条路由
  const deleteManyCalls = []
  const respond = (payload, ok = true, status = 200) => ({ ok, status, json: async () => payload })
  globalThis.fetch = async (url, init) => {
    const target = String(url)
    if (target.includes('/api/session-delete/sessions')) {
      return respond({ total: 1, returned: 1, sessions: [{ sessionId: 'session-2', title: '标题', deletable: true }] })
    }
    if (target.includes('/api/session-delete/delete-many')) {
      deleteManyCalls.push(JSON.parse(init.body))
      return respond({ ok: true, total: 2, deleted: 2, failed: 0, results: [] })
    }
    return respond({ role: 'assistant', text: '帮我看看这个 bug', mode: 'queue', url: target })
  }
  clientExports.apply(clientCtx)
  assert.deepEqual(injections.map((entry) => entry.key), [
    'sidebar.workspaces.session.menu.item',
    'shell.overlay',
    'conversation.chat.assistant-actions',
    'sidebar.workspaces.session.row.action',
  ])
  const registrations = injections.map((entry) => entry.callback())
  assert.deepEqual(registrations.map((entry) => entry.options.id), [
    'dsh-session-delete.delete-session',
    'dsh-session-delete.overlay',
    'dsh-session-delete.retry-assistant',
    'dsh-session-delete.select-row',
  ])
  assert.equal(registrations[0].options.order, 900)
  // 「重试」排在官方反馈(10)之后,位于复制按钮右侧的同一条 action 行
  assert.equal(registrations[2].options.order, 20)
  // 侧栏多选:排在官方归档(100)/置顶(200)之后,同一排 hover 按钮
  assert.equal(registrations[3].options.order, 300)
  for (const registration of registrations) assert.equal(typeof registration.component, 'function')
  const injected = registrations[0].options.inject()
  assert.equal(typeof injected.actions.ask, 'function')
  assert.equal(typeof injected.actions.settle, 'function')
  assert.equal(typeof injected.actions.notify, 'function')
  assert.equal(typeof injected.actions.toggleSelect, 'function')
  assert.equal(typeof injected.actions.clearSelection, 'function')
  assert.equal(typeof injected.actions.enterBulk, 'function')
  assert.equal(typeof injected.actions.exitBulk, 'function')
  assert.equal(typeof injected.useDeleteStore, 'function')
  assert.equal(typeof injected.retryByText, 'function')
  assert.equal(typeof injected.retryByMessageId, 'function')
  assert.equal(typeof injected.deleteMany, 'function')

  // 用户消息行重试:文本走客户端会话绑定投递(和输入框发送同一条路)
  await injected.retryByText('session-2', '  帮我看看这个 bug  ')
  assert.equal(usingCalls.length, 1)
  assert.equal(usingCalls[0].id, 'session-2')
  assert.equal(usingCalls[0].options.source, 'workspaceOperation')
  assert.deepEqual(sent[0], {
    id: 'session-2',
    content: [{ type: 'text', text: '帮我看看这个 bug' }],
    mode: 'queue',
  })

  // AI 回复行重试:先经 host 只读路由解析出前一条用户输入,再同样投递
  await injected.retryByMessageId('session-2', 'a1')
  assert.equal(sent.length, 2)
  assert.deepEqual(sent[1].content, [{ type: 'text', text: '帮我看看这个 bug' }])
  assert.equal(sent[1].mode, 'queue')

  // 空文本不投递
  await assert.rejects(() => injected.retryByText('session-2', '   '), /没有可重发/)
  assert.equal(sent.length, 2)

  // 批量删除:提交时带 confirm 标记,空选择直接拒绝(不打请求)
  const outcome = await injected.deleteMany(['session-2', 'session-3'])
  assert.equal(outcome.deleted, 2)
  assert.deepEqual(deleteManyCalls[0], { sessionIds: ['session-2', 'session-3'], confirm: true })
  await assert.rejects(() => injected.deleteMany([]), /没有选中/)

  // 三个挂载 effect:批量删除样式 + 用户消息按钮注入 + 「工作区」标题旁的批量删除入口
  assert.equal(effects.length, 3)
  assert.equal(styles.length, 2)
  assert.match(styles.map((node) => node.textContent).join(''), /dsh-session-delete-select-button/)
  assert.equal(created.length > 0, true)
})

test('client 半区:可见文案注册进 locale 服务,服务缺席回退 zh', async () => {
  const source = readFileSync(join(root, 'src', 'client.js'), 'utf8')
  let loaded = null
  globalThis.document = {
    head: { appendChild: () => {} },
    body: {},
    createElement: () => ({
      style: { cssText: '' }, className: '', innerHTML: '', textContent: '', attributes: {}, children: [],
      disabled: false, title: '', type: '', parentElement: null,
      setAttribute() {}, addEventListener() {}, append() {}, remove() {}, after() {},
    }),
    querySelector: () => null,
    querySelectorAll: () => [],
  }
  globalThis.MutationObserver = class {
    observe() {}
    disconnect() {}
  }
  globalThis.window = {
    __ModuleLoader__: { load: (definition) => { loaded = definition } },
    setTimeout: () => 0,
    clearTimeout: () => {},
  }
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ text: 'hi' }) })
  const modules = {
    react: {
      createElement: () => null,
      Fragment: Symbol('Fragment'),
      useState: () => [undefined, () => {}],
      useEffect: () => {},
      useCallback: (fn) => fn,
      useSyncExternalStore: () => undefined,
    },
    '@deepseek-ai/dsh-client-ui-primitives': {
      Button: () => null,
      Modal: () => null,
      MenuItemButton: () => null,
      IconTrashOutlineRegular: () => null,
    },
  }
  // data: URL 会被模块缓存,加个 fragment 强制重新执行(重新触发 __ModuleLoader__.load)
  await import(`data:text/javascript,${encodeURIComponent(source)}#locale-case`)
  const clientExports = loaded.factory((id) => modules[id])

  const makeCtx = (locale) => {
    const injections = []
    const ctx = {
      get: (name) => {
        if (name === 'locale') return locale
        return undefined
      },
      effect: (fn) => {
        const disposer = fn()
        return () => {
          if (typeof disposer === 'function') disposer()
        }
      },
      slots: {
        inject: (key, callback) => {
          injections.push({ key, callback })
          return () => {}
        },
        register: (options, component) => ({ options, component }),
      },
    }
    clientExports.apply(ctx)
    const registrations = injections.map((entry) => entry.callback())
    return registrations[0].options.inject()
  }

  // 1) 服务缺席:回退 zh 字典(与改造前的硬编码行为一致)
  const fallbackFace = makeCtx(undefined)
  await assert.rejects(() => fallbackFace.retryByText('s', '   '), /没有可重发的文本内容/)

  // 2) 服务在位:注册 zh/en 两套字典,并按当前语言取词
  const dicts = {}
  let active = 'en'
  const registered = []
  const localeStub = {
    register: (ns, id, dict) => {
      registered.push({ ns, id })
      dicts[id] = dict
      return () => {}
    },
    bind: () => (key) => (dicts[active] ?? {})[key],
    subscribe: () => () => {},
    getSnapshot: () => ({ active, revision: registered.length }),
  }
  const englishFace = makeCtx(localeStub)
  assert.deepEqual(registered.map((entry) => entry.id).sort(), ['en', 'zh'])
  assert.equal(registered.every((entry) => entry.ns === 'dsh-session-delete'), true)
  assert.equal(typeof dicts.en.deleteSession, 'string')
  assert.equal(typeof dicts.zh.deleteSession, 'string')
  await assert.rejects(() => englishFace.retryByText('s', '   '), /no text to resend/)

  // 3) 切回 zh:同一个翻译函数按当前语言取词(引用稳定,读取在调用时)
  active = 'zh'
  await assert.rejects(() => englishFace.retryByText('s', '   '), /没有可重发的文本内容/)
})

test('sessions 路由:清单含标题 / 运行中 / 日志缺失标记,并按 limit 截断', async () => {
  const h = await bootstrap({
    headers: HEADERS,
    running: ['session-1'],
    titles: { 'session-1': '第一个会话', 'session-2': '第二个会话' },
  })
  try {
    // session-2 的产物先删掉:它是「日志已不存在」的幽灵行
    await rm(h.artifactDirOf('session-2'), { recursive: true, force: true })

    const res = makeRes()
    await h.sessionsRoute.handler(makeReq('GET', '/api/session-delete/sessions'), res)
    const payload = JSON.parse(res.body)
    assert.equal(res.status, 200, res.body)
    assert.equal(payload.total, 2)
    assert.equal(payload.returned, 2)
    const byId = Object.fromEntries(payload.sessions.map((row) => [row.sessionId, row]))
    assert.equal(byId['session-1'].title, '第一个会话')
    assert.equal(byId['session-1'].running, true)
    assert.equal(byId['session-1'].deletable, false)
    assert.match(byId['session-1'].reason, /正在运行/)
    assert.equal(byId['session-2'].title, '第二个会话')
    assert.equal(byId['session-2'].running, false)
    assert.equal(byId['session-2'].artifactExists, false)
    assert.equal(byId['session-2'].deletable, true)
    assert.equal(byId['session-2'].reason, undefined)
    assert.equal(typeof byId['session-1'].createdAt, 'number')

    {
      const limited = makeRes()
      await h.sessionsRoute.handler(makeReq('GET', '/api/session-delete/sessions?limit=1'), limited)
      const page = JSON.parse(limited.body)
      assert.equal(page.total, 2)
      assert.equal(page.returned, 1)
    }
    {
      const wrongMethod = makeRes()
      await h.sessionsRoute.handler(makeReq('POST', '/api/session-delete/sessions'), wrongMethod)
      assert.equal(wrongMethod.status, 405)
    }
  } finally {
    await h.dispose()
  }
})

test('delete-many 路由:空列表 / 缺确认标记 / 超上限都被拒', async () => {
  const h = await bootstrap({ headers: HEADERS })
  try {
    const cases = [
      [{ sessionIds: [], confirm: true }, /没有要删除/],
      [{ sessionIds: ['session-2'] }, /确认/],
      [{ sessionIds: Array.from({ length: 201 }, (_, index) => `s-${index}`), confirm: true }, /最多/],
    ]
    for (const [body, pattern] of cases) {
      const req = makeReq('POST', '/api/session-delete/delete-many')
      const res = makeRes()
      const pending = h.deleteManyRoute.handler(req, res)
      req.emitBody(JSON.stringify(body))
      await pending
      assert.equal(res.status, 400, res.body)
      assert.match(JSON.parse(res.body).error, pattern)
    }
    assert.deepEqual(h.calls.purged, [])
  } finally {
    await h.dispose()
  }
})

test('delete-many 路由:逐个删除 + 去重 + 幽灵行走列表清理', async () => {
  const h = await bootstrap({
    headers: {
      'session-1': { createdAt: 1, cwd: 'C:\\ws', isSeeded: false },
      'session-2': { createdAt: 2, cwd: 'C:\\ws', isSeeded: false },
      'session-3': { createdAt: 3, cwd: 'C:\\ws', isSeeded: false },
    },
  })
  try {
    // session-3 的产物先删掉 → 走 ghost 分支;session-2 正常 purge
    await rm(h.artifactDirOf('session-3'), { recursive: true, force: true })

    const req = makeReq('POST', '/api/session-delete/delete-many')
    const res = makeRes()
    const pending = h.deleteManyRoute.handler(req, res)
    // 故意重复一个 id:应被去重
    req.emitBody(JSON.stringify({ sessionIds: ['session-2', 'session-3', 'session-2'], confirm: true }))
    await pending
    const payload = JSON.parse(res.body)
    assert.equal(res.status, 200, res.body)
    assert.equal(payload.ok, true)
    assert.equal(payload.total, 2)
    assert.equal(payload.deleted, 2)
    assert.equal(payload.failed, 0)

    const byId = Object.fromEntries(payload.results.map((item) => [item.sessionId, item]))
    assert.equal(byId['session-2'].mode, 'purge')
    assert.equal(byId['session-3'].mode, 'ghost')
    assert.equal(byId['session-3'].message !== undefined, true)

    // 产物真的没了;工作区解绑;官方移除通知逐个发出
    await assert.rejects(readdir(h.artifactDirOf('session-2')))
    assert.deepEqual(h.calls.purged, [h.artifactDirOf('session-2')])
    assert.deepEqual(h.calls.detached.sort(), ['session-2', 'session-3'])
    assert.deepEqual(h.calls.emitted.map((item) => item.payload).sort(), ['session-2', 'session-3'])
    assert.equal(h.calls.emitted.every((item) => item.event === 'api-session/removed'), true)
  } finally {
    await h.dispose()
  }
})

test('delete-many 路由:运行中的会话被拒并记为失败项,其余照常删除', async () => {
  const h = await bootstrap({
    headers: {
      'session-1': { createdAt: 1, cwd: 'C:\\ws', isSeeded: false },
      'session-2': { createdAt: 2, cwd: 'C:\\ws', isSeeded: false },
    },
    running: ['session-1'],
  })
  try {
    const req = makeReq('POST', '/api/session-delete/delete-many')
    const res = makeRes()
    const pending = h.deleteManyRoute.handler(req, res)
    req.emitBody(JSON.stringify({ sessionIds: ['session-1', 'session-2'], confirm: true }))
    await pending
    const payload = JSON.parse(res.body)
    assert.equal(res.status, 200, res.body)
    assert.equal(payload.ok, false)
    assert.equal(payload.total, 2)
    assert.equal(payload.deleted, 1)
    assert.equal(payload.failed, 1)
    const byId = Object.fromEntries(payload.results.map((item) => [item.sessionId, item]))
    assert.equal(byId['session-1'].ok, false)
    assert.match(byId['session-1'].error, /正在运行/)
    assert.equal(byId['session-2'].ok, true)
    // 运行中的那个连产物都不该动
    assert.deepEqual(await readdir(h.artifactDirOf('session-1')), ['session.jsonl.zstd'])
    await assert.rejects(readdir(h.artifactDirOf('session-2')))
  } finally {
    await h.dispose()
  }
})
