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

/**
 * 运行日志卡片。
 *
 * 只负责展示与派发回调：展开/收起、读取中、复制、刷新、导出链接都在这里，
 * 真正的取数仍在 `PanelBody`（`loadLogs` 走 loopback 的 `/api/setup/logs`）。
 */
export function LogCard({ logsPath, open, busy, text, onToggle, onCopy, onRefresh, baseUrl }) {
  return h(
    "div",
    { className: "dmb-card" },
    h("div", { className: "dmb-label", style: { marginBottom: 6 } }, "运行日志"),
    h(
      "div",
      { className: "dmb-setting" },
      h(
        "div",
        { className: "grow" },
        h("div", { className: "name" }, "bridge.log"),
        h(
          "div",
          { className: "hint" },
          logsPath
            ? `手机连不上、审批不同步之类的怪问题，导出这个文件发出去就行：${logsPath}`
            : "这次运行没有落盘（只保留在内存里），重启后清空。",
        ),
      ),
      h("button", { className: "dmb-btn", onClick: onToggle }, open ? "收起日志" : "查看最近日志"),
      h(
        "a",
        { className: "dmb-btn primary", href: `${baseUrl}/api/setup/logs?lines=800`, download: "dsh-remote-host.log" },
        "导出日志文件",
      ),
    ),
    open ? h("div", { className: "dmb-log" }, busy && !text ? "读取中…" : text || "（还没有日志）") : null,
    open
      ? h(
          "div",
          { className: "dmb-actions", style: { marginTop: 10 } },
          h("button", { className: "dmb-btn", onClick: onCopy }, "复制全部"),
          h("button", { className: "dmb-btn", onClick: onRefresh, disabled: busy }, busy ? "读取中…" : "刷新"),
        )
      : null,
  )
}

/**
 * 版本与更新卡片（R22 第七刀）。
 *
 * 从 `PanelBody` 搬出：只吃 `version` / `update` / `busy` / `error` 与一个「检查更新」回调。
 * 文案分支（没查过 / 查询失败 / 有新版本 / 已最新）都在组件内，方便逐条断言。
 */
export function UpdateCard({ version, update, busy, error, onCheck }) {
  return h(
    "div",
    { className: "dmb-card" },
    h("div", { className: "dmb-label", style: { marginBottom: 6 } }, "版本"),
    h(
      "div",
      { className: "dmb-setting" },
      h(
        "div",
        { className: "grow" },
        h("div", { className: "name" }, `dsh-mobile-bridge ${version || ""}`),
        h(
          "div",
          { className: "hint" },
          update === null
            ? "还没查过 GitHub 上的最新版本。"
            : update.error
              ? update.error
              : update.hasUpdate
                ? `发现新版本 ${update.latest}（当前 ${update.current}），${fmtTime(update.checkedAt)} 查到。`
                : `已是最新版本，${fmtTime(update.checkedAt)} 查过。`,
        ),
      ),
      h("button", { className: "dmb-btn", disabled: busy !== "", onClick: onCheck }, busy === "update" ? "检查中…" : "检查更新"),
    ),
    error !== "" ? h("div", { className: "dmb-alert", style: { marginTop: 10 } }, error) : null,
    update !== null && update.hasUpdate
      ? h(
          "div",
          { className: "dmb-setting" },
          h(
            "div",
            { className: "grow" },
            h("div", { className: "name" }, `新版本 ${update.latest}`),
            h("div", { className: "hint" }, update.notes ? update.notes : "去发布页看这次改了什么。"),
          ),
          h("a", { className: "dmb-btn primary", href: update.url, target: "_blank", rel: "noreferrer" }, "打开发布页"),
        )
      : null,
    update !== null && !update.hasUpdate && update.url
      ? h(
          "div",
          { className: "dmb-sub", style: { marginTop: 8 } },
          "更新包：",
          h("a", { href: update.url, target: "_blank", rel: "noreferrer", style: { color: "#4D6BFE" } }, update.url),
        )
      : null,
  )
}

/**
 * 桥接设置卡片（R22 第八刀）：手机优先审批、局域网发现、三个等待时长、协作工作区、
 * 默认工作区目录，以及保存按钮。
 *
 * 只吃 `form` 与回调：改字段走 `onPatch(patch)`，保存走 `onSave()`，
 * 真正的 POST 与状态仍在 `PanelBody`。
 */
