# v0.8.2 — 双端审批、手机复制、刷新提速、PC 协作组

四件事一起发：手机端终于能选中复制文字；审批和提问改成「双端同时下发、谁先处理以谁为准」；手机切换工作区、刷新会话内容明显快了；同一个手机绑定过的电脑可以组成绑定组，互相派任务。

## 1. 手机端对话可以选中复制了

以前消息气泡是裸 `Text`，长按没有任何选择手柄，也没有复制入口——只能靠截图。现在：

- 用户消息、助手消息、工具调用摘要、工具结果、流式预览全部包在 `SelectionContainer` 里，长按出现系统选择手柄，可拖动选区、点「复制/全选」。
- 顶部菜单新增「复制整段对话」：把当前时间线按 `[我]` / `[DSH]` / `· 工具` / `—— 完成 ——` 分段导出成纯文本（工具参数和结果各截 600 字），一次性放进剪贴板，末尾用 `[DSH 生成中]` 标出还在流式的部分。
- 复制成功弹 Toast 报字数，空对话时提示「当前对话是空的」。

## 2. 审批与提问：双端同时下发，先处理者为准

改动前只有「手机接管」和「回退桌面」两种情况：手机在线时桌面端根本看不到卡片，手机不在线才轮到桌面。这意味着手机锁屏、或者用户正坐在电脑前，都得等。

现在 `approvals.js` 把同一个请求同时交给两端：

- 手机建卡片并广播，同时调用 `next()` 让桌面端也收到卡片。广播里的 `dual: true` 表示这次是双端。
- **手机先答**：返回手机的结果，然后用网关内部的 `finishRemoteEvent()` 给桌面端那条已转发的 waterfall 事件下发 `cancel` 帧。桌面端 `PendingApproval` 监听 `request.signal`，abort 后自己撤卡——不需要打断工具调用，也不影响正在跑的会话。
- **桌面端先答**：广播 `approval.closed` / `question.closed`（`answeredBy: "desktop"`），手机卡片随即消失，不用等超时。
- **手机超时或断连**：只关手机侧卡片；桌面端在线时继续等它的结果。只有完全没有桌面端时，才按旧语义返回 `unavailable`（审批）/ 空答案（提问），避免工具调用挂死。
- 桌面端返回 `unavailable` / `cancelled` 这类「没真正作答」的结果时，不当作先答，继续等手机。
- 没有手机在线时行为不变：`desktopActive() ? next() : 'unavailable'`。

## 3. 手机端刷新提速

慢的根因是「每来一条 SSE 就整体重建一次 UI 状态」：`assistant.delta` 一秒几十条，每条都新建整个 `AppState` 并触发工作区分组重算；打开会话时还要串行发四个请求。

- 事件合并：`assistant.delta`、`session.event`、`session.snapshot`、`session.status/activity/added/updated` 统一走 60ms 合并节拍（`syncSoon()`）再推 UI；只有 `hello`、`session.removed`、审批/提问、通知仍然立即刷新。
- 结构相等短路：`refreshSessions` / `refreshPending` 拉到的东西和内存里一样时不赋值、不重建列表；同一时刻只允许一个在途请求。
- 打开会话：`/api/subscribe` 与 `/api/sessions/:id` 并行；上次拉到的详情先铺屏（`busy` 只在没有缓存时为真），不再每次点开都空屏等网络。
- 少发无效请求：详情比自己新才拉会话列表；没有待处理项就不拉 `/api/pending`。

## 4. PC 协作组（新功能）

同一个手机绑定过的电脑可以组成一个绑定组，组内互派任务。典型场景：A 电脑的 agent 写主框架，需要 3D 模型资产；B 电脑配置好、跑着本地图像生成模型。A 把「要什么风格的概念图」派给 B，B 用自己的模型出图，产物落在 B 的协作目录里，A 拿到路径继续做模型。

- **组队不用手输 IP**：手机设置页「协作组」卡片 → 「把已配对的主机连成协作组」。手机先向当前主机要一次性邀请码，再让其余每台主机带着这个码加入当前主机。电脑端「手机远控」面板的「PC 绑定组」卡片能做同样的事（创建组、生成邀请码、粘贴邀请码加入、移出成员、退出）。
- **组密钥**：`dshg_` + 32 字节，只存 SHA-256。它能在组内机器上调手机版内容 API（建会话、写 prompt、读历史），但**不能订阅 `/api/events`**，也不会被算成「手机在线」去抢审批（否则一台 PC 就能替手机接管所有审批）。
- **协作目录**：每台机器在面板里设一个绝对路径。派活不给 `workspace` 就用对端这个目录；也可以显式传对端上的绝对路径。文件接口只读这个目录内部，`..`、绝对路径、目录外软链一律 403，单次最多 200 个文件、64 MB。
- **agent 侧的 `collab` 工具**：`peers` 看组内主机和各自协作目录；`delegate` 派任务（在新会话里跑完、回传回复和新增文件，默认等 240 秒、上限 900 秒）；`status` 查进度；`files` 列对端产物；`fetch` 把某个文件取到本机。
- 心跳 30 秒一次，90 秒没心跳记为离线；邀请码一次性、5 分钟过期、单码 5 次失败、单 IP 每分钟 10 次。

## 变更清单

- 新增 `host/lib/group.js`、`host/lib/collab.js`、`host/lib/tool.js`；`host/lib/server.js` 增加绑定组与协作文件接口；`host/lib/state.js` 增加 `group`/`peers`/`settings.collabRoot`；`host/lib/index.js` 装配并在 `listen()` 后注册 `collab` 工具。
- 新增 `host/test/group.test.js`、`host/test/collab.test.js`；`host/test/approvals.test.js` 重写为双端语义；`host/test/server.test.js` 增加绑定组、组密钥边界、协作文件、手机牵线组队四组用例。`npm test` 62 个全通过。
- Android：`SessionScreen.kt` 选择/复制、`SettingsScreen.kt` 协作组卡片、`BridgeRepository.kt` 刷新提速与 `linkGroup()`、`Models.kt` 组模型、`BridgeClient.kt` 组接口。
- 版本：`host/package.json` 与 `/api/info` 的 `version` 0.8.1 → 0.8.2；App `versionCode` 12 → 13。

## 附件

- `dsh-mobile-bridge-0.8.2.tgz` — 插件包，已含 `bin/tsnode-windows-amd64.exe`
- `TS7-DSH-Remote-0.8.2-debug.apk` — Android 客户端
- `SHA256SUMS-0.8.2.txt`

## 安装

```
dsh plugin --profile desktop add file:.<下载目录>\dsh-mobile-bridge-0.8.2.tgz
```

## 说明

- 双端审批依赖 host 网关的 `pendingRemoteEvents` / `finishRemoteEvent`（`typertGateway`）。拿不到网关实例时自动退回「桌面先答为准」（手机先答仍生效，只是桌面卡片要等它自己超时或用户点掉），不会报错。
- 组内委派要求两台机器能互相直连（同一局域网或同一 tailnet）。跨 NAT 需要自己打通网络；协作目录是各机本地的绝对路径，组里不共享文件系统。
- 组内成员之间是「信任对端」的关系：拿到组密钥的机器可以在这台机器上建会话并写 prompt。只把邀请码给自己人的机器。
