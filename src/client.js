// dsh-session-delete —— 浏览器半区(client 插件)
//
// 1) 在侧栏会话行的「…」菜单(sidebar.workspaces.session.menu.item)追加一行
//    「删除此会话」,order 900 落在官方归档(400)之后,分组分隔线随行出现。
// 2) 在 shell.overlay 注册确认弹窗 + 顶部轻提示:说明删除不可恢复,确认后 POST
//    /api/session-delete/delete {sessionId, confirm:true}。
// 3) 删除成功后经 client 的 sessions.refresh() 重拉基线,该行从列表消失。
//
// 依赖面刻意收窄:只 require "react" 与 "@deepseek-ai/dsh-client-ui-primitives"
// (后者是 loader lane 的隐式 baseline external)。共享状态用自带的极简快照 store,
// 不再 require @deepseek-ai/dsh-client-store,避免多一个运行时依赖。
//
// 这是 DSH client 插件的打包产物格式:window.__ModuleLoader__.load({ id, factory })。
// 不使用 JSX,统一用 react.createElement,无需构建步骤。

window.__ModuleLoader__.load({
  id: "dsh-session-delete",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const React = require("react");
    const {
      Button,
      IconCloseFillRegular,
      IconEllipsisOutlineRegular,
      IconPlusOutlineRegular,
      IconSearchOutlineRegular,
      IconSlidersTwoOutlineRegular,
      IconTrashOutlineRegular,
      MenuItemButton,
      Modal,
    } = require("@deepseek-ai/dsh-client-ui-primitives");

    const NS = "dsh-session-delete";
    const MENU_ORDER = 900;
    /** 会话行 hover 按钮条里的位置:排在官方归档(100)/置顶(200)之后。 */
    const SELECT_ACTION_ORDER = 300;
    const TOAST_MS = 3200;

    const inject = ["slots"];

    // ---- 可见文案(规范:UI 文案走 Client locale 服务)----------------------------
    // 注册到 locale 服务的 NS 命名空间,并用 locale.bind(NS) 取翻译函数(它在调用时
    // 读当前语言,引用稳定)。服务缺席、注册冲突或语言包缺失时一律回退到 zh 字典,
    // 行为与"硬编码中文"完全一致——本地化层永远不会成为功能故障点。
    const DICTS = {
      zh: {
        statusReading: "正在读取会话状态",
        statusUnknown: "无法读取会话状态",
        sessionServiceUnavailable: "会话服务不可用,无法重试",
        retryRejected: "重试未被接受",
        noRetryText: "这条消息没有可重发的文本内容",
        retryQueued: "已重新提交这条输入,模型将重新回答",
        retryTooltip: "重试:重新发送这条输入并重新生成回复",
        retryLabel: "重试",
        retryFailed: "重试失败:{message}",
        retryFailedNoSession: "重试失败:找不到当前会话",
        retryFailedNoText: "重试失败:这条消息没有可重发的文本",
        deleteSession: "删除此会话",
        deleteSessionWithReason: "删除此会话({reason})",
        reasonRunning: "此会话正在运行",
        reasonArtifactGone: "产物已不存在,将清理列表",
        deletedToast: "已删除会话「{title}」",
        cleanedToast: "已清理会话行「{title}」",
        bulkMenuLabel: "批量删除会话…",
        bulkTitle: "批量删除会话",
        bulkSubtitle: "勾选要永久删除的会话。运行中的会话不能删除。",
        bulkIntro: "这些会话的日志与记录会被永久删除,无法恢复;保存在它们上面的数据也会一并消失。",
        bulkLoading: "正在读取会话…",
        bulkLoadFailed: "读取会话列表失败:{message}",
        bulkNoTitle: "(无标题会话)",
        bulkRowRunning: "运行中",
        bulkRowGhost: "日志已不存在",
        bulkCount: "共 {total} 个会话,可删除 {deletable} 个",
        bulkDeleteSelected: "永久删除选中的 {count} 个",        modalClose: "关闭",
        modalTitle: "永久删除此会话",
        cancel: "取消",
        deleting: "删除中…",
        deleteForever: "永久删除",
        bodyGhost: "该会话的产物已不存在,本次只把它从会话列表与工作区中彻底清除。",
        bodyPurge: "该会话的日志与记录会被永久删除,无法恢复;保存在该会话上的数据也会一并消失。",
        // ---- 工作区标题行的「⋯」菜单 + 批量删除 ----
        menuTrigger: "更多",
        menuSearch: "搜索会话",
        menuView: "视图选项",
        menuBulk: "批量删除会话",
        menuSelectAll: "全选可删除的",
        menuClearSelection: "清除选择",
        menuBulkConfirm: "删除选中的 {count} 个…",
        menuBulkExit: "退出批量选择",
        // 批量删除的确认弹窗(和单会话删除同款)
        modalBulkTitle: "永久删除 {count} 个会话",
        bulkSelectionSummary: "已选中 {count} 个会话",
        selectRowTooltip: "选中这个会话(用于批量删除)",
        selectRowRunning: "运行中的会话不能删除",
        bulkNothingSelected: "没有选中任何会话",
        bulkResult: "已删除 {deleted} 个会话",
        bulkResultSkipped: ",{failed} 个未删除",
      },
      en: {
        statusReading: "Reading session state",
        statusUnknown: "Cannot read session state",
        sessionServiceUnavailable: "Session service unavailable; cannot retry",
        retryRejected: "Retry was not accepted",
        noRetryText: "This message has no text to resend",
        retryQueued: "Resent that input; the model will answer again",
        retryTooltip: "Retry: resend this input and generate a new reply",
        retryLabel: "Retry",
        retryFailed: "Retry failed: {message}",
        retryFailedNoSession: "Retry failed: current session not found",
        retryFailedNoText: "Retry failed: this message has no text to resend",
        deleteSession: "Delete this session",
        deleteSessionWithReason: "Delete this session ({reason})",
        reasonRunning: "this session is running",
        reasonArtifactGone: "the log is already gone; this only clears the list row",
        deletedToast: "Deleted session \"{title}\"",
        cleanedToast: "Cleared the list row for \"{title}\"",
        bulkMenuLabel: "Bulk delete sessions…",
        bulkTitle: "Bulk delete sessions",
        bulkSubtitle: "Tick the sessions to delete permanently. A running session cannot be deleted.",
        bulkIntro: "Their logs and records are deleted permanently and cannot be recovered; data stored on them disappears too.",
        bulkLoading: "Loading sessions…",
        bulkLoadFailed: "Could not load the session list: {message}",
        bulkNoTitle: "(untitled session)",
        bulkRowRunning: "running",
        bulkRowGhost: "log already gone",
        bulkCount: "{total} sessions, {deletable} deletable",
        bulkDeleteSelected: "Delete {count} permanently",        modalClose: "Close",
        modalTitle: "Permanently delete this session",
        cancel: "Cancel",
        deleting: "Deleting…",
        deleteForever: "Delete permanently",
        bodyGhost: "The session log no longer exists; this only removes it from the session list and workspace.",
        bodyPurge: "The session log and records are deleted permanently and cannot be recovered; data stored on this session disappears too.",
        // ---- workspace header "..." menu + bulk delete dialog ----
        menuTrigger: "More",
        menuSearch: "Search sessions",
        menuView: "View options",
        menuBulk: "Bulk delete sessions",
        menuSelectAll: "Select all deletable",
        menuClearSelection: "Clear selection",
        menuBulkConfirm: "Delete {count} selected…",
        menuBulkExit: "Exit bulk select",
        // bulk delete confirmation (same dialog as the single-session delete)
        modalBulkTitle: "Permanently delete {count} sessions",
        bulkSelectionSummary: "{count} sessions selected",
        selectRowTooltip: "Select this session (for bulk delete)",
        selectRowRunning: "A running session cannot be deleted",
        bulkNothingSelected: "No sessions selected",
        bulkResult: "Deleted {deleted} sessions",
        bulkResultSkipped: ", {failed} not deleted",
      },
    };
    const FALLBACK_LOCALE = "zh";

    /** `{name}` 占位符插值;缺参时原样保留,便于暴露漏配。 */
    function formatText(template, params) {
      if (params === undefined || params === null) return template;
      return String(template).replace(/\{(\w+)\}/g, (match, name) => (
        params[name] === undefined || params[name] === null ? match : String(params[name])
      ));
    }

    /** 取 locale 服务(可选依赖:get 后必须判空)。 */
    function localeService(ctx) {
      try {
        const service = ctx.get("locale");
        return service && typeof service.bind === "function" ? service : undefined;
      } catch {
        return undefined;
      }
    }

    /** 注册本插件的中英字典;返回 disposer(幂等)。 */
    function registerLocaleDicts(ctx, locale) {
      if (locale === undefined || typeof locale.register !== "function") return;
      ctx.effect(() => {
        const disposers = [];
        for (const [id, dict] of Object.entries(DICTS)) {
          try {
            const dispose = locale.register(NS, id, dict);
            if (typeof dispose === "function") disposers.push(dispose);
          } catch (error) {
            console.warn(`${NS}: locale dictionary "${id}" not registered`, error);
          }
        }
        return () => {
          for (const dispose of disposers) {
            try {
              dispose();
            } catch {
              /* noop */
            }
          }
        };
      }, `${NS}: locale dictionaries`);
    }

    /** 翻译函数:locale 可用时走服务(调用时读当前语言),否则 zh 兜底。 */
    function createTranslator(locale) {
      const fallback = (key, params) => formatText(DICTS[FALLBACK_LOCALE][key] ?? key, params);
      if (locale === undefined || typeof locale.bind !== "function") return fallback;
      let bound;
      try {
        bound = locale.bind(NS);
      } catch (error) {
        console.warn(`${NS}: locale.bind failed`, error);
        return fallback;
      }
      return (key, params) => {
        try {
          const value = bound(key);
          const text = value === undefined || value === null || value === key
            ? (DICTS[FALLBACK_LOCALE][key] ?? key)
            : value;
          return formatText(text, params);
        } catch {
          return fallback(key, params);
        }
      };
    }

    /** 极简快照 store:getSnapshot/subscribe/update,够用即可。 */
    function createMiniStore(initial) {
      let state = initial;
      const listeners = new Set();
      return {
        getSnapshot: () => state,
        subscribe: (listener) => {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        update: (mutate) => {
          const next = { ...state };
          mutate(next);
          state = next;
          for (const listener of [...listeners]) {
            try {
              listener();
            } catch (error) {
              console.error(`${NS}: store subscriber failed`, error);
            }
          }
        },
      };
    }

    /** 会话删除资格:API 不可达时按不可删除处理(安全侧)。 */
    function deleteStateFromStatus(status, t) {
      if (status === null || status === undefined) {
        return { known: false, deletable: false, reason: t("statusReading") };
      }
      if (!status.ok) {
        return { known: false, deletable: false, reason: status.error || t("statusUnknown") };
      }
      return {
        known: true,
        deletable: status.value.deletable === true,
        running: status.value.running === true,
        artifactExists: status.value.artifactExists === true,
        reason: status.value.reason,
      };
    }

    // 同 id 的资格查询去重:一行一次请求
    const statusInflight = new Map();

    function loadDeleteStatus(sessionId) {
      const key = String(sessionId);
      const pending = statusInflight.get(key);
      if (pending !== undefined) return pending;
      const request = (async () => {
        try {
          const response = await fetch(
            `/api/session-delete/status?sessionId=${encodeURIComponent(key)}`,
            { headers: { accept: "application/json" } },
          );
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            return { ok: false, error: payload && payload.error ? String(payload.error) : `HTTP ${response.status}` };
          }
          return { ok: true, value: payload };
        } catch (error) {
          return { ok: false, error: error && error.message ? error.message : String(error) };
        }
      })();
      statusInflight.set(key, request);
      const drop = () => {
        if (statusInflight.get(key) === request) statusInflight.delete(key);
      };
      request.then(drop, drop);
      return request;
    }

    async function requestDelete(sessionId) {
      const response = await fetch("/api/session-delete/delete", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ sessionId: String(sessionId), confirm: true }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload && payload.error ? String(payload.error) : `HTTP ${response.status}`);
      return payload;
    }

    /**
     * 插件半区:唯一 store 实例 + 注入面。
     * 菜单行与 overlay(弹窗+轻提示)共用同一实例与动作。
     * @param ctx - client 插件上下文。
     * @param t - 翻译函数(见 createTranslator)。
     * @param locale - Client locale 服务(可缺席)。
     */
    function createSessionDeletePlugin(ctx, t, locale) {
      // pending = 单会话删除确认;toast = 轻提示;
      // bulkOpen = 批量删除弹窗;selection = 弹窗里勾中的会话;bulkConfirm = 同款确认弹窗
      const store = createMiniStore({
        pending: null,
        toast: null,
        bulkOpen: false,
        selection: new Set(),
        bulkConfirm: false,
        bulkMode: false,
        menuOpen: false,
        menuRect: null,
      });
      // 官方按钮只用于取位置,点击一律现查(缓存引用在 React 重渲染后会脱离文档)
      const native = { search: null, view: null };
      const useDeleteStore = () => React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

      /**
       * 语言切换后重渲染:locale 快照带 revision 且引用稳定,符合
       * useSyncExternalStore 的契约;服务缺席时退化为"永不更新"。
       */
      const useLocaleRevision = () => {
        const subscribe = React.useCallback(
          (listener) => (locale === undefined ? () => {} : locale.subscribe(listener)),
          [],
        );
        const snapshot = React.useCallback(
          () => (locale === undefined ? 0 : locale.getSnapshot()),
          [],
        );
        React.useSyncExternalStore(subscribe, snapshot, snapshot);
      };

      const refreshSessions = () => {
        // 删除成功后列表收尾:产物与工作区关联都已解除,重拉基线让该行消失。
        // refresh 失败只影响列表即时性,不影响删除结果。
        try {
          const sessions = ctx.get("sessions");
          if (sessions && typeof sessions.refresh === "function") {
            Promise.resolve(sessions.refresh()).catch(() => {});
          }
        } catch {
          /* noop */
        }
      };

      const actions = {
        ask: (target) => store.update((draft) => {
          draft.pending = target;
        }),
        dismiss: () => store.update((draft) => {
          draft.pending = null;
        }),
        settle: (message) => {
          store.update((draft) => {
            draft.pending = null;
            draft.toast = { message };
          });
          refreshSessions();
        },
        clearToast: () => store.update((draft) => {
          draft.toast = null;
        }),
        notify: (message) => store.update((draft) => {
          draft.toast = { message };
        }),
        // ---- 批量删除:侧栏勾选 + 同款确认弹窗 ----
        toggleSelect: (sessionId) => store.update((draft) => {
          const next = new Set(draft.selection);
          if (next.has(sessionId)) next.delete(sessionId);
          else next.add(sessionId);
          draft.selection = next;
        }),
        clearSelection: () => store.update((draft) => {
          draft.selection = new Set();
        }),
        selectAll: (ids) => store.update((draft) => {
          draft.selection = new Set(Array.isArray(ids) ? ids.map(String) : []);
        }),
        openMenu: (rect) => store.update((draft) => {
          draft.menuOpen = true;
          draft.menuRect = rect;
        }),
        closeMenu: () => store.update((draft) => {
          draft.menuOpen = false;
          draft.menuRect = null;
        }),
        selectAllDeletable: () => {
          loadSessionRows().then(
            (rows) => store.update((draft) => {
              draft.selection = new Set(rows.filter((row) => row.deletable !== false).map((row) => row.sessionId));
            }),
            (reason) => store.update((draft) => {
              draft.toast = { message: t("retryFailed", { message: reason && reason.message ? reason.message : String(reason) }) };
            }),
          );
        },
        enterBulk: () => store.update((draft) => {
          draft.bulkMode = true;
          draft.selection = new Set();
          draft.bulkConfirm = false;
        }),
        exitBulk: () => store.update((draft) => {
          draft.bulkMode = false;
          draft.selection = new Set();
          draft.bulkConfirm = false;
        }),
        openBulkConfirm: () => store.update((draft) => {
          if (draft.selection.size === 0) return;
          draft.bulkConfirm = true;
        }),
        closeBulkConfirm: () => store.update((draft) => {
          draft.bulkConfirm = false;
        }),
        /** 批量删除成功:退出模式并清空选择(失败项留在选择里由调用方处理)。 */
        finishBulk: () => store.update((draft) => {
          draft.bulkConfirm = false;
          draft.bulkOpen = false;
          draft.selection = new Set();
        }),
      };

      /**
       * 投递重试:走官方客户端会话绑定,与输入框发送同一条路
       * (`sessions.using(id, …, ref => ref.binding.session.prompt(content, 'queue'))`)。
       * 不用 host 的 sessionController.prompt 直调——那是 @Remote 方法,需要网关注入的
       * signal,插件直调会抛 `throwIfAborted`。
       */
      async function sendRetry(sessionId, text) {
        const sessions = ctx.get("sessions");
        if (!sessions || typeof sessions.using !== "function") throw new Error(t("sessionServiceUnavailable"));
        const result = await sessions.using(
          sessionId,
          { source: "workspaceOperation" },
          (reference) => reference.binding.session.prompt([{ type: "text", text }], "queue"),
        );
        if (result && result.ok === false) {
          const failure = result.error;
          throw new Error(failure && failure.message ? failure.message : t("retryRejected"));
        }
        return result;
      }

      /** 从 host 只读路由解析「这条 AI 回复要重发的用户输入」。 */
      async function loadRetryText(sessionId, messageId) {
        const url = `/api/session-delete/retry-source?sessionId=${encodeURIComponent(String(sessionId))}`
          + `&messageId=${encodeURIComponent(String(messageId))}`;
        const response = await fetch(url, { headers: { accept: "application/json" } });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload && payload.error ? String(payload.error) : `HTTP ${response.status}`);
        }
        return typeof payload.text === "string" ? payload.text : "";
      }

      /** 按 messageId 重试(AI 回复行)。 */
      async function retryByMessageId(sessionId, messageId) {
        const text = await loadRetryText(sessionId, messageId);
        if (text === "") throw new Error(t("noRetryText"));
        await sendRetry(sessionId, text);
      }

      /** 按文本重试(用户消息行,文本取自气泡)。 */
      async function retryByText(sessionId, text) {
        const trimmed = typeof text === "string" ? text.trim() : "";
        if (trimmed === "") throw new Error(t("noRetryText"));
        await sendRetry(sessionId, trimmed);
      }

      /** 批量删除弹窗的数据源:host 用官方 sessionQuery 列出的会话清单。 */
      async function loadSessionRows() {
        const response = await fetch("/api/session-delete/sessions", { headers: { accept: "application/json" } });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload && payload.error ? String(payload.error) : `HTTP ${response.status}`);
        }
        return Array.isArray(payload.sessions) ? payload.sessions : [];
      }

      /** 时间戳 → 本地可读时间(浏览器 locale)。 */
      function formatTime(value) {
        if (typeof value !== "number" || !Number.isFinite(value)) return "";
        try {
          return new Date(value).toLocaleString();
        } catch {
          return new Date(value).toISOString();
        }
      }

      /** 批量删除:请求体带 confirm,host 逐条执行并逐条汇报。 */
      async function deleteMany(sessionIds) {
        const ids = Array.isArray(sessionIds) ? sessionIds.map(String).filter((id) => id !== "") : [];
        if (ids.length === 0) throw new Error(t("bulkNothingSelected"));
        const response = await fetch("/api/session-delete/delete-many", {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ sessionIds: ids, confirm: true }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload && payload.error ? String(payload.error) : `HTTP ${response.status}`);
        }
        return payload;
      }

      const refreshIcon = (size) => React.createElement("svg", {
        width: size,
        height: size,
        viewBox: "0 0 16 16",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 1.4,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        "aria-hidden": "true",
      }, [
        React.createElement("path", { key: "arc", d: "M13.4 8a5.4 5.4 0 1 1-1.7-3.9" }),
        React.createElement("path", { key: "head", d: "M13.6 2.3v3.4h-3.4" }),
      ]);

      /** AI 回复行的「重试」:取该回复之前的用户输入重新提问(slot 给的是 messageId)。 */
      function RetryAssistantAction(props) {
        const { messageId, sessionId, actions: act } = props;
        useLocaleRevision();
        const busyState = React.useState(false);
        const busy = busyState[0];
        const setBusy = busyState[1];

        const onClick = () => {
          if (busy) return;
          setBusy(true);
          retryByMessageId(sessionId, String(messageId))
            .then(() => act.notify(t("retryQueued")))
            .catch((error) => act.notify(t("retryFailed", { message: error && error.message ? error.message : String(error) })))
            .finally(() => setBusy(false));
        };

        return React.createElement("button", {
          type: "button",
          className: `${NS}-retry-button`,
          title: t("retryTooltip"),
          "aria-label": t("retryLabel"),
          disabled: busy,
          onClick,
        }, refreshIcon(16));
      }

      // ---- 侧栏勾选(官方插槽,React 渲染,不走注入)-------------------------

      /** 勾选框图标(未选 / 已选)。 */
      const selectIcon = (checked) => React.createElement("svg", {
        width: 14,
        height: 14,
        viewBox: "0 0 16 16",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 1.5,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        "aria-hidden": "true",
      }, checked
        ? [
          React.createElement("rect", { key: "box", x: 2.5, y: 2.5, width: 11, height: 11, rx: 2.5, fill: "currentColor", fillOpacity: 0.16 }),
          React.createElement("path", { key: "tick", d: "M5 8.4l2.1 2.1L11.2 6" }),
        ]
        : [React.createElement("rect", { key: "box", x: 2.5, y: 2.5, width: 11, height: 11, rx: 2.5 })]);

      /**
       * 会话行 hover 按钮条里的勾选框(官方 `sidebar.workspaces.session.row.action`)。
       * 只在批量模式下出现(官方约定:不适用时条目返回 null);运行中的会话不可勾。
       */
      function SessionSelectAction(props) {
        const { sessionId, useSessionStatus, actions: act, useDeleteStore: useStore } = props;
        useLocaleRevision();
        const state = useStore() ?? {};
        const bulkMode = state.bulkMode === true;
        const selection = state.selection === undefined || state.selection === null ? new Set() : state.selection;
        const statuses = useSessionStatus === undefined ? undefined : useSessionStatus((all) => all);
        const row = statuses === undefined || statuses === null ? undefined : statuses.get(sessionId);
        const running = Boolean(row && row.running);
        const checked = selection.has(sessionId);

        if (!bulkMode) return null;

        return React.createElement("button", {
          type: "button",
          className: `${NS}-select-button`,
          title: running ? t("selectRowRunning") : t("selectRowTooltip"),
          "aria-label": t("selectRowTooltip"),
          "aria-pressed": checked,
          disabled: running,
          onClick: () => {
            if (running) return;
            act.toggleSelect(sessionId);
          },
        }, selectIcon(checked));
      }

      /**
       * 「工作区」标题行的「⋯」菜单:把官方标题右边那几个入口收成一个点。
       *
       * 官方 `sidebar.workspaces` 是整体替换槽(不许碰),标题行也没有旁挂插槽,所以走注入:
       *   - 在官方 `headerActions` 末尾(添加工作区按钮右边)加一个「⋯」按钮;
       *   - 官方的搜索按钮、视图选项按钮**留在 DOM 里但视觉收起**(视图选项保留一个隐形盒子,
       *     让它的 Menu 弹层仍有锚点),菜单项靠代理点击触发官方原逻辑;
       *   - 「批量删除会话」进入侧栏勾选模式,再在菜单里「删除选中的 N 个…」打开同款确认弹窗。
       *
       * 点击可靠性:React 重渲染会把这个容器从 headerActions 里摘掉,而 `click` 要求按下与
       * 抬起落在同一节点 —— 节点被换掉的那一瞬间点击就丢了。所以:
       *   1) 观察器**同步**回挂(不再 setTimeout 防抖,消除"节点不在 DOM"的窗口);
       *   2) 所有点击用 `pointerdown` 触发(按下即生效,不等抬起)。
       *
       * 侧栏收起(rail)时官方不渲染标题,入口随之隐藏。
       */
      /**
       * 工作区标题行的「⋯」入口。
       *
       * 官方 `sidebar.workspaces` 是整体替换槽(不许碰),标题行也没有旁挂插槽,所以入口本身
       * 只能注入 —— 但只为它做两件事:把按钮放进官方 `headerActions` 末尾(添加工作区右边),
       * 并把官方那个按钮的**类名抄给它**(字号/尺寸/hover/圆角全部继承,质感与原生一致),
       * 再量出它的位置交给 `WorkspaceHeaderMenu`。
       *
       * 菜单本体是官方 `Menu` 原语(React,渲染在 `shell.overlay`),不是手搓弹层。
       *
       * 点击可靠性:React 重渲染会把这个按钮从 headerActions 里摘掉,而 `click` 要求按下与
       * 抬起落在同一节点 —— 节点被换掉的那一瞬间点击就丢了。所以:
       *   1) 观察器**同步**回挂(不再 setTimeout 防抖);
       *   2) 触发用 `pointerdown`(按下即生效,不等抬起)。
       */
      function mountWorkspaceMenu() {
        const container = document.createElement("span");
        container.setAttribute(`data-${NS}-menu`, "1");
        // display:contents —— 不生成盒子,让「⋯」按钮直接成为 headerActions 的 flex 子项,
        // 与官方「添加工作区」按钮同样的对齐/间距,不会出现多一层的错位。
        container.style.cssText = "display:contents;";

        const trigger = document.createElement("button");
        trigger.type = "button";
        trigger.setAttribute("aria-haspopup", "menu");
        // 官方「⋯」图标(几何与官方 cells/菜单图标同源):16 视野、currentColor 填充圆点。
        trigger.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">'
          + '<circle cx="3.4" cy="8" r="1.15"/><circle cx="8" cy="8" r="1.15"/><circle cx="12.6" cy="8" r="1.15"/></svg>';
        container.append(trigger);

        let menuOpen = false;
        let lastRect = null;

        /** 代理点击官方按钮:保留官方实现(搜索展开、视图选项弹层),不自己重写。 */
        const clickNative = (element) => {
          if (element === null || element === undefined) return;
          try {
            element.click();
          } catch (error) {
            console.warn(`${NS}: proxy click failed`, error);
          }
        };

        const openMenu = () => {
          if (menuOpen) return;
          const rect = trigger.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) return;
          menuOpen = true;
          lastRect = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
          actions.openMenu(lastRect);
        };
        const closeMenu = () => {
          if (!menuOpen) return;
          menuOpen = false;
          actions.closeMenu();
        };
        const toggleMenu = () => {
          if (menuOpen) closeMenu();
          else openMenu();
        };

        /**
         * 按下即触发:pointerdown 在按下的那一刻就派发,不受"按下/抬起之间节点被 React 换掉"
         * 的影响 —— 这是"点一次没反应、要点两三次"的根因。
         */
        trigger.addEventListener("pointerdown", (event) => {
          if (typeof event.button === "number" && event.button !== 0) return;
          event.preventDefault();
          event.stopPropagation();
          toggleMenu();
        });

        const applyLabel = () => {
          trigger.title = t("menuTrigger");
          trigger.setAttribute("aria-label", t("menuTrigger"));
        };

        // ---- 收编官方入口 + 幂等回挂 ----
        const mount = () => {
          const header = document.querySelector('[class*="sectionHeader"]');
          const headerActions = header === null ? null : header.querySelector('[class*="headerActions"]');
          if (headerActions === null) {
            if (container.parentElement !== null) container.remove();
            return;
          }
          const shipped = [...headerActions.querySelectorAll("button")].filter((node) => !container.contains(node));
          const view = shipped.length > 0 ? shipped[0] : null;
          const plus = shipped.length > 1 ? shipped[shipped.length - 1] : null;
          const search = header.querySelector('[class*="searchButton"]');
          if (search !== null && search.style.position !== "fixed") {
            search.style.position = "fixed";
            search.style.left = "-9999px";
            search.style.top = "-9999px";
          }
          if (view !== null && view !== plus) {
            // 完全移出文档流(position:fixed):既不占位、也不影响兄弟节点布局 ——
            // 「＋添加工作区」保持原位,标题行不会多出空洞。点「视图选项」前会把它临时
            // 挪到「⋯」的位置当锚点(见 WorkspaceHeaderMenu),弹层因此仍开在正确位置。
            view.style.cssText = "position:fixed;left:-9999px;top:-9999px;width:22px;height:22px;"
              + "padding:0;border:0;opacity:0;pointer-events:none;";
          }
          // 抄官方图标按钮的类名 —— 视觉完全继承官方(:hover / 尺寸 / 圆角 / 颜色 / 深色模式)
          if (plus !== null && plus.className !== trigger.className) trigger.className = plus.className;
          native.search = search;
          native.view = view === plus ? null : view;
          if (container.parentElement !== headerActions) headerActions.appendChild(container);
        };

        const observer = new MutationObserver(() => {
          // 同步回挂:不要 setTimeout —— 那 120ms 正是点击丢失的窗口
          try {
            mount();
          } catch (error) {
            console.warn(`${NS}: workspace menu mount failed`, error);
          }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        mount();
        applyLabel();

        // 菜单关闭后同步本地状态(Menu 的 onClose / 选项点击都会经过 store)
        const unsubscribeStore = store.subscribe(() => {
          const open = store.getSnapshot().menuOpen === true;
          if (open === false) {
            menuOpen = false;
            void lastRect;
          }
        });
        const unsubscribeLocale = locale === undefined ? () => {} : locale.subscribe(applyLabel);

        return () => {
          observer.disconnect();
          unsubscribeStore();
          unsubscribeLocale();
          actions.closeMenu();
          container.remove();
        };
      }

      /**
       * 打开官方「视图选项」菜单:先把隐藏的官方按钮临时挪到「⋯」的位置当锚点(它是
       * position:fixed,移位置不会影响任何布局),点开后放回屏幕外。
       */
      const openNativeViewMenu = (rect) => {
        const actions = document.querySelector('[class*="headerActions"]');
        const buttons = actions === null
          ? []
          : [...actions.querySelectorAll("button")].filter((node) => node.closest(`[data-${NS}-menu]`) === null);
        const node = buttons.length > 0 ? buttons[0] : null;
        if (node === null || rect === null || rect === undefined) return;
        node.style.left = `${Math.round(rect.left)}px`;
        node.style.top = `${Math.round(rect.top)}px`;
        try {
          node.click();
        } catch (error) {
          console.warn(`${NS}: view proxy failed`, error);
        }
        setTimeout(() => {
          node.style.left = "-9999px";
          node.style.top = "-9999px";
        }, 400);
      };

      /**
       * 工作区标题行的菜单弹层。
       *
       * 官方 `Menu` 原语对着一个 `position:fixed` 的锚点算不出坐标(弹层会落到左上角),
       * 所以这里自己渲染 —— 但外观严格照官方菜单的 token:8px 圆角、4px 内边距、30px 行高、
       * 13px 字号、hover 高亮、分隔线、阴影,图标直接用官方图标组件。
       * 位置由「⋯」按钮的真实矩形算:右对齐、贴边回退、空间不够向上翻。
       */
      function WorkspaceHeaderMenu(props) {
        const { actions: act, useDeleteStore: useStore } = props;
        useLocaleRevision();
        const state = useStore() ?? {};
        const open = state.menuOpen === true && state.menuRect !== null && state.menuRect !== undefined;
        const rect = state.menuRect;

        React.useEffect(() => {
          if (!open) return undefined;
          const onPointerDown = (event) => {
            const target = event.target;
            if (target === null || target === undefined || typeof target.closest !== "function") return;
            if (target.closest(`[data-${NS}-menu]`) !== null) return;
            if (target.closest(`[data-${NS}-pop]`) !== null) return;
            act.closeMenu();
          };
          const onKeyDown = (event) => {
            if (event.key === "Escape") act.closeMenu();
          };
          document.addEventListener("pointerdown", onPointerDown, true);
          document.addEventListener("keydown", onKeyDown, true);
          return () => {
            document.removeEventListener("pointerdown", onPointerDown, true);
            document.removeEventListener("keydown", onKeyDown, true);
          };
        }, [open, act]);

        if (!open) return null;

        const bulk = state.bulkMode === true;
        const selected = state.selection ? state.selection.size : 0;
        const withIcon = (node) => React.createElement("span", {
          style: {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "16px",
            height: "16px",
            flex: "0 0 16px",
            color: "var(--dsw-alias-label-secondary)",
          },
        }, node);

        const items = bulk
          ? [
            { id: "select-all", label: t("menuSelectAll"), icon: withIcon(React.createElement(IconPlusOutlineRegular, { size: 16 })) },
            { id: "clear", label: t("menuClearSelection"), icon: withIcon(React.createElement(IconCloseFillRegular, { size: 16 })) },
            { type: "separator", id: "bulk-sep" },
            { id: "confirm", label: t("menuBulkConfirm", { count: selected }), icon: withIcon(React.createElement(IconTrashOutlineRegular, { size: 16 })), danger: true },
            { id: "exit", label: t("menuBulkExit") },
          ]
          : [
            { id: "search", label: t("menuSearch"), icon: withIcon(React.createElement(IconSearchOutlineRegular, { size: 16 })) },
            { id: "view", label: t("menuView"), icon: withIcon(React.createElement(IconSlidersTwoOutlineRegular, { size: 16 })) },
            { type: "separator", id: "idle-sep" },
            { id: "bulk", label: t("menuBulk"), icon: withIcon(React.createElement(IconTrashOutlineRegular, { size: 16 })), danger: true },
          ];

        const dispatch = (id) => {
          act.closeMenu();
          if (id === "search") {
            requestAnimationFrame(() => {
              const live = document.querySelector('[class*="searchButton"]');
              if (live !== null) live.click();
            });
          } else if (id === "view") {
            openNativeViewMenu(rect);
          } else if (id === "bulk") {
            act.enterBulk();
          } else if (id === "select-all") {
            act.selectAllDeletable();
          } else if (id === "clear") {
            act.clearSelection();
          } else if (id === "confirm") {
            act.openBulkConfirm();
          } else if (id === "exit") {
            act.exitBulk();
          }
        };

        const width = 188;
        const height = items.reduce((sum, item) => sum + (item.type === "separator" ? 9 : 30), 8);
        const viewportWidth = window.innerWidth || 1280;
        const viewportHeight = window.innerHeight || 800;
        let left = rect.right - width;
        if (left < 8) left = 8;
        if (left + width > viewportWidth - 8) left = viewportWidth - width - 8;
        let top = rect.bottom + 6;
        if (top + height > viewportHeight - 8) top = Math.max(8, rect.top - height - 6);

        const popoverProps = {
          role: "menu",
          style: {
            position: "fixed",
            left: `${Math.round(left)}px`,
            top: `${Math.round(top)}px`,
            width: `${width}px`,
            padding: "4px",
            boxSizing: "border-box",
            borderRadius: "8px",
            background: "var(--dsw-alias-bg-module-platform)",
            border: "1px solid var(--dsw-alias-border-l3)",
            boxShadow: "0 10px 30px rgba(0,0,0,.24)",
            zIndex: 95,
          },
        };
        popoverProps[`data-${NS}-pop`] = "1";

        return React.createElement("div", popoverProps, items.map((item) => (item.type === "separator"
          ? React.createElement("div", {
            key: item.id,
            style: { height: "1px", margin: "4px 6px", background: "var(--dsw-alias-border-l3)" },
          })
          : React.createElement("button", {
            key: item.id,
            type: "button",
            role: "menuitem",
            className: `${NS}-menu-item`,
            "data-danger": item.danger === true ? "1" : undefined,
            onClick: () => dispatch(item.id),
          }, [
            item.icon,
            React.createElement("span", { key: "label" }, item.label),
          ]))));
      }
      /** 官方会话「…」菜单里的「批量删除会话…」:同样是官方 MenuItemButton,观感与原生一致。 */
      function BulkDeleteMenuItem(props) {
        const { useMenuOpenState, actions: act } = props;
        useLocaleRevision();
        const [, setMenuOpen] = useMenuOpenState();
        return React.createElement(
          MenuItemButton,
          {
            danger: true,
            icon: React.createElement(IconTrashOutlineRegular, { size: 14 }),
            onSelect: () => {
              setMenuOpen(false);
              act.openBulk();
            },
          },
          t("bulkMenuLabel"),
        );
      }

      /**
       * 批量删除的选择弹窗:官方 Modal,列会话 + 勾选(运行中不可选),确认后走同款确认弹窗。
       */
      function BulkDeleteDialog(props) {
        const { actions: act, useDeleteStore: useStore } = props;
        useLocaleRevision();
        const state = useStore() ?? {};
        const selection = state.selection === undefined || state.selection === null ? new Set() : state.selection;
        const [phase, setPhase] = React.useState("loading");
        const [rows, setRows] = React.useState([]);
        const [error, setError] = React.useState(null);

        React.useEffect(() => {
          let alive = true;
          loadSessionRows().then(
            (list) => {
              if (!alive) return;
              setRows(list);
              setPhase("ready");
            },
            (reason) => {
              if (!alive) return;
              setError(reason && reason.message ? reason.message : String(reason));
              setPhase("error");
            },
          );
          return () => {
            alive = false;
          };
        }, []);

        const close = () => act.closeBulk();
        const deletable = rows.filter((row) => row.deletable !== false);
        const ids = rows
          .filter((row) => row.deletable !== false && selection.has(row.sessionId))
          .map((row) => row.sessionId);

        const toggle = (sessionId) => {
          const next = new Set(selection);
          if (next.has(sessionId)) next.delete(sessionId);
          else next.add(sessionId);
          act.setSelection([...next]);
        };

        const body = [];
        body.push(React.createElement("p", { key: "intro", style: { margin: 0 } }, t("bulkIntro")));
        if (phase === "loading") {
          body.push(React.createElement("p", { key: "loading", style: { margin: "10px 0 0", color: "var(--dsw-alias-label-caption)" } },
            t("bulkLoading")));
        } else if (phase === "error") {
          body.push(React.createElement("p", {
            key: "err",
            role: "alert",
            style: { margin: "10px 0 0", color: "var(--dsw-alias-state-error-primary)" },
          }, t("bulkLoadFailed", { message: error === null ? "" : error })));
        } else {
          body.push(React.createElement("div", {
            key: "list",
            style: {
              marginTop: 10,
              maxHeight: 300,
              overflowY: "auto",
              border: "1px solid var(--dsw-alias-border-l3)",
              borderRadius: 8,
              padding: 4,
            },
          }, rows.map((row) => {
            const selectable = row.deletable !== false;
            const meta = [
              row.running === true ? t("bulkRowRunning") : null,
              row.artifactExists === false ? t("bulkRowGhost") : null,
            ].filter((part) => part !== null && part !== undefined).join(" · ");
            return React.createElement("label", {
              key: row.sessionId,
              style: {
                display: "flex",
                gap: 8,
                alignItems: "center",
                padding: "6px 8px",
                borderRadius: 6,
                cursor: selectable ? "pointer" : "default",
                opacity: selectable ? 1 : 0.5,
              },
            }, [
              React.createElement("input", {
                key: "box",
                type: "checkbox",
                checked: selection.has(row.sessionId),
                disabled: !selectable,
                onChange: () => toggle(row.sessionId),
              }),
              React.createElement("span", {
                key: "title",
                style: { flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
                title: row.title || row.sessionId,
              }, row.title || t("bulkNoTitle")),
              React.createElement("span", {
                key: "meta",
                style: { flex: "0 0 auto", fontSize: 12, color: "var(--dsw-alias-label-caption)" },
              }, meta),
            ]);
          })));
          body.push(React.createElement("p", {
            key: "count",
            style: { margin: "8px 0 0", fontSize: 12, color: "var(--dsw-alias-label-caption)" },
          }, t("bulkCount", { total: rows.length, deletable: deletable.length })));
        }

        return React.createElement(Modal, {
          open: true,
          onClose: close,
          closeLabel: t("modalClose"),
          title: t("bulkTitle"),
          description: t("bulkSubtitle"),
          footer: React.createElement(
            React.Fragment,
            null,
            React.createElement(Button, { variant: "outline", onClick: close }, t("cancel")),
            React.createElement(Button, {
              variant: "outline",
              disabled: ids.length === 0,
              style: { color: "var(--dsw-alias-state-error-primary)" },
              onClick: () => act.openBulkConfirm(),
            }, t("bulkDeleteSelected", { count: ids.length })),
          ),
          children: body,
        });
      }

      /** 当前主视图正在展示的会话 id(DOM 注入的用户消息按钮需要知道发给哪个会话)。 */
      function currentSessionId() {
        try {
          const sessions = ctx.get("sessions");
          const list = sessions && sessions.list ? sessions.list.getSnapshot() : undefined;
          const rows = list && list.byId ? Object.values(list.byId) : [];
          const hit = rows.find((row) => ((row && row.retainedBy ? row.retainedBy.mainView : 0) ?? 0) > 0);
          return hit ? hit.id : undefined;
        } catch {
          return undefined;
        }
      }

      /**
       * 用户消息行的「重试」:官方没有用户消息 action 插槽(只有 AI 回复的
       * conversation.chat.assistant-actions),所以这里用 DOM 注入把按钮插到
       * 官方复制按钮右侧——复用复制按钮的 class 继承官方图标按钮样式,不改官方渲染。
       * 用 class 子串选择器(哈希前缀 + 语义名)而不是完整哈希类名,版本升级后仍可命中。
       */
      function mountUserRetryButtons() {
        const style = document.createElement("style");
        style.setAttribute("data-plugin", NS);
        style.textContent = [
          `.${NS}-retry-button{display:inline-flex;align-items:center;justify-content:center;border:0;background:transparent;`,
          `color:inherit;cursor:pointer;padding:2px;border-radius:4px;}`,
          `.${NS}-retry-button:hover:not([disabled]){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}`,
          `.${NS}-retry-button[disabled]{opacity:.45;cursor:default;}`,
        ].join("");
        document.head.appendChild(style);

        const injected = new Set();
        const relabelers = new Map();
        let scheduled = 0;

        const augment = () => {
          const sessionId = currentSessionId();
          const rows = document.querySelectorAll('[class*="userRow"]');
          for (const row of rows) {
            if (row.hasAttribute("data-submission-echo") || row.hasAttribute("data-pending-steering")) continue;
            if (row.querySelector(`[data-${NS}-retry]`)) continue;
            const actionsRow = row.querySelector('[class*="actions"]');
            if (actionsRow === null) continue;
            const copy = actionsRow.querySelector("button");
            if (copy === null) continue;

            const button = document.createElement("button");
            button.type = "button";
            button.className = copy.className;
            button.setAttribute(`data-${NS}-retry`, "1");
            const label = () => {
              button.title = t("retryTooltip");
              button.setAttribute("aria-label", t("retryLabel"));
            };
            label();
            button.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" `
              + `stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">`
              + `<path d="M13.4 8a5.4 5.4 0 1 1-1.7-3.9"></path><path d="M13.6 2.3v3.4h-3.4"></path></svg>`;
            button.addEventListener("click", (event) => {
              event.preventDefault();
              event.stopPropagation();
              if (button.disabled) return;
              const targetId = sessionId ?? currentSessionId();
              if (targetId === undefined) {
                actions.notify(t("retryFailedNoSession"));
                return;
              }
              const bubble = row.querySelector('[class*="bubble"]');
              const text = bubble === null ? "" : (bubble.textContent ?? "").trim();
              if (text === "") {
                actions.notify(t("retryFailedNoText"));
                return;
              }
              button.disabled = true;
              retryByText(targetId, text)
                .then(() => actions.notify(t("retryQueued")))
                .catch((error) => actions.notify(t("retryFailed", { message: error && error.message ? error.message : String(error) })))
                .finally(() => {
                  button.disabled = false;
                });
            });
            copy.after(button);
            injected.add(button);
            relabelers.set(button, label);
          }
        };

        const schedule = () => {
          if (scheduled !== 0) return;
          scheduled = window.setTimeout(() => {
            scheduled = 0;
            try {
              augment();
            } catch (error) {
              console.warn(`${NS}: user retry augmentation failed`, error);
            }
          }, 120);
        };

        const observer = new MutationObserver(schedule);
        observer.observe(document.body, { childList: true, subtree: true });
        augment();

        // 语言切换后刷新已注入按钮的 title / aria-label
        const unsubscribeLocale = locale === undefined
          ? () => {}
          : locale.subscribe(() => {
            for (const relabel of relabelers.values()) {
              try {
                relabel();
              } catch {
                /* noop */
              }
            }
          });

        return () => {
          observer.disconnect();
          unsubscribeLocale();
          if (scheduled !== 0) window.clearTimeout(scheduled);
          for (const button of injected) button.remove();
          injected.clear();
          relabelers.clear();
          style.remove();
        };
      }

      /** 「删除此会话」菜单行:仅运行中置灰;产物缺失时按「清理列表」提示。 */
      function DeleteSessionMenuItem(props) {
        const { sessionId, displayTitle, useMenuOpenState, useSessionStatus, actions: act } = props;
        useLocaleRevision();
        const [, setMenuOpen] = useMenuOpenState();
        const statuses = useSessionStatus((all) => all);
        const row = statuses === undefined || statuses === null ? undefined : statuses.get(sessionId);
        const running = Boolean(row && row.running);
        const statusState = React.useState(null);
        const status = statusState[0];
        const setStatus = statusState[1];

        React.useEffect(() => {
          let alive = true;
          loadDeleteStatus(sessionId).then((result) => {
            if (alive) setStatus(result);
          });
          return () => {
            alive = false;
          };
        }, [sessionId]);

        const resolved = deleteStateFromStatus(status, t);
        const blocked = !resolved.known || running || !resolved.deletable;
        const reason = running
          ? t("reasonRunning")
          : (resolved.known && !resolved.artifactExists
            ? t("reasonArtifactGone")
            : (resolved.known ? resolved.reason : undefined));

        return React.createElement(
          MenuItemButton,
          {
            separatorBefore: true,
            danger: true,
            disabled: blocked,
            icon: React.createElement(IconTrashOutlineRegular, { size: 14 }),
            onSelect: () => {
              if (blocked) return;
              setMenuOpen(false);
              act.ask({
                sessionId,
                displayTitle: displayTitle || sessionId,
                artifactExists: resolved.artifactExists === true,
              });
            },
          },
          reason ? t("deleteSessionWithReason", { reason }) : t("deleteSession"),
        );
      }

      /** 确认弹窗:装载与错误状态随 pending 一起销毁。 */
      function DeleteConfirmForm(props) {
        const { sessionId, displayTitle, artifactExists, actions: act } = props;
        useLocaleRevision();
        const busyState = React.useState(false);
        const busy = busyState[0];
        const setBusy = busyState[1];
        const errorState = React.useState(null);
        const error = errorState[0];
        const setError = errorState[1];

        const close = () => {
          if (busy) return;
          act.dismiss();
        };
        const confirm = () => {
          setBusy(true);
          setError(null);
          requestDelete(sessionId).then((payload) => {
            // 成功文案在客户端本地化;host 的 message 只作为兜底(它固定为中文)
            const ghost = payload && payload.mode === "ghost";
            act.settle(t(ghost ? "cleanedToast" : "deletedToast", { title: displayTitle }));
          }).catch((reason) => {
            setBusy(false);
            setError(reason && reason.message ? reason.message : String(reason));
          });
        };

        return React.createElement(Modal, {
          open: true,
          onClose: close,
          closeLabel: t("modalClose"),
          title: t("modalTitle"),
          description: displayTitle,
          footer: React.createElement(
            React.Fragment,
            null,
            React.createElement(Button, { variant: "outline", disabled: busy, onClick: close }, t("cancel")),
            React.createElement(Button, {
              variant: "outline",
              disabled: busy,
              style: { color: "var(--dsw-alias-state-error-primary)" },
              onClick: confirm,
            }, busy ? t("deleting") : t("deleteForever")),
          ),
          children: [
            React.createElement("p", { key: "warn", style: { margin: 0 } },
              artifactExists === false ? t("bodyGhost") : t("bodyPurge")),
            error !== null && React.createElement("p", {
              key: "error",
              role: "alert",
              style: { margin: "8px 0 0", color: "var(--dsw-alias-state-error-primary)" },
            }, error),
          ],
        });
      }

      /**
       * 批量删除的确认弹窗 —— 与单会话删除的 `DeleteConfirmForm` 结构完全一致:
       * 同样的 Modal、同样的 description 一行、同样的一句警告、同样的 [取消][永久删除] 两个按钮。
       * 唯一的区别只是文案里带上数量;勾选发生在侧栏会话行,这里只做确认。
       */
      function BulkConfirmForm(props) {
        const { actions: act, sessionIds } = props;
        useLocaleRevision();
        const [busy, setBusy] = React.useState(false);
        const [error, setError] = React.useState(null);
        const count = sessionIds.length;

        const close = () => {
          if (busy) return;
          act.closeBulkConfirm();
        };
        const confirm = () => {
          if (busy || count === 0) return;
          setBusy(true);
          setError(null);
          deleteMany(sessionIds).then((payload) => {
            const deleted = typeof payload.deleted === "number" ? payload.deleted : count;
            const failed = typeof payload.failed === "number" ? payload.failed : 0;
            act.finishBulk();
            act.settle(t("bulkResult", { deleted }) + (failed > 0 ? t("bulkResultSkipped", { failed }) : ""));
          }).catch((reason) => {
            setBusy(false);
            setError(reason && reason.message ? reason.message : String(reason));
          });
        };

        return React.createElement(Modal, {
          open: true,
          onClose: close,
          closeLabel: t("modalClose"),
          title: t("modalBulkTitle", { count }),
          description: t("bulkSelectionSummary", { count }),
          footer: React.createElement(
            React.Fragment,
            null,
            React.createElement(Button, { variant: "outline", disabled: busy, onClick: close }, t("cancel")),
            React.createElement(Button, {
              variant: "outline",
              disabled: busy,
              style: { color: "var(--dsw-alias-state-error-primary)" },
              onClick: confirm,
            }, busy ? t("deleting") : t("deleteForever")),
          ),
          children: [
            React.createElement("p", { key: "warn", style: { margin: 0 } }, t("bodyPurge")),
            error !== null && React.createElement("p", {
              key: "error",
              role: "alert",
              style: { margin: "8px 0 0", color: "var(--dsw-alias-state-error-primary)" },
            }, error),
          ],
        });
      }

      function DeleteOverlay(props) {
        const { useDeleteStore: useStore, actions: act } = props;
        const state = useStore();
        const pending = state.pending;
        const bulkConfirm = state.bulkConfirm === true;
        const bulkIds = state.selection === undefined || state.selection === null ? [] : [...state.selection];
        const toast = state.toast;
        const message = toast === null || toast === undefined ? null : toast.message;

        React.useEffect(() => {
          if (message === null) return undefined;
          const timer = setTimeout(() => act.clearToast(), TOAST_MS);
          return () => clearTimeout(timer);
        }, [message, act]);

        return React.createElement(
          React.Fragment,
          null,
          React.createElement(WorkspaceHeaderMenu, { key: "menu", actions: act, useDeleteStore: useStore }),
          state.bulkOpen === true
            ? React.createElement(BulkDeleteDialog, { key: "bulk", actions: act, useDeleteStore: useStore })
            : null,
          bulkConfirm && bulkIds.length > 0
            ? React.createElement(BulkConfirmForm, { key: "bulk", actions: act, sessionIds: bulkIds })
            : null,
          pending === null || pending === undefined
            ? null
            : React.createElement(DeleteConfirmForm, {
              key: pending.sessionId,
              sessionId: pending.sessionId,
              displayTitle: pending.displayTitle,
              artifactExists: pending.artifactExists,
              actions: act,
            }),
          message === null
            ? null
            : React.createElement("div", {
              role: "status",
              style: {
                position: "fixed",
                top: 20,
                left: "50%",
                transform: "translateX(-50%)",
                zIndex: 80,
                padding: "8px 14px",
                borderRadius: 8,
                maxWidth: "70vw",
                fontSize: 13,
                background: "var(--dsw-alias-bg-module-platform)",
                color: "var(--dsw-alias-label-primary)",
                border: "1px solid var(--dsw-alias-border-l3)",
                boxShadow: "0 8px 28px rgba(0,0,0,.2)",
              },
            }, message),
        );
      }

      return {
        store,
        actions,
        useDeleteStore,
        useLocaleRevision,
        DeleteSessionMenuItem,
        BulkDeleteMenuItem,
        BulkDeleteDialog,
        DeleteOverlay,
        RetryAssistantAction,
        SessionSelectAction,
        mountWorkspaceMenu,
        WorkspaceHeaderMenu,
        mountUserRetryButtons,
        retryByMessageId,
        retryByText,
        loadSessionRows,
        deleteMany,
      };
    }

    function apply(ctx) {
      // 规范:UI 文案注册进 Client locale 服务;服务缺席时翻译函数退回 zh 字典
      const locale = localeService(ctx);
      registerLocaleDicts(ctx, locale);
      const t = createTranslator(locale);
      const plugin = createSessionDeletePlugin(ctx, t, locale);
      const injectFace = () => ({
        actions: plugin.actions,
        useDeleteStore: plugin.useDeleteStore,
        retryByMessageId: plugin.retryByMessageId,
        retryByText: plugin.retryByText,
        loadSessionRows: plugin.loadSessionRows,
        deleteMany: plugin.deleteMany,
      });

      ctx.slots.inject("sidebar.workspaces.session.menu.item", () => ctx.slots.register({
        name: "sidebar.workspaces.session.menu.item",
        id: `${NS}.delete-session`,
        order: MENU_ORDER,
        inject: injectFace,
      }, plugin.DeleteSessionMenuItem));

      // 同一个官方「…」菜单里的第二项:批量删除会话(官方 MenuItemButton,观感与原生一致)
      ctx.slots.inject("sidebar.workspaces.session.menu.item", () => ctx.slots.register({
        name: "sidebar.workspaces.session.menu.item",
        id: `${NS}.bulk-delete`,
        order: MENU_ORDER + 10,
        inject: injectFace,
      }, plugin.BulkDeleteMenuItem));

      ctx.slots.inject("shell.overlay", () => ctx.slots.register({
        name: "shell.overlay",
        id: `${NS}.overlay`,
        inject: injectFace,
      }, plugin.DeleteOverlay));

      // AI 回复行的「重试」:官方插槽,条目排在官方反馈(10)之后,位于复制按钮右侧
      ctx.slots.inject("conversation.chat.assistant-actions", () => ctx.slots.register({
        name: "conversation.chat.assistant-actions",
        id: `${NS}.retry-assistant`,
        order: 20,
        inject: injectFace,
      }, plugin.RetryAssistantAction));


      // 工作区标题行的「⋯」菜单 + 批量删除的样式(容器/控件一律内联主题 token,
      // 只有 hover / 弹层这些状态需要样式表)
      ctx.effect(() => {
        const style = document.createElement("style");
        style.setAttribute("data-plugin", `${NS}-bulk`);
        style.textContent = [
          `.${NS}-select-button{display:inline-flex;align-items:center;justify-content:center;border:0;background:transparent;`,
          `color:var(--dsw-alias-label-secondary);cursor:pointer;padding:2px;border-radius:4px;}`,
          `.${NS}-select-button:hover:not([disabled]){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}`,
          `.${NS}-select-button[aria-pressed="true"]{color:var(--dsw-alias-state-error-primary);}`,
          `.${NS}-select-button[disabled]{opacity:.35;cursor:default;}`,
          `.${NS}-menu-trigger{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;`,
          `padding:0;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-secondary);`,
          `font-size:15px;line-height:1;cursor:pointer;}`,
          `.${NS}-menu-trigger:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}`,
          `.${NS}-menu-item{display:flex;align-items:center;gap:8px;width:100%;height:30px;padding:0 8px;`,
          `border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-primary);`,
          `font:inherit;font-size:13px;line-height:1;text-align:left;white-space:nowrap;cursor:pointer;}`,
          `.${NS}-menu-item:hover{background:var(--dsw-alias-interactive-bg-hover);}`,
          `.${NS}-menu-item[data-danger="1"]{color:var(--dsw-alias-state-error-primary);}`,
          `.${NS}-menu-item[data-danger="1"] > span:first-child{color:var(--dsw-alias-state-error-primary);}`,
          `.${NS}-menu-item:focus-visible{outline:2px solid var(--dsw-alias-border-focus,var(--dsw-alias-label-secondary));outline-offset:-2px;}`,
        ].join("");
        document.head.appendChild(style);
        return () => style.remove();
      }, `${NS}: bulk delete styles`);

      // 用户消息行的「重试」:官方无对应插槽,DOM 注入到复制按钮右侧
      ctx.effect(() => plugin.mountUserRetryButtons(), `${NS}: user message retry buttons`);

      // 「工作区」标题行右侧的「⋯」:搜索 / 视图选项 / 批量删除 收成一个菜单
      ctx.effect(() => plugin.mountWorkspaceMenu(), `${NS}: workspace header menu`);

      // 侧栏勾选:官方会话行的 hover 按钮条(批量模式下出现)
      ctx.slots.inject("sidebar.workspaces.session.row.action", () => ctx.slots.register({
        name: "sidebar.workspaces.session.row.action",
        id: `${NS}.select-row`,
        order: SELECT_ACTION_ORDER,
        inject: injectFace,
      }, plugin.SessionSelectAction));

    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});