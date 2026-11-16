/**
 * 面板里的叶子组件（R22 第二刀）。
 *
 * 这些组件只依赖 `h`（React.createElement）和传入的 props，不碰外部状态，
 * 所以从 `PanelBody` 里拆出来后可以直接用假 React 调用、断言返回的元素树。
 *
 * 运行时由 `tools/build-client.mjs` 内联进 `lib/client.js`；改完必须重新生成
 * （CI 的 `--check` 会拦）。
 */

/** 侧栏按钮用的手机小图标。 */
export function PhoneIcon() {
  return h(
    "svg",
    { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true" },
    h("rect", { x: 6, y: 2.5, width: 12, height: 19, rx: 2.6, stroke: "currentColor", strokeWidth: 1.7 }),
    h("path", { d: "M10.5 18.5h3", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" }),
  )
}

/** 桥接在线状态点 + 文案。 */
export function Status({ ok, text }) {
  return h(
    "span",
    { className: "dmb-status" + (ok ? "" : " bad") },
    h("span", { className: "dmb-dot" }),
    text,
  )
}

/** 面板整体崩溃时的兜底页：只显示错误与关闭按钮。 */
export function ErrorPanel({ error, onClose }) {
  return h(
    "div",
    { className: "dmb-panel", style: { padding: 22 } },
    h("div", { className: "dmb-title" }, "手机远控面板加载出错"),
    h("div", { className: "dmb-alert", style: { marginTop: 12 } }, String(error?.message || error)),
    h("button", { className: "dmb-btn", style: { marginTop: 14 }, onClick: onClose }, "关闭"),
  )
}

/**
 * 已配对设备卡片。
 *
 * 从 `PanelBody` 里搬出来：只吃 `devices` / `busy` 与一个撤销回调，不碰任何外部状态，
 * 因此可以用假 React 直接渲染（见 `test/client-render.test.js`）。
 */
export function DevicesCard({ devices, busy, onRevoke }) {
  const active = (devices || []).filter((device) => !device.revokedAt)
  return h(
    "div",
    { className: "dmb-card" },
    h("div", { className: "dmb-label", style: { marginBottom: 10 } }, "已配对设备"),
    h(
      "div",
      { className: "dmb-devices" },
      active.length === 0
        ? h("div", { className: "dmb-empty" }, "还没有设备配对")
        : active.map((device) =>
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
                { className: "dmb-btn", disabled: busy !== "", onClick: () => onRevoke(device) },
                "撤销",
              ),
            ),
          ),
    ),
  )
}
