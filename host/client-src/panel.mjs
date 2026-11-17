/**
 * dsh-mobile-bridge — DSH client panel.
 *
 * The PC-side control surface lives inside DSH instead of a standalone web
 * page. It talks to the local bridge HTTP API (loopback only) and is exposed
 * in two slots: the sidebar footer button and Settings → Plugins.
 */
window.__ModuleLoader__.load({
  id: "dsh-mobile-bridge",
  factory: (require) => {
    const React = require("react")
    const { useCallback, useEffect, useRef, useState } = React
    const h = React.createElement
    let ReactDOM = null
    try {
      ReactDOM = require("react-dom")
    } catch (_) {
      ReactDOM = null
    }

    const BRIDGE_PORT = 48123
    const BASE = `http://127.0.0.1:${BRIDGE_PORT}`
/* __CLIENT_STYLES__ */


    async function api(path, init) {
      const response = await fetch(BASE + path, {
        cache: "no-store",
        ...(init || {}),
      })
      const text = await response.text()
      let data = null
      try {
        data = text ? JSON.parse(text) : null
      } catch (_) {
        data = null
      }
      if (!response.ok) {
        const message = data && data.error && data.error.message ? data.error.message : `HTTP ${response.status}`
        const error = new Error(message)
        error.status = response.status
        throw error
      }
      return data
    }

/* __CLIENT_HELPERS__ */

/* __CLIENT_COMPONENTS__ */


    /**
     * 宿主兼容性横幅。探针在 DSH 启动时跑一次，结果随 /api/setup/state 下发：
     * ok=false 说明必需接口缺失/签名变了，主链路是坏的；只有 warnings 说明是降级。
     */
    function compatNotice(snap) {
      const compat = snap && snap.compatibility ? snap.compatibility : null
      if (compat === null) return null
      const problems = Array.isArray(compat.problems) ? compat.problems : []
      const warnings = Array.isArray(compat.warnings) ? compat.warnings : []
      const fatal = compat.ok !== true
      if (!fatal && warnings.length === 0) return null
      const lines = fatal ? problems : warnings
      // 只有「真的不兼容」才用红色告警；单纯降级用中性提示，别把可选能力缺失渲染成故障。
      return h(
        "div",
        fatal ? { className: "dmb-alert" } : { className: "dmb-notice" },
        h(
          "div",
          { style: { fontWeight: 600, marginBottom: 4 } },
          fatal ? "宿主接口不兼容，部分功能不可用" : "宿主接口有降级（不影响主链路）",
        ),
        h("div", null, String(compat.summary || "")),
        lines.length > 0
          ? h(
              "ul",
              { style: { margin: "6px 0 0", paddingLeft: 18, lineHeight: 1.5 } },
              lines.map((line, index) => h("li", { key: index }, String(line))),
            )
          : null,
        h(
          "div",
          { style: { marginTop: 6, opacity: 0.8 } },
          fatal
            ? "手机端的任务/审批等功能会跟着失效。换回与该桥接版本匹配的 DSH，或升级桥接后重启桌面端。"
            : "主链路仍可用；上面这些功能会缺。完整清单见「运行日志」，重启 DSH 会重新检查。",
        ),
      )
    }

    function PanelBody({ embedded, onClose }) {
      const [snap, setSnap] = useState(null)
      const [form, setForm] = useState(null)
      const [error, setError] = useState("")
      const [actionError, setActionError] = useState(null)
      const [saved, setSaved] = useState("")
      const [busy, setBusy] = useState("")
      const [now, setNow] = useState(Date.now())
      const csrf = useRef("")
      const [tsHost, setTsHost] = useState("")
      const [tsDir, setTsDir] = useState("")
      const [tsKey, setTsKey] = useState("")
      const [tsOpen, setTsOpen] = useState(false)
      const [groupUrl, setGroupUrl] = useState("")
      const [groupCode, setGroupCode] = useState("")
      const [logOpen, setLogOpen] = useState(false)
      const [logText, setLogText] = useState("")
      const [logBusy, setLogBusy] = useState(false)

      const load = useCallback(async () => {
        try {
          const data = await api("/api/setup/state")
          csrf.current = data.csrf || ""
          setSnap(data)
          setError("")
          setTsHost((current) => current || data.tailscale?.hostname || "")
          setTsDir((current) => current || data.tailscale?.stateDir || "")
          setForm((current) => current || {
            phoneFirst: data.settings.phoneFirst !== false,
            discovery: data.settings.discovery !== false,
            approvalTimeoutMs: data.settings.approvalTimeoutMs || 120000,
            questionTimeoutMs: data.settings.questionTimeoutMs || 120000,
            planReviewTimeoutMs: data.settings.planReviewTimeoutMs || 180000,
            collabWorkspaceId: data.settings.collabWorkspaceId || "",
            collabRoot: data.settings.collabRoot || "",
            workspaceRoot: data.settings.workspaceRoot || "",
          })
        } catch (cause) {
          setError(`${cause.message || "桥接未响应"}（${BASE}）`)
        }
      }, [])

      useEffect(() => {
        void load()
        const poll = setInterval(() => {
          if (typeof document === "undefined" || document.visibilityState !== "hidden") void load()
        }, 3000)
        return () => clearInterval(poll)
      }, [load])

      useEffect(() => {
        const tick = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(tick)
      }, [])

      useEffect(() => {
        if (!saved) return undefined
        const timer = setTimeout(() => setSaved(""), 2200)
        return () => clearTimeout(timer)
      }, [saved])

      const post = useCallback(
        async (label, path, body) => {
          setBusy(label)
          setActionError(null)
          try {
            const result = await api(path, {
              method: "POST",
              headers: { "content-type": "application/json", "x-dsh-csrf": csrf.current },
              body: JSON.stringify(body || {}),
            })
            await load()
            setActionError(null)
            return result
          } catch (cause) {
            // 操作失败只写进 actionError：它常驻在对应卡片里，且不会被 3 秒轮询清掉，
            // 也不会把顶部状态灯带成「桥接未运行」。
            setActionError({ label, message: cause.message || "操作失败" })
            return null
          } finally {
            setBusy("")
          }
        },
        [load],
      )

      const refreshCode = useCallback(async () => {
        setBusy("code")
        setActionError(null)
        try {
          const result = await api("/api/setup/code", {
            method: "POST",
            headers: { "content-type": "application/json", "x-dsh-csrf": csrf.current },
            body: "{}",
          })
          setSnap((current) => (current ? { ...current, code: result.code, codeExpiresAt: result.expiresAt } : current))
        } catch (cause) {
          setActionError({ label: "code", message: cause.message || "刷新配对码失败" })
        } finally {
          setBusy("")
        }
      }, [])

      const saveSettings = useCallback(async () => {
        if (!form) return
        const result = await post("save", "/api/setup/settings", form)
        if (result) setSaved("已保存")
      }, [form, post])

      const copyDeviceId = useCallback(async () => {
        if (!snap || !navigator.clipboard) return
        try {
          await navigator.clipboard.writeText(snap.deviceId || "")
          setSaved("设备 ID 已复制")
        } catch (_) {
          setSaved("复制失败")
        }
      }, [snap])

      // 只查 GitHub 上最新的 release，不自动下载：PC 侧要升级还得重装插件包。
      const checkUpdate = useCallback(async () => {
        await post("update", "/api/setup/update", { force: true })
      }, [post])

      // 日志导出走 loopback 的 /api/setup/logs：PC 面板和桥接同机，不需要 token。
      const loadLogs = useCallback(async () => {
        setLogBusy(true)
        try {
          const response = await fetch(`${BASE}/api/setup/logs?lines=600`, { cache: "no-store" })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          setLogText(await response.text())
        } catch (cause) {
          setLogText(`读取日志失败：${cause.message || cause}`)
        } finally {
          setLogBusy(false)
        }
      }, [])

      const toggleLogs = useCallback(() => {
        setLogOpen((open) => {
          if (!open) void loadLogs()
          return !open
        })
      }, [loadLogs])

      const copyLogs = useCallback(async () => {
        if (!navigator.clipboard) return
        try {
          await navigator.clipboard.writeText(logText)
          setSaved("运行日志已复制")
        } catch (_) {
          setSaved("复制失败")
        }
      }, [logText])

      const copyEndpoint = useCallback(async (endpoint) => {
        if (!navigator.clipboard) return
        try {
          await navigator.clipboard.writeText(`${endpoint.address}:${snap?.port ?? ""}`)
          setSaved(endpoint.kind === "tailscale" ? "Tailscale 地址已复制" : "局域网地址已复制")
        } catch (_) {
          setSaved("复制失败")
        }
      }, [snap])

      const left = snap && snap.codeExpiresAt
        ? Math.max(0, Math.floor((new Date(snap.codeExpiresAt).getTime() - now) / 1000))
        : 0
      const total = 120
      const percent = Math.max(0, Math.min(100, (left / total) * 100))
      const online = Boolean(snap) && !error
      const actionLabel = actionError ? String(actionError.label || "") : ""
      const groupError = actionLabel.startsWith("group") ? actionError.message : ""
      const settingsError = actionLabel === "save" || actionLabel.startsWith("ts") ? actionError.message : ""
      const updateError = actionLabel === "update" ? actionError.message : ""
      const otherError = actionError !== null && groupError === "" && settingsError === "" && updateError === "" ? actionError.message : ""
      const ts = snap ? snap.tailscale ?? null : null
      const tsPhase = ts ? ts.phase || "off" : "off"
      const tsEnabled = ts ? ts.enabled === true : false
      const tsLog = ts && Array.isArray(ts.log) ? ts.log : []
      const update = snap && snap.update ? snap.update : null

      return h(
        "div",
        null,
        !embedded
          ? h(
              "div",
              { className: "dmb-head" },
              h(
                "div",
                null,
                h("div", { className: "dmb-title" }, "手机远控"),
                h("div", { className: "dmb-sub" }, "DSH 局域网桥接 · Android 配对与设备管理"),
              ),
              h("button", { className: "dmb-close", onClick: onClose, "aria-label": "关闭", title: "关闭" }, "×"),
            )
          : null,
        h(
          "div",
          { className: "dmb-body", style: embedded ? { padding: 0, gap: 14 } : null },
          h(
            "div",
            { style: { display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" } },
            h(Status, { ok: online, text: online ? `桥接运行中 · ${BRIDGE_PORT}` : "桥接未运行" }),
            snap ? h("span", { className: "dmb-sub" }, `${snap.clients || 0} 台手机在线`) : null,
          ),
          error ? h("div", { className: "dmb-alert" }, `${error}。DSH 里的桥接服务没有响应，重启桌面端后再看这里。`) : null,
          otherError ? h("div", { className: "dmb-alert" }, otherError) : null,
          snap ? compatNotice(snap) : null,
          snap
            ? h(
                "div",
                { className: "dmb-card" },
                h(
                  "div",
                  { className: "dmb-grid" },
                  h("div", null, h("div", { className: "dmb-label" }, "设备 ID"), h("div", { className: "dmb-value dmb-mono" }, snap.deviceId || "—")),
                  h("div", null, h("div", { className: "dmb-label" }, "主机名"), h("div", { className: "dmb-value" }, snap.hostName || "—")),
                  h("div", null, h("div", { className: "dmb-label" }, "服务端口"), h("div", { className: "dmb-value dmb-mono" }, String(snap.port || "—"))),
                  h("div", null, h("div", { className: "dmb-label" }, "已连接手机"), h("div", { className: "dmb-value" }, `${snap.clients || 0} 台`)),
                ),
                h(
                  "div",
                  { className: "dmb-ips" },
                  (snap.endpoints || []).map((endpoint) =>
                    h(
                      "button",
                      {
                        key: endpoint.url,
                        className: "dmb-chip dmb-mono",
                        title: "点击复制地址",
                        onClick: () => copyEndpoint(endpoint),
                      },
                      `${endpoint.kind === "tailscale" ? "Tailscale" : "局域网"} ${endpoint.address}:${snap.port}`,
                    ),
                  ),
                  h("button", { className: "dmb-btn", onClick: copyDeviceId, disabled: busy !== "" }, "复制设备 ID"),
                ),
                h(
                  "div",
                  { className: "dmb-sub", style: { marginTop: 8, lineHeight: 1.6 } },
                  "手机在局域网内会自动走局域网地址；离开局域网后，如果手机和电脑登录同一个 Tailscale，会自动切换到 Tailscale 地址。",
                ),
              )
            : null,
          snap && ts
            ? h(TailscaleCard, {
                ts,
                busy,
                phase: tsPhase,
                enabled: tsEnabled,
                host: tsHost,
                dir: tsDir,
                authKey: tsKey,
                log: tsLog,
                open: tsOpen,
                hasKey: Boolean(snap.settings?.hasTailscaleAuthKey),
                onToggle: async (next) => {
                  await post("ts-toggle", "/api/setup/tailscale", { action: next ? "enable" : "disable" })
                },
                onHostChange: setTsHost,
                onHostCommit: async () => {
                  const value = tsHost.trim()
                  if (value === "" || value === (ts.hostname || "")) return
                  await post("ts-host", "/api/setup/tailscale", { action: "hostname", value })
                },
                onDirChange: setTsDir,
                onDirCommit: async () => {
                  const value = tsDir.trim()
                  if (value === (ts.stateDir || "")) return
                  await post("ts-dir", "/api/setup/tailscale", { action: "statedir", value })
                },
                onKeyChange: setTsKey,
                onKeySave: async () => {
                  const value = tsKey.trim()
                  if (value === "") return
                  if (await post("ts-key", "/api/setup/tailscale", { action: "authkey", value })) setTsKey("")
                },
                onRestart: async () => {
                  await post("ts-restart", "/api/setup/tailscale", { action: "restart" })
                },
                onToggleLog: () => setTsOpen(!tsOpen),
              })
            : null,
          snap
            ? h(
                "div",
                { className: "dmb-card dmb-pair" },
                h(
                  "div",
                  null,
                  h("div", { className: "dmb-label" }, "配对码"),
                  h("div", { className: "dmb-code" }, formatCode(snap.code)),
                  h("div", { className: "dmb-count" }, left > 0 ? `剩余 ${left} 秒，配对成功后自动轮换` : "已过期，点击刷新"),
                  h("div", { className: "dmb-bar" }, h("i", { style: { width: `${percent}%` } })),
                ),
                h(
                  "div",
                  { className: "dmb-actions" },
                  h("button", { className: "dmb-btn primary", onClick: refreshCode, disabled: busy !== "" }, busy === "code" ? "刷新中…" : "刷新配对码"),
                ),
              )
            : null,
          snap
            ? h(DevicesCard, {
                devices: snap.devices || [],
                busy,
                onRevoke: async (device) => {
                  if (!window.confirm(`撤销 ${device.name || "该设备"} 的配对？`)) return
                  await post("revoke", "/api/setup/revoke", { deviceId: device.id })
                },
              })
            : null,
          snap
            ? h(GroupCard, {
                group: snap.group,
                busy,
                error: groupError,
                saved,
                url: groupUrl,
                code: groupCode,
                onUrlChange: setGroupUrl,
                onCodeChange: setGroupCode,
                onCreate: async () => {
                  const result = await post("group-create", "/api/setup/group", { action: "create" })
                  if (result) setSaved("绑定组已创建")
                },
                onLeave: async () => {
                  if (!window.confirm("退出绑定组？本机将不再与其他 PC 协作。")) return
                  await post("group-leave", "/api/setup/group", { action: "leave" })
                },
                onInvite: async () => {
                  const result = await post("group-invite", "/api/setup/group", { action: "invite" })
                  if (result) setSaved("邀请码已生成")
                },
                onForget: async (peer) => {
                  if (!window.confirm(`把 ${peer.name || peer.deviceId} 移出绑定组？`)) return
                  await post("group-forget", "/api/setup/group", { action: "forget", deviceId: peer.deviceId })
                },
                onJoin: async () => {
                  const parsed = parseGroupUrl(groupUrl)
                  const code = groupCode.replace(/\D/g, "")
                  if (parsed.error !== "") {
                    setActionError({ label: "group-join", message: parsed.error })
                    return
                  }
                  if (code.length !== 6) {
                    setActionError({ label: "group-join", message: "邀请码是 6 位数字，请核对对方面板上的码" })
                    return
                  }
                  const result = await post("group-join", "/api/setup/group", { action: "join", baseUrl: parsed.url, code })
                  if (result) {
                    setGroupUrl("")
                    setGroupCode("")
                    setSaved("已加入绑定组")
                  }
                },
              })
            : null,
          snap && form
            ? h(BridgeSettingsCard, {
                workspaces: snap.workspaces || [],
                form,
                error: settingsError,
                busy,
                saved,
                onPatch: (patch) => setForm({ ...form, ...patch }),
                onSave: saveSettings,
              })
            : null,
          snap
            ? h(LogCard, {
                logsPath: snap.logs?.path,
                open: logOpen,
                busy: logBusy,
                text: logText,
                onToggle: toggleLogs,
                onCopy: copyLogs,
                onRefresh: loadLogs,
                baseUrl: BASE,
              })
            : null,
          snap
            ? h(UpdateCard, {
                version: snap.version,
                update,
                busy,
                error: updateError,
                onCheck: checkUpdate,
              })
            : null,
          snap
            ? h(
                "div",
                { className: "dmb-foot" },
                h("span", null, "撤销全部设备后，所有手机需要重新配对。"),
                h(
                  "button",
                  {
                    className: "dmb-btn danger",
                    disabled: busy !== "",
                    onClick: async () => {
                      if (!window.confirm("撤销全部设备并轮换配对码？")) return
                      await post("reset", "/api/setup/reset")
                    },
                  },
                  "工厂重置",
                ),
              )
            : null,
        ),
      )
    }

    class Guard extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }

      static getDerivedStateFromError(error) {
        return { error }
      }

      componentDidCatch(error) {
        try {
          console.error("[dsh-mobile-bridge] panel crashed:", error)
        } catch (_) {}
      }

      render() {
        if (this.state.error) return this.props.fallback(this.state.error)
        return this.props.children
      }
    }


    function SidebarAction() {
      const [open, setOpen] = useState(false)
      useEffect(() => {
        if (!open) return undefined
        const onKey = (event) => {
          if (event.key === "Escape") setOpen(false)
        }
        window.addEventListener("keydown", onKey)
        return () => window.removeEventListener("keydown", onKey)
      }, [open])

      const dialog = open
        ? h(
            "div",
            {
              className: "dmb-backdrop",
              onMouseDown: (event) => {
                if (event.target === event.currentTarget) setOpen(false)
              },
            },
            h("div", { className: "dmb-panel", role: "dialog", "aria-modal": "true", "aria-label": "手机远控" }, h(Guard, { fallback: (error) => h(ErrorPanel, { error, onClose: () => setOpen(false) }) }, h(PanelBody, { onClose: () => setOpen(false) }))),
          )
        : null

      return h(
        React.Fragment,
        null,
        h("button", { className: "dmb-side", onClick: () => setOpen(true), title: "手机远控" }, h(PhoneIcon), h("span", null, "手机远控")),
        dialog
          ? ReactDOM && typeof ReactDOM.createPortal === "function"
            ? ReactDOM.createPortal(dialog, document.body)
            : dialog
          : null,
      )
    }

    function SafeSidebarAction() {
      return h(
        Guard,
        {
          fallback: (error) =>
            h(
              "button",
              { className: "dmb-side", title: `手机远控面板异常：${String(error?.message || error)}` },
              h(PhoneIcon),
              h("span", null, "手机远控"),
            ),
        },
        h(SidebarAction),
      )
    }

    function SettingsCard() {
      return h("div", { className: "dmb-embedded" }, h(PanelBody, { embedded: true }))
    }

    function SafeSettingsCard(props) {
      // settings.plugins.tab 会为每个 tab 渲染一次 slot，并传入 { only: 该 tab 的 id }。
      const only = props?.only
      if (typeof only === "string" && only !== "dsh-mobile-bridge") return null
      return h(Guard, { fallback: (error) => h(ErrorPanel, { error }) }, h(SettingsCard))
    }

    function apply(ctx) {
      ensureStyle()
      ctx.slots.inject("sidebar.footer.action", () =>
        ctx.slots.register(
          {
            name: "sidebar.footer.action",
            id: "dsh-mobile-bridge-sidebar",
            order: 20,
            inject: () => ({}),
          },
          SafeSidebarAction,
        ),
      )
      // 0.2.x 的「设置 → 内置插件」列表里，单插件视图是 settings.plugins.tab；
      // 旧的 settings.plugin.item 已经没有声明者了。
      ctx.slots.inject("settings.plugins.tab", () =>
        ctx.slots.register(
          {
            name: "settings.plugins.tab",
            id: "dsh-mobile-bridge",
            order: 50,
            label: "dsh-mobile-bridge",
            inject: (props) => ({ only: props?.only ?? null }),
          },
          SafeSettingsCard,
        ),
      )
    }

    /**
     * 测试面：bundle 是单文件、内部组件不导出，单测要渲染 PanelBody 只能从这里拿。
     * 只在 Node 侧的假 window 里被读到，DSH 运行时没有任何代码访问它。
     */
    if (typeof window !== "undefined") {
      window.__DMB_TEST__ = { PanelBody, SidebarAction, SettingsCard, SafeSidebarAction, SafeSettingsCard }
    }

    return { apply, inject: ["slots"] }
  },
})
