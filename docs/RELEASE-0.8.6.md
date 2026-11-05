# v0.8.6 — 会话里能看到图片、默认工作区目录、离线通知

这一版处理三件事：手机上发的图终于会出现在手机自己的对话里；桌面端可以指定一个默认工作区目录，手机上新建任务时能直接在里面建文件夹；手机彻底连不上电脑时（局域网和 Tailscale 都不通）会收到一条说得清楚的系统通知。

## 一、会话里显示图片

图片一直是**送到了**电脑的：`POST /api/sessions/:id/prompt` 里的 base64 被 DSH 收下、落成附件、进了模型输入。看不到是两处断点：

- 时间线投影 `host/lib/dto.js` 的 `textOfContent()` 只收集文本块，图片块被跳过；随后的 `if (text.trim() === '') return null` 又把「只有图片」的消息整条丢掉——所以纯图片消息在时间线上连个空行都不留，带文字的只显示文字。
- 手机端没有任何画图能力：`TimelineItem` 没有图片字段，气泡只渲染一个 `Text`。

现在：

- 时间线里每条消息多一个 `images` 数组，元素是 `{ index, mediaType, name, width, height, bytes }`；`index` 就是这条消息里第几张图，取字节时原样带回来。
- 「只有图片」的消息不再被丢弃（有文字或有图就算一条消息）。
- 新增 `GET /api/sessions/:id/images/:seq/:index`，直接回原始字节（带 `content-type`、`nosniff`、`private, max-age=86400`）。主机侧把 `(会话, seq) → 图片引用` 做了 256 条 LRU 缓存，命中就不必再读一遍会话；图片本身是内容寻址的，引用不会变，所以缓存不需要失效逻辑。
- 手机端：单张图铺一行，多张按两列排；点缩略图整屏看，点任意位置关掉。解码失败显示「图片加载失败」，加载中是转圈。字节在客户端也缓存 24 MiB（LRU），翻上翻下不重复下载。

## 二、默认工作区目录

桌面端的「手机桥接」设置里多了一个「默认工作区目录」，填一个已存在的绝对路径（例如 `F:\AgentWorkProject`）。填了之后，手机「新建任务」页的工作区列表下面会出现一行「新建工作区文件夹」：

- 输入名字 → 电脑在默认目录下建同名文件夹 → 登记成工作区 → 直接选中它开新任务；
- 名字会清掉 `<>:"/\|?*` 这类非法字符并截到 60 字，最终路径会校验确实落在默认目录里面；
- 目录已存在就直接复用；同名位置被文件占住会回「已存在但不是文件夹」；
- 没配默认目录时按钮不出现，接口回 409 提示先去电脑端设置。

## 三、连不上时的通知

原来的逻辑是一掉线立刻弹「连接已断开」。切 Wi-Fi、进电梯、地铁出站都有一两秒空窗，这样弹太吵。现在：

- 掉线先不通知，等 20 秒复查一次：期间连回来了就什么也不弹；确认还是断的才发通知。
- 通知内容用主机给的原因。局域网和 Tailscale 地址都探不通时，标题直接写「局域网和 Tailscale 都连不上 · <主机名>」，不再让人以为是某一条线路的问题；这种情形优先级也从低提到默认，锁屏上更显眼。

## 变更清单

主机（`host/`，插件包已重建）：

- `lib/dto.js`：新增 `imageRefsOf(content)` / `imagePartsOf(content)`；`user/message` 与 `assistant/message` 都带 `images`，并且「文本为空且没有图」才丢弃。
- `lib/server.js`：图片引用缓存 + `loadImageRefs()`；`GET /api/sessions/:id/images/:seq/:index`；`workspaceRoot()` / `cleanFolderName()`；`POST /api/workspaces`；`GET /api/workspaces` 与 `/api/info` 都带上默认目录。
- `lib/state.js` / `lib/auth.js` / `lib/index.js`：新增设置项 `workspaceRoot`（默认空，必须是绝对路径）。
- `lib/client.js`：设置面板新增「默认工作区目录」输入框。
- `package.json` / `lib/index.js`：版本 0.8.6。

手机（`android/`）：

- `data/Models.kt`：`TimelineImage`、`TimelineItem.images`、`WorkspaceList.root`、`BridgeHost.workspaceRoot`。
- `data/BridgeClient.kt`：`imageBytes()`、`createWorkspace()`；`workspaces()` 现在解 `{ root, workspaces }`。
- `data/BridgeRepository.kt`：图片 LRU 缓存与 `imageBytes()`、`createWorkspace()`、`Runtime.workspaceRoot`。
- `data/AppState.kt`：`AppState.workspaceRoot`、`HostSnapshot.error`。
- `ui/screens/SessionScreen.kt`：消息气泡里的图片网格与整屏查看。
- `ui/screens/NewTaskScreen.kt`：「新建工作区文件夹」。
- `notify/Alerts.kt` / `notify/BridgeService.kt`：掉线 20 秒复核 + 双通道全断的标题。
- `app/build.gradle.kts`：0.8.6 (versionCode 17)。

测试：`node scripts/check.mjs` 通过（16 个模块）；`npm test` 82 个用例通过，其中新增两个覆盖图片接口（纯图片消息保留、字节与 `content-type`、越界 404、无 token 401）和默认目录下建工作区（相对路径逃逸被拒、未配置目录 409）；`gradle :app:compileDebugKotlin` 与 `assembleDebug` 通过。

## 升级注意

- 手机上换装 APK；电脑端要重装插件包（`dsh plugin --profile <profile> add file:dist/dsh-mobile-bridge-0.8.6.tgz`）再重启 DSH，图片接口和「默认工作区目录」才会生效。
- 「默认工作区目录」在「设置 → 插件 → 手机桥接」里填，必须填已经存在的绝对路径。
- 老会话里已经存在的图片照样能看：引用存在会话事件里，不依赖发送时的临时文件。

## 附件

- `TS7-DSH-Remote-0.8.6-debug.apk` — Android 客户端
- `dsh-mobile-bridge-0.8.6.tgz` — 桌面插件包
- `SHA256SUMS-0.8.6.txt`
