# v0.9.11 — 版本/更新卡片从 PanelBody 拆出（R22 第七刀）

`PanelBody` 继续瘦身：「版本」卡片独立成 `UpdateCard`，`panel.mjs` 从 **1,160 行降到 980 行**（-15.5%）。

## 变更

- `host/client-src/components.mjs` 新增 `UpdateCard({ version, update, busy, error, onCheck })`：
  四条文案分支（没查过 / 查询失败 / 有新版本 / 已最新）、发布页链接、更新包地址、检查中状态都在组件内。
- `host/client-src/panel.mjs`：内联的 62 行卡片换成一次 `h(UpdateCard, {...})`；`checkUpdate` 与 `busy` 仍由 `PanelBody` 提供。
- 新增渲染测试 `UpdateCard covers every version branch and its callbacks`：逐条断言四种文案、
  发布页 `href`、更新包链接、「检查中…」与按钮禁用、以及点击回调。

## 踩坑记录（值得写下来）

按「第一个 `: null,`」找卡片结尾会把卡片内部的 `: null,` 当成结束标志，直接切坏对局
（`syntax=1: missing ) after argument list`）。正确做法是**用同级兄弟 `          snap` 行定位边界**：
卡片从某个 `snap` 开始，到下一个同级 `snap` 之前结束。这也是本轮第二次因「边界」翻车
（上一次是按花括号配平被 Kotlin 字符串模板带跑）。

## 验证

```
node tools/build-client.mjs         → 生成 55,566 字节；--check 通过
node --check host/lib/client.js     → 语法通过
cd host && node --test              → tests 177 / pass 176 / skip 1
node tools/verify-package.mjs       → PASS（38 文件 / 26 个 lib/** 同哈希）
gradlew :app:clean && assembleDebug → BUILD SUCCESSFUL（0.9.11 / versionCode 32，ABI 三包）
```

## 附件

- `TS7-DSH-Remote-0.9.11-arm64-v8a-debug.apk` / `-x86_64-debug.apk` / `-debug.apk`（universal）
- `dsh-mobile-bridge-0.9.11.tgz`
- `tsnode-windows-amd64.exe`
- `SHA256SUMS-0.9.11.txt`