export function BridgeSettingsCard({ workspaces, form, error, busy, saved, onPatch, onSave }) {
  return h(
    "div",
    { className: "dmb-card" },
    h("div", { className: "dmb-label", style: { marginBottom: 6 } }, "桥接设置"),
    error !== "" ? h("div", { className: "dmb-alert", style: { marginBottom: 10 } }, error) : null,
    h(
      "div",
      { className: "dmb-setting" },
      h("div", { className: "grow" }, h("div", { className: "name" }, "手机优先审批"), h("div", { className: "hint" }, "手机在线时由手机处理审批与提问；超时或离线自动交回桌面。")),
      h("input", { className: "dmb-switch", type: "checkbox", checked: form.phoneFirst, onChange: (event) => onPatch({ phoneFirst: event.target.checked }) }),
    ),
    h(
      "div",
      { className: "dmb-setting" },
      h("div", { className: "grow" }, h("div", { className: "name" }, "局域网发现"), h("div", { className: "hint" }, "允许手机通过 UDP 广播自动找到这台电脑。")),
      h("input", { className: "dmb-switch", type: "checkbox", checked: form.discovery, onChange: (event) => onPatch({ discovery: event.target.checked }) }),
    ),
    h(
      "div",
      { className: "dmb-setting" },
      h("div", { className: "grow" }, h("div", { className: "name" }, "审批等待"), h("div", { className: "hint" }, "秒；超时后交回桌面处理。")),
      h("input", { className: "dmb-num", type: "number", min: 5, max: 600, value: Math.round(form.approvalTimeoutMs / 1000), onChange: (event) => onPatch({ approvalTimeoutMs: Number(event.target.value) * 1000 }) }),
    ),
    h(
      "div",
      { className: "dmb-setting" },
      h("div", { className: "grow" }, h("div", { className: "name" }, "提问等待"), h("div", { className: "hint" }, "秒；普通用户问题的等待时间。")),
      h("input", { className: "dmb-num", type: "number", min: 5, max: 600, value: Math.round(form.questionTimeoutMs / 1000), onChange: (event) => onPatch({ questionTimeoutMs: Number(event.target.value) * 1000 }) }),
    ),
    h(
      "div",
      { className: "dmb-setting" },
      h("div", { className: "grow" }, h("div", { className: "name" }, "计划审阅等待"), h("div", { className: "hint" }, "秒；计划卡片的等待时间。")),
      h("input", { className: "dmb-num", type: "number", min: 5, max: 600, value: Math.round(form.planReviewTimeoutMs / 1000), onChange: (event) => onPatch({ planReviewTimeoutMs: Number(event.target.value) * 1000 }) }),
    ),
    h(
      "div",
      { className: "dmb-setting" },
      h(
        "div",
        { className: "grow" },
        h("div", { className: "name" }, "协作工作区"),
        h("div", { className: "hint" }, "对端派过来的协作任务都在这个工作区里建会话，产物只写这里；不选则用下面手填的绝对路径，都留空表示跟随会话自己的 cwd。"),
      ),
      h(
        "div",
        { className: "dmb-join", style: { width: 300, marginTop: 0 } },
        h(
          "select",
          {
            className: "dmb-select",
            value: form.collabWorkspaceId,
            onChange: (event) => {
              const id = event.target.value
              const picked = (workspaces || []).find((item) => item.id === id)
              onPatch({ collabWorkspaceId: id, collabRoot: picked ? picked.path : form.collabRoot })
            },
          },
          h("option", { value: "" }, "不限定（使用下面的路径）"),
          (workspaces || []).map((item) => h("option", { key: item.id, value: item.id }, `${item.title || item.id} — ${item.path}`)),
        ),
        h("input", {
          className: "dmb-input",
          placeholder: "F:\\collab",
          value: form.collabRoot,
          onChange: (event) => onPatch({ collabWorkspaceId: "", collabRoot: event.target.value }),
        }),
      ),
    ),
    h(
      "div",
      { className: "dmb-setting" },
      h(
        "div",
        { className: "grow" },
        h("div", { className: "name" }, "默认工作区目录"),
        h("div", { className: "hint" }, "手机新建任务时可以在这个目录下直接建新的工作区文件夹；留空表示手机端不能建。必须是已存在的绝对路径。"),
      ),
      h("input", {
        className: "dmb-input",
        style: { width: 300 },
        placeholder: "F:\\AgentWorkProject",
        value: form.workspaceRoot,
        onChange: (event) => onPatch({ workspaceRoot: event.target.value }),
      }),
    ),
    h(
      "div",
      { className: "dmb-actions", style: { marginTop: 12 } },
      h("button", { className: "dmb-btn primary", onClick: onSave, disabled: busy !== "" }, busy === "save" ? "保存中…" : "保存设置"),
      saved ? h("span", { className: "dmb-saved" }, saved) : null,
    ),
  )
}

