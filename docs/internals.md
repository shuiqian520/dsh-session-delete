# 实现说明(官方契约与设计依据)

这份文档记录插件依赖的 **DSH 官方契约**、为什么这么做,以及升级 DSH 时该看哪里。
每一项都标注了依据来源(官方包/文件),便于日后核对。

## 文件结构

```
dsh-session-delete/
├─ package.json          清单:dsh.bundle.patch + dsh.client(platform/immediately/inject)+ icon
├─ cordis.patch.yml      组合补丁:- insert: id: session-delete
├─ icon.svg              插件管理器卡片图标
├─ locale/zh.json        清单元数据(meta.title / meta.description)
├─ locale/en.json
├─ src/index.js          Host 半区:四条路由 + 删除/清理的执行逻辑
├─ src/client.js         Client 半区:菜单项、确认弹窗+轻提示、两个「重试」入口、locale 字典
├─ src/retry.mjs         纯函数:从会话事件里解析「这条消息要重发的文本」
├─ src/trash.mjs         回收站/回收区执行器(可被测试替换)
├─ test/smoke.mjs        25 项测试(真实临时目录 + 桩)
└─ docs/internals.md     本文件
```

## Host 半区

### 软注入,绝不硬注入

```js
export const inject = []                       // 激活本身不需要任何服务
export function apply(ctx, config) {
  ctx.inject(['webServer', 'sessionQuery', 'workspaceRegistry', 'agents'], (scoped) => {
    installRoutes(scoped, { quarantineDir, trashMode })
  })
}
```

Cordis 语义:**硬 `inject` 未满足 = 条目停在 `pending`**。若本插件把 `webServer` 写进硬
`inject`,而某个 DSH 版本改名/移除该服务,`web boot` 会因「1 entry did not activate」直接
失败(DSH 随后还会 `sanitizeProfile` 回滚 profile)。软注入把这个失败面收敛成
「功能不可用」而不是「应用起不来」。

### 删除的四个动作 + 一条通知

| # | 动作 | 官方依据 |
|---|------|----------|
| 1 | 删日志目录 | `sessionPersistence.locate(header)` → `.path` 的父目录即产物目录 |
| 2 | 摘内存实例 | `SessionStore` / `AgentRegistry` 的公开 `store`(Map)+ `detachEntered(entry)` |
| 3 | 解绑工作区 | `workspaceRegistry.list()` → 每个 workspace 句柄的 `detachSession(id)` |
| 4 | 清归档残留 | workspace 域(`storageDomain.get('workspace').global`)里的 `archivedSessionIds` |
| 5 | 发通知 | `ctx.emit('api-session/removed', sessionId)` |

**第 5 步是"列表行会不会消失"的关键。** 官方自己的实现是:

```js
// @deepseek-ai/dsh-api-session-controller(Host)
ctx.on('session/disposed', (session) => { ctx.emit('api-session/removed', session.id); });

// @deepseek-ai/dsh-api-session-controller(Client)
ctx.remote.$on('api-session/removed', (sessionId) => { sessions.handleSessionRemoved(sessionId); });
```

`detachEntered` 会触发 `session/disposed`,但**只有内存里活着的会话才有条目可摘**。
冷会话(从未在本进程激活,或已被卸载)删除产物后没有任何通知,客户端就会保留一行空壳:
点开报 `session/not-found`。因此删除路径**无论冷热**都补发 `api-session/removed`。

> 只补发 `api-session/removed`(客户端契约),**故意不**伪造 `session/disposed`——
> 后者还有持久化、投影、遥测等宿主监听者,拿一个假会话对象去触发它们可能写回文件。

### 为什么 sweep 只清"无产物"的行

```js
target.error === MESSAGES.unknownSession   // 持久化里查不到 → 幽灵,清理
target.error === MESSAGES.unsupportedBackend // 无法判定产物 → 保留
target.artifactExists === true             // 日志还在 → 保留(kept)
```

候选集来自「工作区账本(含归档集合)+ 内存 store」,判定依据只有一条:
**产物目录不存在**。所以 sweep 在结构上不可能删掉一个有日志的会话。

### 重试为什么没有 Host 路由

`sessionController.prompt` 是 `@Remote` 方法,typert 定义里带
`cancellation: { parameter: 'signal' }`,网关注入 signal 后才可调用;插件在 host 直调会抛
`Cannot read properties of undefined (reading 'throwIfAborted')`(实测复现)。正确的投递面是
客户端会话绑定,与输入框发送同一条路。所以 host 只保留**只读**的 `retry-source`。

## Client 半区

### 扩展点

| 插槽 | 用途 | 备注 |
|------|------|------|
| `sidebar.workspaces.session.menu.item` | 「删除此会话」菜单行 | order 900,排在官方归档(400)之后 |
| `shell.overlay` | 确认弹窗 + 顶部轻提示 | 弹窗用 `Modal` + `Button` |
| `conversation.chat.assistant-actions` | AI 回复的「重试」 | order 20,位于复制按钮右侧 |

用户消息行**官方没有 action 插槽**,因此按官方复制按钮的 class 注入 DOM(选择器用「哈希前缀
+ 语义类名」子串,版本升级后仍能命中;跳过 `data-submission-echo` 与 `data-pending-steering`
两种非正式消息行)。插件停用时按钮与样式一并移除。
这是本插件唯一"贴着官方 DOM"的地方,升级 DSH 后如果按钮消失,先看这里。

### 文案与语言

```js
const locale = ctx.get('locale');                    // 可选依赖:get 后必须判空
ctx.effect(() => { /* locale.register(NS, 'zh'|'en', dict) → 返回 disposer */ });
const t = createTranslator(locale);                  // locale.bind(NS),调用时读当前语言
```

- 语言切换后已渲染内容的更新:`useSyncExternalStore(locale.subscribe, locale.getSnapshot)`
  (官方说明该快照带 `revision`、引用稳定,是 uSES-safe 的)。
- 字典缺失、注册冲突、服务缺席、`bind` 抛错,四类情况一律回退中文硬编码字典。

## 升级 DSH 后的自检清单

1. 侧栏会话行「…」里还有「删除此会话」→ `sidebar.workspaces.session.menu.item` 与
   `MenuItemButton` 仍兼容;
2. 两条消息的复制按钮右侧还有刷新图标 → `conversation.chat.assistant-actions` 仍在,
   且用户消息行的 `[class*="userRow"]` / `[class*="actions"]` / `[class*="bubble"]`
   class 语义名未变;
3. 删一个测试会话 → 行当场消失;若行残留,检查 `api-session/removed` 这条客户端事件是否改名;
4. 用 `cordis_inspect_query`(Client `Slots.listSubTree`)确认三个条目的 id 仍在:
   `dsh-session-delete.delete-session` / `.overlay` / `.retry-assistant`。

## 本地验证脚本(不在仓库内)

开发时用过一组本机脚本(自动重启 DSH、按官方 RPC 线格式直呼 Remote、探测路由),
它们含绝对路径与一次性 GUI 令牌,所以放在 `tools/` 并由 `.gitignore` 排除。要点:

- 官方 Remote 的 HTTP 线格式:`POST /api/<namespace>/<method>`,
  body `{ type:'client-request', rpcId, method:'<namespace>/<method>', payload:{ args:{…} } }`,
  返回 `{ rpcId, result: { ok, value | error } }`;
- 鉴权:先 `GET /?token=<启动令牌>` 换一次浏览器会话 cookie,之后同进程复用它;
- `session/page` 的 `throughSeq` 必须给真实游标(传 `-1` 得到空页)。
