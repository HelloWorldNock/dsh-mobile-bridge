# v0.9.13 — PC 绑定组卡片拆出（R22 第九刀）

`PanelBody` 里最大的一块表单也搬走了：PC 绑定组独立成 `GroupCard`。
`panel.mjs` 从 1,160 行降到 **760 行**（-34.5%）。

## 变更

- `host/client-src/components.mjs` 新增
  `GroupCard({ group, busy, error, saved, url, code, onUrlChange, onCodeChange, onCreate, onLeave, onInvite, onForget, onJoin })`：
  两种状态（未加入的「创建组 / 加入表单」、已加入的「邀请码 / 组内 PC 列表 / 退出」）都在组件里；
  **建组、退出、生成邀请码、移出、加入**这五个动作只派发回调。
- 副作用仍留在 `PanelBody`：`post(...)`、`window.confirm(...)`、地址与 6 位码校验、`setSaved`、`setActionError`。
  也就是说组件不碰网络、不读全局状态，可以直接单测。
- 新增渲染测试 `GroupCard renders both states and wires the five actions`：
  未加入态的输入与两个按钮、加入前的 `onUrlChange/onCodeChange`、已加入态的组名/邀请码格式化
  （`123  456`）/在线离线标注/四个按钮（退出、换一个、移出×2）与回调参数、错误与提示文案、忙碌时禁用。

## 面板结构现状（累计）

| 文件 | 行数 | 内容 |
|---|---|---|
| `client-src/panel.mjs` | **760** | 页面骨架、state 与副作用（取数、POST、菜单） |
| `client-src/components.mjs` | 387 | `PhoneIcon`/`Status`/`ErrorPanel`/`DevicesCard`/`LogCard`/`UpdateCard`/`BridgeSettingsCard`/`GroupCard` |
| `client-src/helpers.mjs` | 49 | 纯函数 |
| `client-src/styles.mjs` | 89 | 样式注入 |

只剩「内置 Tailscale 节点」一块（表单 + 登录流程）未拆。

## 验证

```
node tools/build-client.mjs         → 生成 53,167 字节；--check 通过
cd host && node --test              → tests 179 / pass 178 / skip 1
node tools/verify-package.mjs       → PASS（38 文件 / 26 个 lib/** 同哈希）
tools/verify-apk-signature.ps1      → PASS（v1–v4，CN=Android Debug）
gradlew :app:clean && assembleDebug → BUILD SUCCESSFUL（0.9.13 / versionCode 34，ABI 三包）
```

## 附件

- `TS7-DSH-Remote-0.9.13-arm64-v8a-debug.apk` / `-x86_64-debug.apk` / `-debug.apk`（universal）
- `dsh-mobile-bridge-0.9.13.tgz`
- `tsnode-windows-amd64.exe`
- `SHA256SUMS-0.9.13.txt`