/**
 * PC 绑定组卡片（R22 第九刀）。
 *
 * 只管画：组状态、邀请码、组内 PC 列表、加入表单，以及 5 个按钮。
 * 建组/退出/生成邀请码/移出/加入的副作用（post、confirm、地址与邀请码校验）都在
 * `PanelBody` 的回调里，组件不碰网络、不读全局。
 */
export function GroupCard({ group, busy, error, saved, url, code, onUrlChange, onCodeChange, onCreate, onLeave, onInvite, onForget, onJoin }) {
  const groupState = group || { group: null, peers: [], invite: null }
  const peers = Array.isArray(groupState.peers) ? groupState.peers : []
  const invite = groupState.invite || null
  const joined = Boolean(groupState.group)

  return h(
    "div",
    { className: "dmb-card" },
    h("div", { className: "dmb-label", style: { marginBottom: 8 } }, "PC 绑定组"),
    error !== "" ? h("div", { className: "dmb-alert", style: { marginBottom: 10 } }, error) : null,
    h(
      "div",
      { className: "dmb-setting" },
      h(
        "div",
        { className: "grow" },
        h("div", { className: "name" }, joined ? groupState.group.name || "绑定组" : "还没有绑定组"),
        h(
          "div",
          { className: "hint" },
          joined
            ? `${groupState.group.id} · ${peers.length} 台协作 PC`
            : "把几台电脑绑到同一个组里，Agent 之间就能互相派活、交换产物文件。",
        ),
      ),
      joined
        ? h("button", { className: "dmb-btn danger", disabled: busy !== "", onClick: onLeave }, busy === "group-leave" ? "退出中…" : "退出")
        : h("button", { className: "dmb-btn primary", disabled: busy !== "", onClick: onCreate }, busy === "group-create" ? "创建中…" : "创建组"),
    ),
    joined
      ? h(
          "div",
          { className: "dmb-setting" },
          h(
            "div",
            { className: "grow" },
            h("div", { className: "name" }, invite ? `邀请码 ${formatCode(invite.code)}` : "邀请码"),
            h(
              "div",
              { className: "hint" },
              invite
                ? "在另一台 PC 的面板里选「加入绑定组」，填这台 PC 的地址和这个 6 位码。"
                : "生成一个一次性邀请码，让另一台 PC 加入这个组。",
            ),
          ),
          h("button", { className: "dmb-btn", disabled: busy !== "", onClick: onInvite }, busy === "group-invite" ? "生成中…" : invite ? "换一个" : "生成邀请码"),
        )
      : null,
    joined
      ? h(
          "div",
          null,
          h("div", { className: "dmb-label", style: { marginTop: 14, marginBottom: 8 } }, "组内 PC"),
          h(
            "div",
            { className: "dmb-devices" },
            peers.length === 0
              ? h("div", { className: "dmb-empty" }, "还没有其他 PC 加入")
              : peers.map((peer) =>
                  h(
                    "div",
                    { className: "dmb-device", key: peer.deviceId },
                    h("span", { className: "dmb-dot", style: { color: peer.status === "online" ? "#16A34A" : "#94A3B8" } }),
                    h(
                      "div",
                      { className: "grow" },
                      h("div", { className: "name" }, peer.name || peer.deviceId),
                      h("div", { className: "dmb-peer-url" }, `${peer.status === "online" ? "在线" : "离线"} · ${peer.baseUrl}`),
                    ),
                    h("button", { className: "dmb-btn", disabled: busy !== "", onClick: () => onForget(peer) }, "移出"),
                  ),
                ),
          ),
        )
      : h(
          "div",
          { className: "dmb-setting" },
          h(
            "div",
            { className: "grow" },
            h("div", { className: "name" }, "加入别人的组"),
            h("div", { className: "hint" }, "填对方 PC 的地址（端口 48123，可以省略 http://）和它面板上显示的 6 位邀请码。"),
            h(
              "div",
              { className: "dmb-join" },
              h("input", { className: "dmb-input", placeholder: "http://192.168.1.10:48123", value: url, onChange: (event) => onUrlChange(event.target.value) }),
              h("input", { className: "dmb-input", placeholder: "6 位邀请码", value: code, onChange: (event) => onCodeChange(event.target.value) }),
            ),
          ),
          h("button", { className: "dmb-btn primary", disabled: busy !== "", onClick: onJoin }, busy === "group-join" ? "加入中…" : "加入"),
        ),
    saved ? h("div", { className: "dmb-saved", style: { marginTop: 10 } }, saved) : null,
  )
}
