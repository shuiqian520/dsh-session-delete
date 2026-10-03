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
      IconTrashOutlineRegular,
      MenuItemButton,
      Modal,
    } = require("@deepseek-ai/dsh-client-ui-primitives");

    const NS = "dsh-session-delete";
    const MENU_ORDER = 900;
    /** 设置页里的位置:排在官方与常见插件之后,做一个"维护工具"该待的位置。 */
    const BULK_SECTION_ORDER = 60;
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
        modalClose: "关闭",
        modalTitle: "永久删除此会话",
        cancel: "取消",
        deleting: "删除中…",
        deleteForever: "永久删除",
        bodyGhost: "该会话的产物已不存在,本次只把它从会话列表与工作区中彻底清除。",
        bodyPurge: "该会话的日志与记录会被永久删除,无法恢复;保存在该会话上的数据也会一并消失。",
        bulkNavLabel: "批量删除会话",
        bulkTitle: "批量删除会话",
        bulkIntro: "勾选要永久删除的会话。运行中的会话不能删除,会显示为不可选。",
        bulkFilter: "筛选标题或会话 id…",
        bulkSelectAll: "全选可删除的",
        bulkClear: "清除选择",
        bulkRefresh: "刷新",
        bulkCount: "共 {total} 个会话,可删除 {deletable} 个",
        bulkSelected: "已选 {count} 个",
        bulkEmpty: "没有符合条件的会话",
        bulkNothingSelected: "没有选中任何会话",
        bulkLoading: "正在读取会话…",
        bulkLoadFailed: "读取会话列表失败:{message}",
        bulkRunning: "运行中",
        bulkArtifactGone: "日志已不存在",
        bulkNoTitle: "(无标题会话)",
        bulkDeleteButton: "删除选中的 {count} 个会话",
        bulkConfirmTitle: "永久删除 {count} 个会话",
        bulkConfirmBody: "这些会话的日志与记录会被永久删除,无法恢复;保存在它们上面的数据也会一并消失。",
        bulkConfirmMore: "……等共 {count} 个",
        bulkWorking: "正在删除…",
        bulkResult: "已删除 {deleted} 个会话",
        bulkResultSkipped: ",{failed} 个未删除",
        bulkCapNote: "一次最多 200 个,超出请分批。",
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
        modalClose: "Close",
        modalTitle: "Permanently delete this session",
        cancel: "Cancel",
        deleting: "Deleting…",
        deleteForever: "Delete permanently",
        bodyGhost: "The session log no longer exists; this only removes it from the session list and workspace.",
        bodyPurge: "The session log and records are deleted permanently and cannot be recovered; data stored on this session disappears too.",
        bulkNavLabel: "Bulk delete sessions",
        bulkTitle: "Bulk delete sessions",
        bulkIntro: "Tick the sessions to delete permanently. A running session cannot be deleted and is shown as unselectable.",
        bulkFilter: "Filter by title or session id…",
        bulkSelectAll: "Select all deletable",
        bulkClear: "Clear selection",
        bulkRefresh: "Refresh",
        bulkCount: "{total} sessions, {deletable} deletable",
        bulkSelected: "{count} selected",
        bulkEmpty: "No sessions match",
        bulkNothingSelected: "No sessions selected",
        bulkLoading: "Loading sessions…",
        bulkLoadFailed: "Could not load the session list: {message}",
        bulkRunning: "running",
        bulkArtifactGone: "log already gone",
        bulkNoTitle: "(untitled session)",
        bulkDeleteButton: "Delete {count} selected sessions",
        bulkConfirmTitle: "Permanently delete {count} sessions",
        bulkConfirmBody: "Their logs and records are deleted permanently and cannot be recovered; data stored on them disappears too.",
        bulkConfirmMore: "…and {count} in total",
        bulkWorking: "Deleting…",
        bulkResult: "Deleted {deleted} sessions",
        bulkResultSkipped: ", {failed} not deleted",
        bulkCapNote: "Up to 200 at a time.",
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
      const store = createMiniStore({ pending: null, toast: null });
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

      /** 批量删除页的数据源:host 用官方 sessionQuery 列出的会话清单。 */
      async function loadSessionRows() {
        const response = await fetch("/api/session-delete/sessions", { headers: { accept: "application/json" } });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload && payload.error ? String(payload.error) : `HTTP ${response.status}`);
        }
        return Array.isArray(payload.sessions) ? payload.sessions : [];
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

      /** 时间戳 → 本地可读时间(浏览器 locale)。 */
      function formatTime(value) {
        if (typeof value !== "number" || !Number.isFinite(value)) return "";
        try {
          return new Date(value).toLocaleString();
        } catch {
          return new Date(value).toISOString();
        }
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

      // ---- 批量删除(官方 settings.section 承载的多选页)-------------------------

      const bulkStyles = {
        root: { display: "flex", flexDirection: "column", gap: 12, maxWidth: 760 },
        title: { margin: 0, fontSize: 15, fontWeight: 600, color: "var(--dsw-alias-label-primary)" },
        intro: { margin: 0, fontSize: 12, lineHeight: "18px", color: "var(--dsw-alias-label-caption)" },
        toolbar: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" },
        input: {
          flex: "1 1 200px",
          minWidth: 0,
          padding: "4px 8px",
          borderRadius: 6,
          border: "1px solid var(--dsw-alias-border-l3)",
          background: "transparent",
          color: "var(--dsw-alias-label-primary)",
          font: "inherit",
        },
        list: { maxHeight: 380, overflowY: "auto", border: "1px solid var(--dsw-alias-border-l3)", borderRadius: 8 },
        rowTitle: { flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
        meta: { flex: "0 0 auto", fontSize: 12, color: "var(--dsw-alias-label-caption)" },
        footer: { display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" },
        note: { fontSize: 12, color: "var(--dsw-alias-label-caption)" },
      };

      /** 批量删除页:清单来自 host,运行中的会话不可勾选。 */
      function BulkDeleteSection(props) {
        const { actions: act } = props;
        useLocaleRevision();
        const stateValue = React.useState({ phase: "loading", rows: [], error: null });
        const view = stateValue[0];
        const setView = stateValue[1];
        const selectionValue = React.useState(() => new Set());
        const selected = selectionValue[0];
        const setSelected = selectionValue[1];
        const filterValue = React.useState("");
        const filter = filterValue[0];
        const setFilter = filterValue[1];
        const busyValue = React.useState(false);
        const busy = busyValue[0];
        const setBusy = busyValue[1];
        const confirmValue = React.useState(null);
        const confirming = confirmValue[0];
        const setConfirming = confirmValue[1];

        const reload = React.useCallback(() => {
          setView((current) => (current.rows.length === 0
            ? { phase: "loading", rows: [], error: null }
            : { ...current, error: null }));
          loadSessionRows().then(
            (rows) => setView({ phase: "ready", rows, error: null }),
            (error) => setView({ phase: "error", rows: [], error: error && error.message ? error.message : String(error) }),
          );
        }, []);

        React.useEffect(() => {
          reload();
        }, [reload]);

        const rows = view.rows;
        const needle = filter.trim().toLowerCase();
        const visible = needle === ""
          ? rows
          : rows.filter((row) => String(row.title ?? "").toLowerCase().includes(needle)
            || String(row.sessionId ?? "").toLowerCase().includes(needle));
        const deletableVisible = visible.filter((row) => row.deletable !== false);
        const selectedIds = [...selected].filter((id) => rows.some((row) => row.sessionId === id && row.deletable !== false));

        const toggle = (sessionId) => {
          if (busy) return;
          setSelected((current) => {
            const next = new Set(current);
            if (next.has(sessionId)) next.delete(sessionId);
            else next.add(sessionId);
            return next;
          });
        };
        const selectAll = () => {
          if (busy) return;
          setSelected(new Set(deletableVisible.map((row) => row.sessionId)));
        };
        const clearAll = () => {
          if (busy) return;
          setSelected(new Set());
        };

        const runDelete = (ids) => {
          setBusy(true);
          deleteMany(ids).then((payload) => {
            const deleted = typeof payload.deleted === "number" ? payload.deleted : ids.length;
            const failed = typeof payload.failed === "number" ? payload.failed : 0;
            const message = t("bulkResult", { deleted })
              + (failed > 0 ? t("bulkResultSkipped", { failed }) : "");
            setBusy(false);
            setConfirming(null);
            setSelected(new Set());
            act.settle(message);
            reload();
          }).catch((error) => {
            setBusy(false);
            act.notify(t("retryFailed", { message: error && error.message ? error.message : String(error) }));
          });
        };

        const rowNode = (row) => {
          const selectable = row.deletable !== false && !busy;
          const meta = [
            row.running ? t("bulkRunning") : null,
            row.artifactExists === false ? t("bulkArtifactGone") : null,
            formatTime(row.createdAt),
          ].filter((part) => part !== null && part !== "").join(" · ");
          return React.createElement("label", {
            key: row.sessionId,
            className: `${NS}-bulk-row`,
            style: { opacity: row.deletable === false ? 0.55 : 1, cursor: selectable ? "pointer" : "default" },
          }, [
            React.createElement("input", {
              key: "box",
              type: "checkbox",
              checked: selected.has(row.sessionId),
              disabled: !selectable,
              onChange: () => toggle(row.sessionId),
            }),
            React.createElement("span", {
              key: "title",
              style: bulkStyles.rowTitle,
              title: row.title || row.sessionId,
            }, row.title || t("bulkNoTitle")),
            React.createElement("span", { key: "meta", style: bulkStyles.meta }, meta),
          ]);
        };

        const confirmFooter = confirming === null ? null : React.createElement(
          React.Fragment,
          null,
          React.createElement(Button, {
            variant: "outline",
            disabled: busy,
            onClick: () => setConfirming(null),
          }, t("cancel")),
          React.createElement(Button, {
            variant: "outline",
            disabled: busy,
            style: { color: "var(--dsw-alias-state-error-primary)" },
            onClick: () => runDelete(confirming.ids),
          }, busy ? t("bulkWorking") : t("deleteForever")),
        );

        return React.createElement("div", { style: bulkStyles.root }, [
          React.createElement("h3", { key: "title", style: bulkStyles.title }, t("bulkTitle")),
          React.createElement("p", { key: "intro", style: bulkStyles.intro }, t("bulkIntro")),
          React.createElement("div", { key: "toolbar", style: bulkStyles.toolbar }, [
            React.createElement("input", {
              key: "filter",
              type: "search",
              value: filter,
              placeholder: t("bulkFilter"),
              "aria-label": t("bulkFilter"),
              style: bulkStyles.input,
              onChange: (event) => setFilter(event && event.target ? event.target.value : ""),
            }),
            React.createElement(Button, { key: "all", variant: "outline", disabled: busy || deletableVisible.length === 0, onClick: selectAll }, t("bulkSelectAll")),
            React.createElement(Button, { key: "clear", variant: "outline", disabled: busy || selected.size === 0, onClick: clearAll }, t("bulkClear")),
            React.createElement(Button, { key: "refresh", variant: "outline", disabled: busy, onClick: reload }, t("bulkRefresh")),
          ]),
          React.createElement("div", { key: "count", style: bulkStyles.note }, view.phase === "error"
            ? t("bulkLoadFailed", { message: view.error ?? "" })
            : t("bulkCount", {
              total: rows.length,
              deletable: rows.filter((row) => row.deletable !== false).length,
            })),
          React.createElement("div", { key: "list", style: bulkStyles.list },
            view.phase === "loading" && rows.length === 0
              ? React.createElement("div", { style: { padding: "8px 10px", ...bulkStyles.note } }, t("bulkLoading"))
              : visible.length === 0
                ? React.createElement("div", { style: { padding: "8px 10px", ...bulkStyles.note } }, t("bulkEmpty"))
                : visible.map(rowNode)),
          React.createElement("div", { key: "footer", style: bulkStyles.footer }, [
            React.createElement(Button, {
              key: "delete",
              variant: "outline",
              disabled: busy || selectedIds.length === 0,
              style: { color: "var(--dsw-alias-state-error-primary)" },
              onClick: () => setConfirming({ ids: selectedIds }),
            }, t("bulkDeleteButton", { count: selectedIds.length })),
            React.createElement("span", { key: "note", style: bulkStyles.note }, t("bulkCapNote")),
          ]),
          confirming === null ? null : React.createElement(Modal, {
            key: "confirm",
            open: true,
            onClose: () => setConfirming(null),
            closeLabel: t("modalClose"),
            title: t("bulkConfirmTitle", { count: confirming.ids.length }),
            description: confirming.ids.slice(0, 8).map((id) => {
              const row = rows.find((item) => item.sessionId === id);
              return (row && row.title) || id;
            }).join("\n"),
            footer: confirmFooter,
            children: [
              React.createElement("p", { key: "warn", style: { margin: 0 } }, t("bulkConfirmBody")),
              confirming.ids.length > 8
                ? React.createElement("p", { key: "more", style: { margin: "8px 0 0", color: "var(--dsw-alias-label-caption)" } },
                  t("bulkConfirmMore", { count: confirming.ids.length }))
                : null,
            ],
          }),
        ]);
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

      function DeleteOverlay(props) {
        const { useDeleteStore: useStore, actions: act } = props;
        const state = useStore();
        const pending = state.pending;
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
        DeleteOverlay,
        RetryAssistantAction,
        BulkDeleteSection,
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

      // 批量删除:官方 settings.section(一个注册项 = 一个设置页)。
      // label 传 thunk —— 官方在每次投影时重读它,所以切语言后导航文案自动跟随,
      // 不需要重新注册。
      ctx.slots.inject("settings.section", () => ctx.slots.register({
        name: "settings.section",
        id: `${NS}.bulk-delete`,
        order: BULK_SECTION_ORDER,
        label: () => t("bulkNavLabel"),
        inject: injectFace,
      }, plugin.BulkDeleteSection));

      // 批量删除页自己的行样式(容器/控件一律内联主题 token,只有 hover 需要样式表)
      ctx.effect(() => {
        const style = document.createElement("style");
        style.setAttribute("data-plugin", `${NS}-bulk`);
        style.textContent = [
          `.${NS}-bulk-row{display:flex;gap:8px;align-items:center;padding:6px 10px;`,
          `border-bottom:1px solid var(--dsw-alias-border-l3);}`,
          `.${NS}-bulk-row:last-child{border-bottom:0;}`,
          `.${NS}-bulk-row:hover{background:var(--dsw-alias-interactive-bg-hover);}`,
        ].join("");
        document.head.appendChild(style);
        return () => style.remove();
      }, `${NS}: bulk delete styles`);

      // 用户消息行的「重试」:官方无对应插槽,DOM 注入到复制按钮右侧
      ctx.effect(() => plugin.mountUserRetryButtons(), `${NS}: user message retry buttons`);
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
