# v0.9.12 — 桥接设置卡片拆出（R22 第八刀）

`PanelBody` 再瘦一圈：桥接设置（审批/发现/三个等待时长/协作工作区/默认工作区目录）独立成
`BridgeSettingsCard`，`panel.mjs` 从 1,160 行降到 **894 行**（-22.9%）。

## 变更

- `host/client-src/components.mjs` 新增
  `BridgeSettingsCard({ workspaces, form, error, busy, saved, onPatch, onSave })`：
  所有输入只通过 `onPatch(patch)` 回传「被改的那一个字段」，保存走 `onSave()`。
- `host/client-src/panel.mjs`：97 行的内联卡片换成一次组件调用；`form` 状态、`saveSettings` 的 POST 仍在 `PanelBody`。
- 新增渲染测试 `BridgeSettingsCard patches only the touched field, in the right units`：
  八个区块文案齐全、勾选框只 patch 自己、**数字框把秒换算成毫秒**（`90 → 90000`）、
  协作工作区下拉选中时连带填入 `collabRoot`、保存按钮回调、保存中禁用 + 文案、错误条显示。

## 验证

```
node tools/build-client.mjs         → 生成 55,284 字节；--check 通过
node --check host/lib/client.js     → 语法通过
cd host && node --test              → tests 178 / pass 177 / skip 1
node tools/verify-package.mjs       → PASS（38 文件 / 26 个 lib/** 同哈希）
tools/verify-apk-signature.ps1      → PASS（v1–v4，CN=Android Debug）
gradlew :app:clean && assembleDebug → BUILD SUCCESSFUL（0.9.12 / versionCode 33，ABI 三包）
```

## 面板结构现状

| 文件 | 行数 | 内容 |
|---|---|---|
| `client-src/panel.mjs` | 894 | 页面骨架、状态与副作用（取数、POST、菜单） |
| `client-src/components.mjs` | 285 | `PhoneIcon` / `Status` / `ErrorPanel` / `DevicesCard` / `LogCard` / `UpdateCard` / `BridgeSettingsCard` |
| `client-src/helpers.mjs` | — | 纯函数（时间、URL、配对码） |
| `client-src/styles.mjs` | — | 样式注入 |

还剩绑定组与内嵌节点两块（都带表单状态）未拆。

## 附件

- `TS7-DSH-Remote-0.9.12-arm64-v8a-debug.apk` / `-x86_64-debug.apk` / `-debug.apk`（universal）
- `dsh-mobile-bridge-0.9.12.tgz`
- `tsnode-windows-amd64.exe`
- `SHA256SUMS-0.9.12.txt`
