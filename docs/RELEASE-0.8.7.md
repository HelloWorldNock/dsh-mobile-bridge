# v0.8.7 — 计划待审不再漏到桌面、双端都能导出运行日志

这一版修两件事：电脑上弹出的「计划待审」卡片，手机在断线重连、或手机只是短暂没有连上的时候也能收到并作答；手机和电脑都加了一个「导出运行日志」，出问题时可以直接把一份自解释的文本发出来。

## 一、计划待审没同步到手机

现象：电脑上「计划待审阅」卡片躺着不动，手机上既看不到这张卡片，也没有任何通知。

原因不在手机端渲染——`PendingCards.kt` 早就能画计划审阅卡片，`BridgeService` 也会对 `question.planReview` 发通知。断点在主机侧 `lib/approvals.js`：

- `phoneActive()` 同时要求「手机优先」开关打开**并且此刻有 SSE 连接**。请求到达的那一瞬间手机没连着（息屏、切网、锁屏后系统回收连接），整条请求就被 `next()` 交回桌面，此后 `/api/pending` 也就永远不包含它。
- `revalidate()` 在 SSE 断开时直接把手机侧的卡片按超时清理（`expirePhone('disconnected')`），哪怕桌面那边还开着。

现在：

- 开关与连接拆成两个判断：`phoneEnabled()` 只看设置，`phoneConnected()` 只看有没有实时连接。开关打开时请求一律先建成卡片，再与桌面并行；只有「开关关掉」或「手机没连且桌面也没有客户端」才交回 DSH。
- 断线不再撤销卡片：桌面也关了才清（`expirePhone`），桌面还开着就留着，等手机重连后从 `/api/pending` 取回。
- 手机端不再丢弃提醒帧：`notice` 里 `kind == 'attention'` 以前被直接 `return` 掉，现在会立刻补一次 `/api/pending` 与 `/api/sessions` 刷新，计划卡片和通知在同一秒内出现。
- 队列合并改成「以主机为准 + 保留本次请求之后本地新推来的卡片」（`applyPending`），不再只做并集：这样主机上已经作废的卡片会消失，而刷新与推送撞车时不会把刚到的计划卡片冲掉。

顺带修了手机时间线打开时是空的：主机 `inspectRecords()` 调的是 `sessionController.inspect()`，而当前 DSH 的 SessionController 没有这个方法，异常被 `catch` 吞掉后返回空数组。新增 `lib/history.js`，按 `page` → `events` → `inspect` 顺序降级取历史，两个端点（`GET /api/sessions/:id`、`/api/sessions/:id/history`）共用它。

## 二、运行日志导出（双端）

主机侧日志以前只走 `ctx.logger`（打进 DSH 自己的控制台），出事以后翻不到。

- 新增 `lib/logs.js`：环形缓冲 1500 条 + 落盘 `<state 目录>/logs/bridge.log`（超过 3 MB 轮转成 `bridge.log.1`），`wrapLogger()` 把插件的 logger 同时写进文件，`startLogTee()` 收 `[mobile-bridge]` 前缀的 stdout/stderr。
- `GET /api/setup/logs`（仅本机回环）与 `GET /api/logs`（配对设备，`?format=json` 返回 `{ path, count, text }`；绑定组 peer 一律 403）。导出内容是自解释文本：生成时间、桥接版本、设备 ID、主机名、端口、在线手机数、待审批/待回答条数、Node 与平台、日志文件路径，后面跟日志行。
- 电脑端设置面板新增「运行日志」卡片：显示落盘路径、展开看最近 600 行、一键复制、「导出日志文件」直接下载。
- 手机端「设置 → 排查与日志 → 导出运行日志」：把手机侧的连接/事件流/待办事件，加上每台电脑的 `/api/logs` 拼成一份文本，走系统文件选择器保存为 `dsh-remote-<时间戳>.log`。电脑连不上时也照样能导出，只是少了电脑那一段，并在文中写明原因。
- 手机端新增 `RunLog`（内存 400 条）：连接成功/失败、事件流断开与重连原因、待办卡片的增删（计划审阅会单独标出来）、通知发出、打开会话失败，都留一行。

## 变更清单

主机（`host/`）：

- `lib/approvals.js`：`phoneActive()` 拆成 `phoneEnabled()` / `phoneConnected()`；`handleApproval`、`handleQuestion`、`revalidate` 改为断线保卡。
- `lib/history.js`（新增）：`readSessionRecords()`，`page` / `events` / `inspect` 三级降级。
- `lib/logs.js`（新增）：`createLogSink()`、`wrapLogger()`、`formatLogBundle()`、`startLogTee()`。
- `lib/server.js`：`inspectRecords()` 改走 `readSessionRecords()`；`GET /api/sessions/:id/history` 用 `hasMore`/`beforeSeq` 分页；`logBundle()`；`GET /api/setup/logs`、`GET /api/logs`；`setupState()` 带 `logs.path`。
- `lib/index.js`：创建日志 sink、包 logger、启动 tee、启动行打印日志路径、shutdown 还原。
- `lib/client.js`：设置面板「运行日志」卡片。
- `package.json` / `lib/index.js`：版本 0.8.7。

手机（`android/`）：

- `data/RunLog.kt`（新增）：`info/warn/error/record`、`snapshot`、`text`、`timestamp`。
- `data/Models.kt`：`HostLogBundle`。
- `data/BridgeClient.kt`：`logs(lines)`。
- `data/BridgeRepository.kt`：`applyPending()` / `logPendingDiff()` / `pendingAddedAt`；`notice(attention)` 刷新；连接与事件流仪表化；`collectLogs()`。
- `ui/screens/SettingsScreen.kt`：`onCollectLogs` 参数与「排查与日志」段。
- `ui/AppRoot.kt`：接上 `collectLogs()`。
- `notify/BridgeService.kt`：计划待审阅通知写一行日志。
- `app/build.gradle.kts`：0.8.7 (versionCode 18)。

测试：`node scripts/check.mjs` 通过；`node --test` 94 个用例通过，其中新增 `history.test.js`（4 例）、`logs.test.js`（6 例）、`server.test.js` 里的日志导出端点（面板附件、未配对 401、JSON 形态、`content-disposition`）；`approvals.test.js` 里两条旧语义用例改成「断线保卡」并新增「手机没连也留住计划审阅」。`gradle :app:compileDebugKotlin` 通过。

## 升级注意

- 手机换装 APK；电脑端要重装插件包（`dsh plugin --profile <profile> add file:dist/dsh-mobile-bridge-0.8.7.tgz`）并重启 DSH，主机侧的改动才生效。
- 日志落盘在 `<DSH_HOME>/storages/mobile-bridge/logs/bridge.log`，设置面板里会显示完整路径；换版本后旧文件会被轮转覆盖。

## 附件

- `TS7-DSH-Remote-0.8.7-debug.apk` — Android 客户端
- `dsh-mobile-bridge-0.8.7.tgz` — 桌面插件包
- `SHA256SUMS-0.8.7.txt`
