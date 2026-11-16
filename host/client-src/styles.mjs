/**
 * 面板样式（R22 第三刀）：把一大段 CSS 注入成 <style>，只注入一次。
 * 从 panel.mjs 原样搬出；改完必须 node tools/build-client.mjs 重新生成 bundle。
 */

export const STYLE_ID = "dsh-mobile-bridge-client-css"

export function ensureStyle() {
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
.dmb-chip{font-size:12px;padding:4px 9px;border-radius:8px;background:rgba(77,107,254,.09);color:#4D6BFE;border:0;cursor:pointer;font-family:inherit}
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
.dmb-input{width:100%;padding:7px 9px;border-radius:8px;border:1px solid rgba(127,127,127,.3);background:transparent;color:inherit;font:inherit;font-size:13px}
.dmb-input:focus-visible{outline:2px solid #4D6BFE;outline-offset:1px}
.dmb-select{width:100%;padding:7px 9px;border-radius:8px;border:1px solid rgba(127,127,127,.3);background:transparent;color:inherit;font:inherit;font-size:13px}
.dmb-join{display:flex;flex-direction:column;gap:6px;margin-top:8px;max-width:440px}
.dmb-peer-url{font-size:11px;color:#667085;word-break:break-all}
body[data-ds-dark-theme] .dmb-peer-url{color:#98A4B8}
.dmb-tag{font-size:11px;padding:3px 8px;border-radius:999px;background:rgba(127,127,127,.14);color:#667085;flex:none}
.dmb-tag.ok{background:rgba(22,163,74,.14);color:#16A34A}
.dmb-tag.warn{background:rgba(217,119,6,.16);color:#B45309}
.dmb-tag.bad{background:rgba(220,38,38,.12);color:#DC2626}
.dmb-log{margin-top:10px;max-height:130px;overflow:auto;padding:9px 11px;border-radius:10px;background:rgba(127,127,127,.08);font-size:11px;line-height:1.55;white-space:pre-wrap;word-break:break-all}
.dmb-row{display:flex;align-items:center;gap:8px}
.dmb-row .grow{flex:1;min-width:0}
.dmb-foot{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;font-size:11px;color:#667085}
body[data-ds-dark-theme] .dmb-foot{color:#8B97AB}
.dmb-saved{font-size:12px;color:#16A34A}
@media(max-width:720px){.dmb-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
`
  document.head.appendChild(style)
}
