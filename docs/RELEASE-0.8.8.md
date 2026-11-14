# v0.8.8 — 归档状态和电脑端同步

这一版只修一件事：电脑上归档掉的会话，手机任务列表里不再出现；归档 / 取消归档的变化会实时推到手机上，手机也能自己归档。

## 现象与原因

现象：在电脑上把会话从侧栏归档（隐藏）之后，手机上的任务列表里它还在，点进去还能继续聊。

原因在 DSH 存储模型里，不在手机端渲染：

- 归档不是「移出工作区」，而是 registry 的全局集合 `archivedSessionIds`。被归档的会话**仍留在工作区的 `sessionIds` 里**——取消归档要还原它原来的位置（见 `@deepseek-ai/dsh-workspace` 的 `workspaceRecord` / `workspaceDomainState` 注释）。
- 桥接的 `visibleSessionIds()` 只按 `workspace.sessionIds` 过滤，于是归档会话照样算「可见」，`/api/sessions` 把它返回给手机。
- 归档也没有事件：registry 写完 `state` 就结束，`session.added` / `session.removed` 这类帧不会出现。所以就算手机重新拉列表，也只是拿到同一份过期结果。

本机实测：8 个工作区共 67 个会话成员，其中 50 个已归档且仍在 `sessionIds` 里——在手机上全都还是可见的。

## 现在的做法

- `GET /api/sessions` 同时过滤两个集合：必须属于某个工作区，且不在 `archivedSessionIds` 里。
- `GET /api/workspaces` 返回的 `sessionIds` 同样剔掉归档会话（App 用它分组，留着只会得到一个空分组），并在同一响应里补上 `archivedSessionIds`，客户端要自己画归档区也有依据。
- `createSessionHub()` 每 3 秒对一次归档集合（读的是 registry 内存数组，开销可忽略）。新增归档 → 广播 `session.removed { sessionId, archived: true }`，并丢掉缓存的 summary、停掉该会话的 follow；取消归档 → 广播 `session.added`。于是手机停在列表页、或正开着那个会话时都会立刻跟着消失 / 回来，不用重新进列表。
- 启动时先立一次基线：已经归档的会话不会被当成「刚刚归档」再推一轮帧。
- 新增 `POST /api/sessions/:id/archive` 与 `/api/sessions/:id/unarchive`，写的就是同一个 registry 集合——手机归档后电脑上也一起隐藏，不存在两端各存一份的可能。运行中的会话归档返回 409（`WorkspaceActiveSessionError` 按「先停止再归档」透出）。
- 手机端任务详情菜单新增「归档会话」（带确认），归档成功后退回列表。日志仍然保留，彻底删除还是原来那条路径。

## 变更清单

主机（`host/`）：

- `lib/server.js`：`archivedSessionIdSet()`；`listSummaries()` 双重过滤；`GET /api/workspaces` 过滤 `sessionIds` 并返回 `archivedSessionIds`；新增 `archive` / `unarchive` 两个会话动作。
- `lib/events.js`：`syncArchive()` + 3 秒轮询 + `dispose` 清理；hub 返回 `syncArchive`，供接口写完归档后立即对账。
- `lib/index.js` / `package.json`：版本 0.8.8。
- `test/server.test.js`（+3）：归档会话不出现在列表与工作区分组里、手机归档与取消归档的往返、运行中归档 409。
- `test/events.test.js`（新增，4 例）：归档 → `session.removed`、取消归档 → `session.added`、读不到 registry 时保持基线、启动基线不重发。

手机（`android/`）：

- `data/BridgeClient.kt`：`archive(id)` / `unarchive(id)`。
- `data/BridgeRepository.kt`：`archiveActiveSession()`（成功后清当前会话并刷新列表）。
- `ui/screens/SessionScreen.kt`：`SessionDialog.Archive` 与菜单项「归档会话」。
- `app/build.gradle.kts`：0.8.8 (versionCode 19)。

验证：`node scripts/check.mjs` 通过，`node --test` 101 个用例全通过；`gradle :app:assembleDebug` 通过。

## 升级注意

- 电脑端要**完整重启 DSH**（托盘退出或 `tools/restart-dsh.cmd`），host 侧过滤才会生效；只按 F5 不会重新加载 host bundle。
- 手机换装这一版 APK 才有「归档会话」入口；旧版 APK 也能看到归档会话消失（那是服务端过滤的效果）。
- 取消归档目前只能在电脑上做（会话会回到工作区原来的位置）。

## 附件

- `TS7-DSH-Remote-0.8.8-debug.apk` — Android 客户端
- `dsh-mobile-bridge-0.8.8.tgz` — 桌面插件包
- `SHA256SUMS-0.8.8.txt`
