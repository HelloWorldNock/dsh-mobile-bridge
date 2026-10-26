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
    const STYLE_ID = "dsh-mobile-bridge-client-css"

    function ensureStyle() {
      if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return
      const style = document.createElement("style")
      style.id = STYLE_ID
      style.textContent = `
.dmb-side{display:flex;align-items:center;gap:8px;width:100%;border:0;background:transparent;color:inherit;font:inherit;padding:8px 10px;border-radius:10px;cursor:pointer;text-align:left}
.dmb-side:hover{background:rgba(77,107,254,.09);color:#4D6BFE}
.dmb-backdrop{position:fixed;inset:0;z-index:1200;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(15,23,42,.36);backdrop-filter:blur(2px)}
.dmb-panel{width:min(720px,94vw);max-height:88vh;overflow:auto;border-radius:18px;background:#fff;color:#0F172A;border:1px solid rgba(15,23,42,.08);box-shadow:0 28px 70px rgba(15,23,42,.24);font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif}
body[data-ds-dark-theme] .dmb-panel{background:#151A23;color:#E8EDF6;border-color:rgba(255,255,255,.1);box-shadow:0 28px 70px rgba(0,0,0,.5)}
.dmb-embedded{border:1px solid rgba(127,127,127,.22);border-radius:16px;padding:18px;background:transparent}
.dmb-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:22px 24px 0}
.dmb-title{font-size:19px;font-weight:650;letter-spacing:.01em}
.dmb-sub{margin-top:4px;font-size:12px;color:#667085}
body[data-ds-dark-theme] .dmb-sub{color:#98A4B8}
.dmb-close{border:0;background:transparent;color:inherit;font-size:22px;line-height:1;cursor:pointer;padding:2px 6px;border-radius:8px;opacity:.65}
.dmb-close:hover{opacity:1;background:rgba(127,127,127,.14)}
.dmb-body{padding:18px 24px 24px;display:flex;flex-direction:column;gap:16px}
.dmb-status{display:inline-flex;align-items:center;gap:7px;font-size:12px;padding:4px 9px;border-radius:999px;background:rgba(22,163,74,.1);color:#16A34A;white-space:nowrap}
.dmb-status.bad{background:rgba(220,38,38,.1);color:#DC2626}
.dmb-dot{width:7px;height:7px;border-radius:50%;background:currentColor}
.dmb-card{border:1px solid rgba(127,127,127,.2);border-radius:14px;padding:16px 18px}
.dmb-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}
.dmb-label{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#667085;margin-bottom:5px}
body[data-ds-dark-theme] .dmb-label{color:#8B97AB}
.dmb-value{font-weight:600;font-size:14px;word-break:break-all}
.dmb-mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
.dmb-ips{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.dmb-chip{font-size:12px;padding:4px 9px;border-radius:8px;background:rgba(77,107,254,.09);color:#4D6BFE}
.dmb-pair{display:flex;align-items:center;justify-content:space-between;gap:18px;flex-wrap:wrap}
.dmb-code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:34px;font-weight:700;letter-spacing:.12em;color:#4D6BFE;line-height:1.1}
.dmb-count{font-size:12px;color:#667085;margin-top:6px}
body[data-ds-dark-theme] .dmb-count{color:#98A4B8}
.dmb-bar{height:4px;border-radius:2px;background:rgba(77,107,254,.16);overflow:hidden;margin-top:8px;width:220px;max-width:100%}
.dmb-bar i{display:block;height:100%;background:#4D6BFE;transition:width .3s linear}
.dmb-actions{display:flex;gap:8px;flex-wrap:wrap}
.dmb-btn{border:1px solid rgba(127,127,127,.28);background:transparent;color:inherit;font:inherit;font-size:13px;padding:7px 12px;border-radius:9px;cursor:pointer}
.dmb-btn:hover{background:rgba(127,127,127,.09)}
.dmb-btn.primary{border-color:#4D6BFE;background:#4D6BFE;color:#fff}
.dmb-btn.primary:hover{background:#3B55D9}
.dmb-btn.danger{color:#DC2626;border-color:rgba(220,38,38,.35)}
.dmb-btn:disabled{opacity:.5;cursor:default}
.dmb-devices{display:flex;flex-direction:column;gap:8px}
.dmb-device{display:flex;align-items:center;gap:10px;padding:9px 11px;border-radius:10px;background:rgba(127,127,127,.07)}
.dmb-device .grow{flex:1;min-width:0}
.dmb-device .name{font-weight:600;font-size:13px}
.dmb-device .meta{font-size:11px;color:#667085;margin-top:2px}
body[data-ds-dark-theme] .dmb-device .meta{color:#98A4B8}
.dmb-empty{font-size:12px;color:#667085;padding:6px 0}
.dmb-setting{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:9px 0;border-bottom:1px solid rgba(127,127,127,.14)}
.dmb-setting:last-child{border-bottom:0}
.dmb-setting .grow{flex:1;min-width:0}
.dmb-setting .name{font-weight:600;font-size:13px}
.dmb-setting .hint{font-size:11px;color:#667085;margin-top:2px}
body[data-ds-dark-theme] .dmb-setting .hint{color:#98A4B8}
.dmb-num{width:88px;padding:6px 8px;border-radius:8px;border:1px solid rgba(127,127,127,.3);background:transparent;color:inherit;font:inherit;text-align:right}
.dmb-switch{appearance:none;-webkit-appearance:none;width:40px;height:24px;border-radius:999px;background:#CBD5E1;position:relative;cursor:pointer;transition:background .16s ease;flex:none}
.dmb-switch::after{content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(15,23,42,.25);transition:transform .16s ease}
.dmb-switch:checked{background:#4D6BFE}
.dmb-switch:checked::after{transform:translateX(16px)}
.dmb-switch:focus-visible{outline:2px solid #4D6BFE;outline-offset:2px}
.dmb-alert{border-radius:10px;padding:10px 12px;font-size:12px;background:rgba(220,38,38,.08);color:#DC2626}
.dmb-foot{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;font-size:11px;color:#667085}
body[data-ds-dark-theme] .dmb-foot{color:#8B97AB}
.dmb-saved{font-size:12px;color:#16A34A}
@media(max-width:720px){.dmb-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
`
      document.head.appendChild(style)
    }

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

    function fmtTime(iso) {
      if (!iso) return "从未"
      const date = new Date(iso)
      if (Number.isNaN(date.getTime())) return "—"
      return date.toLocaleString("zh-CN", { hour12: false })
    }

    function formatCode(code) {
      const raw = String(code || "").replace(/\D/g, "")
      if (raw.length !== 6) return code || "------"
      return raw.slice(0, 3) + "  " + raw.slice(3)
    }

    function PhoneIcon() {
      return h(
        "svg",
        { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true" },
        h("rect", { x: 6, y: 2.5, width: 12, height: 19, rx: 2.6, stroke: "currentColor", strokeWidth: 1.7 }),
        h("path", { d: "M10.5 18.5h3", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" }),
      )
    }

    function Status({ ok, text }) {
      return h(
        "span",
        { className: "dmb-status" + (ok ? "" : " bad") },
        h("span", { className: "dmb-dot" }),
        text,
      )
    }

    function PanelBody({ embedded, onClose }) {
      const [snap, setSnap] = useState(null)
      const [form, setForm] = useState(null)
      const [error, setError] = useState("")
      const [saved, setSaved] = useState("")
      const [busy, setBusy] = useState("")
      const [now, setNow] = useState(Date.now())
      const csrf = useRef("")

      const load = useCallback(async () => {
        try {
          const data = await api("/api/setup/state")
          csrf.current = data.csrf || ""
          setSnap(data)
          setError("")
          setForm((current) => current || {
            phoneFirst: data.settings.phoneFirst !== false,
            discovery: data.settings.discovery !== false,
            approvalTimeoutMs: data.settings.approvalTimeoutMs || 120000,
            questionTimeoutMs: data.settings.questionTimeoutMs || 120000,
            planReviewTimeoutMs: data.settings.planReviewTimeoutMs || 180000,
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
          setError("")
          try {
            const result = await api(path, {
              method: "POST",
              headers: { "content-type": "application/json", "x-dsh-csrf": csrf.current },
              body: JSON.stringify(body || {}),
            })
            await load()
            return result
          } catch (cause) {
            setError(cause.message || "操作失败")
            return null
          } finally {
            setBusy("")
          }
        },
        [load],
      )

      const refreshCode = useCallback(async () => {
        setBusy("code")
        setError("")
        try {
          const result = await api("/api/setup/code", {
            method: "POST",
            headers: { "content-type": "application/json", "x-dsh-csrf": csrf.current },
            body: "{}",
          })
          setSnap((current) => (current ? { ...current, code: result.code, codeExpiresAt: result.expiresAt } : current))
        } catch (cause) {
          setError(cause.message || "刷新配对码失败")
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

      const left = snap && snap.codeExpiresAt
        ? Math.max(0, Math.floor((new Date(snap.codeExpiresAt).getTime() - now) / 1000))
        : 0
      const total = 120
      const percent = Math.max(0, Math.min(100, (left / total) * 100))
      const online = Boolean(snap) && !error

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
          error ? h("div", { className: "dmb-alert" }, error + "。确认 DSH 已加载 dsh-mobile-bridge，并重启过桌面端。") : null,
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
                  (snap.addresses || []).map((item) => h("span", { key: item.address, className: "dmb-chip dmb-mono" }, item.address)),
                  h("button", { className: "dmb-btn", onClick: copyDeviceId, disabled: busy !== "" }, "复制设备 ID"),
                ),
              )
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
            ? h(
                "div",
                { className: "dmb-card" },
                h("div", { className: "dmb-label", style: { marginBottom: 10 } }, "已配对设备"),
                h(
                  "div",
                  { className: "dmb-devices" },
                  (snap.devices || []).filter((device) => !device.revokedAt).length === 0
                    ? h("div", { className: "dmb-empty" }, "还没有设备配对")
                    : (snap.devices || []).filter((device) => !device.revokedAt).map((device) =>
                        h(
                          "div",
                          { className: "dmb-device", key: device.id },
                          h("span", { className: "dmb-dot", style: { color: "#16A34A" } }),
                          h(
                            "div",
                            { className: "grow" },
                            h("div", { className: "name" }, device.name || "Android 设备"),
                            h("div", { className: "meta" }, `${device.model || "未知型号"} · 最近 ${fmtTime(device.lastSeenAt)}`),
                          ),
                          h(
                            "button",
                            {
                              className: "dmb-btn",
                              disabled: busy !== "",
                              onClick: async () => {
                                if (!window.confirm(`撤销 ${device.name || "该设备"} 的配对？`)) return
                                await post("revoke", "/api/setup/revoke", { deviceId: device.id })
                              },
                            },
                            "撤销",
                          ),
                        ),
                      ),
                ),
              )
            : null,
          snap && form
            ? h(
                "div",
                { className: "dmb-card" },
                h("div", { className: "dmb-label", style: { marginBottom: 6 } }, "桥接设置"),
                h(
                  "div",
                  { className: "dmb-setting" },
                  h("div", { className: "grow" }, h("div", { className: "name" }, "手机优先审批"), h("div", { className: "hint" }, "手机在线时由手机处理审批与提问；超时或离线自动交回桌面。")),
                  h("input", { className: "dmb-switch", type: "checkbox", checked: form.phoneFirst, onChange: (event) => setForm({ ...form, phoneFirst: event.target.checked }) }),
                ),
                h(
                  "div",
                  { className: "dmb-setting" },
                  h("div", { className: "grow" }, h("div", { className: "name" }, "局域网发现"), h("div", { className: "hint" }, "允许手机通过 UDP 广播自动找到这台电脑。")),
                  h("input", { className: "dmb-switch", type: "checkbox", checked: form.discovery, onChange: (event) => setForm({ ...form, discovery: event.target.checked }) }),
                ),
                h(
                  "div",
                  { className: "dmb-setting" },
                  h("div", { className: "grow" }, h("div", { className: "name" }, "审批等待"), h("div", { className: "hint" }, "秒；超时后交回桌面处理。")),
                  h("input", { className: "dmb-num", type: "number", min: 5, max: 600, value: Math.round(form.approvalTimeoutMs / 1000), onChange: (event) => setForm({ ...form, approvalTimeoutMs: Number(event.target.value) * 1000 }) }),
                ),
                h(
                  "div",
                  { className: "dmb-setting" },
                  h("div", { className: "grow" }, h("div", { className: "name" }, "提问等待"), h("div", { className: "hint" }, "秒；普通用户问题的等待时间。")),
                  h("input", { className: "dmb-num", type: "number", min: 5, max: 600, value: Math.round(form.questionTimeoutMs / 1000), onChange: (event) => setForm({ ...form, questionTimeoutMs: Number(event.target.value) * 1000 }) }),
                ),
                h(
                  "div",
                  { className: "dmb-setting" },
                  h("div", { className: "grow" }, h("div", { className: "name" }, "计划审阅等待"), h("div", { className: "hint" }, "秒；计划卡片的等待时间。")),
                  h("input", { className: "dmb-num", type: "number", min: 5, max: 600, value: Math.round(form.planReviewTimeoutMs / 1000), onChange: (event) => setForm({ ...form, planReviewTimeoutMs: Number(event.target.value) * 1000 }) }),
                ),
                h(
                  "div",
                  { className: "dmb-actions", style: { marginTop: 12 } },
                  h("button", { className: "dmb-btn primary", onClick: saveSettings, disabled: busy !== "" }, busy === "save" ? "保存中…" : "保存设置"),
                  saved ? h("span", { className: "dmb-saved" }, saved) : null,
                ),
              )
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

    function ErrorPanel({ error, onClose }) {
      return h(
        "div",
        { className: "dmb-panel", style: { padding: 22 } },
        h("div", { className: "dmb-title" }, "手机远控面板加载出错"),
        h("div", { className: "dmb-alert", style: { marginTop: 12 } }, String(error?.message || error)),
        h("button", { className: "dmb-btn", style: { marginTop: 14 }, onClick: onClose }, "关闭"),
      )
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

    function SafeSettingsCard() {
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
      ctx.slots.inject("settings.plugin.item", () =>
        ctx.slots.register(
          {
            name: "settings.plugin.item",
            id: "dsh-mobile-bridge-settings",
            key: "dsh-mobile-bridge",
            order: 50,
            inject: () => ({}),
          },
          SafeSettingsCard,
        ),
      )
    }

    return { apply, inject: ["slots"] }
  },
})
