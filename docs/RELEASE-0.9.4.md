# v0.9.4 — 参数错误不再被包成派发失败；验收矩阵可脚本跑

这一版来自**验收脚本抓到的真实缺陷**：`POST /api/sessions` 带超量图片时，手机收到的是
`session/prompt-failed`（派发失败），而不是 `prompt/too-many-images`（参数错误），而且
失败前已经把一个空会话建了出来。

## 一、修掉的问题

`host/lib/routes/sessions.js`：

- **校验前移**：`promptContent(text, images)` 现在在 `sessionController.create()` **之前**执行。
  参数不合法时直接 400 返回，不会留下空会话（这正是「会话越堆越多」的老来源）。
- **错误码保留**：`prompt/*` 的校验错误不再被 `session/prompt-failed` 包一层，手机端可以按
  `code` 分支（之前只能看 message）。

回归测试：`host/test/server.test.js` 新增一例，断言「5 张图 → 400 + `prompt/too-many-images` +
`app.created` 为 0」。

## 二、验收矩阵可脚本跑（R09 的可自动化半边）

`tools/acceptance.mjs`：对着**正在运行的**桥接跑 API 层验收，输出表格并可写报告。

- 自动化项：A0 健康/身份、A1 配对、A1b 鉴权（错码/无 token/伪造 token）、A2 列表与归档过滤、
  A3 建会话+prompt、A4 一轮跑完并落盘、A8 图片校验、A13 归档、A14 取消归档、A16/A17 双端日志导出。
- 需要设备交互的项（A5 双端审批、A7 plan-review、A9 图片回显、A10 断线重连、A11/A12 切网、
  A15 电脑归档后就地取消、A18 NAT 发现、A19 后台通知、A20 彻底删除）明确标 `skip` 并写明理由。
- 用法：`node tools/acceptance.mjs [--out docs/ACCEPTANCE-RESULT-x.md] [--only A13,A14] [--keep]`。

首份结果：[`docs/ACCEPTANCE-RESULT-2026-11-17.md`](ACCEPTANCE-RESULT-2026-11-17.md) ——
本机运行中的宿主是 **0.8.8**，10 项通过、A8 失败（正是本版修掉的缺陷）、10 项跳过；
重启 DSH 载入 0.9.4 后重跑即应全绿。

## 三、仓库卫生门禁

`host/test/repo-hygiene.test.js`：扫全仓文本文件，禁止 UTF-8 BOM（`.ps1` 除外，PowerShell 5.1
需要它）。起因是本项目两次因为 BOM 让 `JSON.parse` / Kotlin DSL 直接失败；这条测试一上来就
抓出 21 个带 BOM 的文件，已全部清掉。

## 验证

```
cd host && node scripts/check.mjs    → checked 27 host modules
cd host && node --test               → tests 170 / pass 169 / skip 1
node tools/verify-package.mjs        → PASS（38 个文件 / 26 个 lib/** 同哈希）
tools/test-android.ps1               → 45 个用例，失败 0（本版未改 Android）
gradlew :app:assembleDebug           → BUILD SUCCESSFUL（0.9.4 / versionCode 25，按 ABI 三包）
node tools/acceptance.mjs            → 10 通过 / 1 失败（A8，宿主仍是 0.8.8）/ 10 跳过
```

## 升级注意

- **必须完整重启 DSH** 才会载入修好的校验顺序；重启后再跑一次 `node tools/acceptance.mjs`，
  A8 应当变成 `prompt/too-many-images` 400。
- Android 侧本版无代码改动，只有版本号（versionCode 25）。

## 附件

- `TS7-DSH-Remote-0.9.4-arm64-v8a-debug.apk` / `-x86_64-debug.apk` / `-debug.apk`（universal）
- `dsh-mobile-bridge-0.9.4.tgz`
- `tsnode-windows-amd64.exe`
- `SHA256SUMS-0.9.4.txt`
