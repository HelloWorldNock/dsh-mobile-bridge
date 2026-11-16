# v0.9.8 — 面板渲染冒烟测试 + 路线状态总览

小版本：给面板补上「真渲染一遍」的回归网，并把整改路线的现状写成一份索引。

## 一、面板渲染冒烟测试（R22 第四刀）

面板是单文件 bundle，内部组件不导出，所以之前只能验证「能加载、能注册插槽」。这一版：

- bundle 末尾加了 `window.__DMB_TEST__ = { PanelBody, SidebarAction, SettingsCard, SafeSidebarAction, SafeSettingsCard }`
  （只在 Node 侧的假 window 里被读到，DSH 运行时无人访问）；
- 新增 `host/test/client-render.test.js`：用「假 React（带 hook 状态表）+ 假 window/document/fetch」
  真调用 `PanelBody` / `SidebarAction` / `SafeSettingsCard`，断言：
  - 渲染不抛异常，返回元素树；
  - 离线时树里出现「手机远控」与桥接状态文案（不是白屏）；
  - `SafeSettingsCard({only:'other-plugin'})` 必须返回 `null`（不能抢别的插件的位置）；
  - `only:'dsh-mobile-bridge'` 时返回元素树。

这层网让接下来切 `PanelBody`（约 880 行）有了可验证的兜底。

## 二、路线状态总览

新增 [`docs/ROADMAP-STATUS.md`](ROADMAP-STATUS.md)：R01–R27 逐项给出状态、证据位置与层级口径，
末尾列出「还没做完的三件事」（R09 真机矩阵、R26 发布私钥、R22 剩余区块）与当前质量基线。
README 的文档地图已加入口。

## 验证

```
cd host && node scripts/check.mjs   → checked 27 host modules
cd host && node --test              → tests 174 / pass 173 / skip 1
node tools/verify-package.mjs       → PASS（38 文件 / 26 个 lib/** 同哈希）
gradlew :app:clean && assembleDebug → BUILD SUCCESSFUL（0.9.8 / versionCode 29，ABI 三包）
```

## 顺手修掉的

- 我又用 PowerShell 改文件带进了 BOM（`panel.mjs`、`client-render.test.js`），被 `repo-hygiene`
  测试当场拦下并清除；`lib/client.js` 因为由 `panel.mjs` 生成，也一并恢复干净。
- `app:packageDebug` 的 `IncrementalSplitterRunnable` 再次偶发失败，先 `:app:clean` 再构建即恢复。

## 附件

- `TS7-DSH-Remote-0.9.8-arm64-v8a-debug.apk` / `-x86_64-debug.apk` / `-debug.apk`（universal）
- `dsh-mobile-bridge-0.9.8.tgz`
- `tsnode-windows-amd64.exe`
- `SHA256SUMS-0.9.8.txt`
