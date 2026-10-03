# Changelog

本文件遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与
[语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [0.6.0] - 2026-10-03

### Changed

- **批量删除改成明确的入口 + 渐进出现**:侧栏「工作区」标题右边加了一行红色小字「批量删除」;
  点它才进入批量删除模式并出现行内勾选框;有勾选后那一行变成「已选 N 个 · 取消 · 确认删除」
  (`确认删除` 只在勾选之后出现)。点「确认删除」直接删除,点「取消」退出并清空选择。
- 去掉窗口底部的浮动操作条与二次确认弹窗(按钮本身就写着「确认删除」);
  勾选框不再 hover 常驻,只在该模式下出现。
- 侧栏收起(rail)时官方不渲染标题,入口随之隐藏。

## [0.5.0] - 2026-10-03

### Changed

- **批量删除的入口从设置页搬到侧栏会话列表**:每个会话行 hover 时多一个勾选框
  (官方 `sidebar.workspaces.session.row.action`,与归档/置顶同一排),勾选后窗口底部出现
  浮动条「已选 N 个 · 全选可删除的 · 清除选择 · 永久删除」。勾的就是列表里看得见的那些行,
  可以先用侧栏自己的搜索/分组缩小范围,不必再进设置面板。
- 移除 0.4.0 引入的 `settings.section` 设置页(同一份能力改由侧栏承载)。
- 删除失败的会话保留在选中集合里以便直接重试;成功的自动移除。

### Removed

- `settings.section` 注册项 `dsh-session-delete.bulk-delete` 与其页面组件。

## [0.4.0] - 2026-10-03

### Added

- host 新增 `GET /api/session-delete/sessions`:用官方 `sessionQuery.listSessions`
  列出会话,标题走官方批量折叠入口 `readTitleSnapshots`(`SessionHeader` 本身不带标题)。
- host 新增 `POST /api/session-delete/delete-many`:逐个执行删除管线(顺序执行,避免同时
  处置多个产物目录),逐条汇报 `{ sessionId, ok, mode | error }`;去重、单次上限 200 个。
- 单会话删除逻辑抽成 `purgeSession()`,单删与批删共用同一条管线,行为完全一致。
- 批量删除界面(0.5.0 起移到侧栏会话行多选,见上)。

## [0.3.2] - 2026-10-03

### Added

- `screenshots.json` + `assets/`:两张界面截图(会话行「…」菜单里的删除入口、永久删除确认弹窗),
  供插件市场详情页展示。截图放在本仓库,以后换图推这里即可,不用再提 PR。

## [0.3.1] - 2026-10-03

### Changed

- 确认弹窗去掉「若无特殊需求,请不要删除会话。」这一句;弹窗只保留「永久删除、无法恢复」
  的说明与危险色确认按钮。

### Removed

- 移除 `bodyHint` 文案键(zh/en),弹窗不再渲染第二行提示。

## [0.3.0] - 2026-09-30

### Added

- 新增 `POST /api/session-delete/sweep`:清理「日志已不存在、但工作区账本或内存 store
  里还留着 id」的失效行(幽灵行),只清无产物的行,有日志的会话一律保留。
- 删除成功后补发官方 `api-session/removed` 事件,冷会话(未加载进内存)也能让客户端
  列表行立即消失;`delete` 响应新增 `announced` 字段。
- 侧栏菜单、确认弹窗与提示文案接入 Client `locale` 服务(`zh`/`en` 两套字典),
  服务缺席时回退中文;新增 `locale/zh.json`、`locale/en.json` 与 `icon.svg` 清单元数据。
- 测试覆盖 surface 通知与幽灵行清理(25 项)。

### Fixed

- **删除后列表行残留、点开报 `session/not-found`**:此前只有活着的会话在
  `detachEntered` 时才会触发官方 `session/disposed → api-session/removed`,冷会话删除
  后没有任何通知,客户端保留一行空壳。现在删除路径无论冷热都补发该事件。

## [0.2.1] - 2026-09-30

### Changed

- 重试改为走官方客户端会话绑定
  (`sessions.using(id, …, ref => ref.binding.session.prompt(content, 'queue'))`),
  与输入框发送同一条路。

### Removed

- 移除 `POST /api/session-delete/retry`:host 直调 `@Remote` 的
  `sessionController.prompt` 会因缺少网关注入的 signal 抛
  `Cannot read properties of undefined (reading 'throwIfAborted')`。

## [0.2.0] - 2026-09-30

### Added

- 用户消息行与 AI 回复行的「重试」(复制按钮右侧)。AI 回复行用官方
  `conversation.chat.assistant-actions` 插槽;用户消息行官方无 action 插槽,
  按官方复制按钮的 class 注入。
- 只读路由 `GET /api/session-delete/retry-source` 解析「这条消息要重发什么」。

### Fixed

- 删除后会话仍出现在「未分组」:`session.list` 以 live 优先,内存里的 Session/Agent
  实例会让该行残留;现在按官方 `detachEntered` 路径摘除实例。

## [0.1.0] - 2026-09-30

### Added

- 侧栏会话行「…」菜单新增「删除此会话」(`sidebar.workspaces.session.menu.item`,order 900)。
- `GET /api/session-delete/status`、`POST /api/session-delete/delete`。
- 永久删除:会话日志目录、工作区归属、归档集合残留一并清理,运行中会话拒绝删除。
- 全软注入(不声明硬 `inject`),任一宿主服务缺失都不会阻塞 web boot。
