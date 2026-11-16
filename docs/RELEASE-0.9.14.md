# v0.9.14 — 内嵌 Tailscale 卡片拆出（R22 完成）

最后一块也搬走了：内嵌 Tailscale 节点独立成 `TailscaleCard`。
`panel.mjs` 从 1,160 行降到 **626 行**（-46%），`PanelBody` 的九个区块全部组件化。

## 变更

- `host/client-src/components.mjs` 新增
  `TailscaleCard({ ts, busy, phase, enabled, host, dir, key, log, open, hasKey, onToggle, onHostChange, onHostCommit, onDirChange, onDirCommit, onKeyChange, onKeySave, onRestart, onToggleLog })`，
  以及展示用常量 `TS_PHASE` / `TS_TONE`（从 `panel.mjs` 一并搬走）。
- 组件只管画：状态标签、开关、节点名、状态目录、授权密钥、错误与授权链接、IP/tailnet 胶囊、
  健康提示、日志折叠；**所有写操作都只派发回调**，`post(...)` 仍在 `PanelBody`。
- 新增 `host/test/client-tailscale.test.js`（2 例）：状态文案映射、错误/授权链接、IP 胶囊
  （监听地址为 `0.0.0.0` 时不显示）、health 合并、六个交互的回调序列、
  空密钥禁用保存、未启用禁用重启、展开日志、已保存密钥提示。

## 面板结构（终态）

| 文件 | 行数 | 内容 |
|---|---|---|
| `client-src/panel.mjs` | **626** | 页面骨架、state 与副作用（取数、POST、菜单、对话框编排） |
| `client-src/components.mjs` | 543 | `PhoneIcon`/`Status`/`ErrorPanel`/`DevicesCard`/`LogCard`/`UpdateCard`/`BridgeSettingsCard`/`GroupCard`/`TailscaleCard` + `TS_PHASE`/`TS_TONE` |
| `client-src/helpers.mjs` | 49 | 纯函数 |
| `client-src/styles.mjs` | 89 | 样式注入 |

R22 到此完成：`PanelBody` 从「一个 900 行的函数」变成了「装配 + 9 个可单独渲染测试的组件」。

## 验证

```
node tools/build-client.mjs         → 生成 52,832 字节；--check 通过
cd host && node --test              → tests 181 / pass 180 / skip 1
node tools/verify-package.mjs       → PASS（38 文件 / 26 个 lib/** 同哈希）
tools/verify-apk-signature.ps1      → PASS（v1–v4，CN=Android Debug）
gradlew :app:clean && assembleDebug → BUILD SUCCESSFUL（0.9.14 / versionCode 35，ABI 三包）
```

## 附件

- `TS7-DSH-Remote-0.9.14-arm64-v8a-debug.apk` / `-x86_64-debug.apk` / `-debug.apk`（universal）
- `dsh-mobile-bridge-0.9.14.tgz`
- `tsnode-windows-amd64.exe`
- `SHA256SUMS-0.9.14.txt`
