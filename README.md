# TS7 DSH Remote

在局域网或 Tailscale 网络中，用 Android 手机远程操作 DeepSeek Harness（DSH）的 host 插件 + 原生 App。

参考 SKYBOX 的局域网配对方式：桌面端显示设备 ID、IP 和 6 位配对码；手机扫码/输入后建立长期 token。默认所有流量留在局域网；电脑开启 Tailscale 后，手机在局域网外会自动改走 tailnet，回到局域网再自动切回直连。手机可以同时连接多台已安装插件的主机，新建任务时最多附带 4 张图片。远程也可以不装系统 Tailscale，直接启用 App 内的实验性内嵌节点。

## 功能

- 任务列表：按桌面端工作区分组，默认全部收起（只看工作区名、会话数和运行中数量），点标题展开/收起；搜索时自动展开匹配的工作区，并匹配工作区、标题和目录；PC 端归档的会话不显示，归档状态变化会实时同步到手机
- 多主机：同时配对并保持多台 DSH 的 SSE 连接，顶部主机胶囊一键切换；各主机的任务、审批和通知互不串台
- 局域网/远程自动切换：电脑开启 Tailscale 时，插件同时广播局域网和 tailnet 地址；手机离开 Wi-Fi 自动改走 Tailscale，回到局域网自动切回直连
- 内嵌 Tailscale（实验）：App 自带 userspace tsnet 节点，不占用系统 VPN，可与系统 Tailscale 或其他 VPN 共存；设置里一键随 App 启动/停止，只把本 App 的 DSH 流量送进 tailnet
- 彻底删除：任务详情菜单可直接删除会话日志（不可恢复）
- 新建任务：工作区列表与桌面端同步（取不到时退回最近会话目录并给出重试）；选择工作区、输入 prompt、可选计划模式/权限预设
- 图片：新建任务或继续任务时最多附带 4 张 PNG/JPEG/WebP/GIF，App 先压到长边 1600、单张 ≤ 3.5 MB；是否理解图片取决于当前 DSH 模型
- 虚拟机自动发现：宿主机跑一个 UDP 中继，把手机的发现包转发给 NAT 虚拟机，手机不用再手填转发地址
- 任务详情：默认只显示对话、轮次状态和错误，工具调用合并成一行摘要（如「执行 5 步 · Bash, Read」），点摘要或菜单「显示执行细节」才展开完整过程；流式回复、停止/重命名
- 历史图片：任务详情里直接回显会话中的图片（0.8.6 起），点缩略图可全屏查看，长按保存到相册
- 默认工作区目录：面板里设一个默认根目录后，手机可以在它下面直接新建工作区文件夹（0.8.6 起；没设时新建工作区会被主机拒绝并给出原因）
- 运行日志导出：手机「设置 → 导出运行日志」和面板「运行日志」都能一键导出 `.log`，内容包含双端版本、连接路线与桥接日志（0.8.7 起）
- 计划审阅保卡：断线重连后未处理的 plan-review 卡片不会被清空，重连继续显示（0.8.7 起）
- 归档与取消归档：手机可以直接归档任务，归档后任务从双端列表消失但日志保留；被电脑归档时这个任务会留在手机当前任务里，菜单变成「取消归档」直接放回来（0.8.9 起）
- DSH 0.2.x 适配：面板挂在侧栏与「设置 → 插件」，异步 `resolveByPath`、`durable parent`、`subagentAddress`、`settings.plugins.tab` 与 `dto.reason` 都跟宿主 0.2.x 对齐，子代理会话能正常打开（0.8.8 起）
- 宿主兼容性自检：DSH 启动时把桥接依赖的宿主接口（`sessionController` / `workspaceRegistry` / 审批 waterfall / `ctx.get` 的可选服务）逐个点一遍，结果写运行日志并在面板顶部给横幅；缺必需接口时写「主链路不可用」，只缺可选服务时写降级项和影响（0.9.0 起）
- 选择与复制：消息气泡支持长按选中（系统选择手柄、复制/全选），菜单里多了「复制整段对话」，按 `[我]` / `[DSH]` / `· 工具` 分段输出纯文本
- 权限审批：手机和桌面端**同时**弹出审批卡；哪一端先处理，就以那一端的结果为准，另一端的卡片随即消失（桌面端由 host 主动下发 cancel 帧撤卡）
- 计划审阅：plan-review 卡片展示完整计划，批准后退出计划模式并继续执行
- 普通提问：单选/多选/自定义回答，同样是双端同时下发、先答为准
- 前台服务：保持所有主机的 SSE 连接；断线自动重连
- 通知：审批、提问、任务完成；通知动作可直接允许/拒绝，多主机时标注主机名
- 亮色 UI：浅色背景、DeepSeek 蓝强调色、自适应 Q 版鲸鱼图标
- PC 协作组：同一个手机绑定过的电脑可以组成一个绑定组，组内直接互派任务（A 出需求，B 用性能跑本地模型出图），生成物只落在指定的协作工作区

## 架构

```
Android App (Kotlin + Compose)
        │  HTTP JSON + SSE (Bearer token)
        ▼
dsh-mobile-bridge (host 插件, 0.0.0.0:48123)
        │  局域网 + Tailscale 地址自动上报
        │  Host service 直调
        ▼
ctx.sessionController / ctx.sessions / ctx.workspaceRegistry
ctx.approval / ctx.userQuestions / ctx.commands
```

- 手机端不实现 DSH 的 Typert 协议，只使用精简 JSON/SSE。
- 审批与提问改为双端同时下发：手机建卡片，同时把请求交给桌面端；两端各自回答，先到者定结果。
- 手机先答时，host 直接终止已转发的远程 waterfall 事件（`cancel` 帧），桌面端卡片的 `request.signal` 被 abort 后自行撤卡，不需要打断工具调用。
- 桌面端先答时，host 广播 `approval.closed` / `question.closed`（带 `answeredBy: 'desktop'`），手机卡片随即移除。
- 手机超时或断连只关手机侧卡片；桌面端在线时继续等它的结果，没有桌面端才返回 `unavailable`。
- 计划模式通过 agent 的 `/plan`、`/plan off` 命令切换；计划正文来自 `plan-review` 问题的 `intent.detail`，不依赖不可用的根 `planMode` 服务。

## 目录

```
host/                 DSH host 插件（无构建步骤，ESM）
  lib/                server / auth / events / approvals / dto / discovery ...
  lib/adapters/dsh/   宿主适配层（session / workspace），隔离 DSH 版本差异
  test/               node:test 测试；test/integration/ 是真实宿主契约用例
  locale/             市场卡片标题与描述（zh / en）
  icon.png            插件图标（≤ 256 KiB）
contrib/              分发元数据：awesome-dsh-plugin YAML、dshmarket plugins.json
tools/                打包脚本 pack-plugin.ps1、包一致性门禁 verify-package.mjs、
                      Android 单测 test-android.ps1、图标生成、重启脚本、发现中继
android/              Android 客户端（Gradle + Compose，含 gradlew wrapper）
  src/test/           JVM 单测（数据层纯逻辑）
  gobridge/           内嵌 Tailscale 的 Go 源码（gomobile 生成 AAR）
  app/libs/           预编译 gobridge.aar（arm64-v8a + x86_64）
dist/                 debug APK 与插件 tgz 产物
.toolchain/           JDK17 / Android SDK / Gradle / Go（本地工具链）
docs/                 契约与流程：API / SECURITY / RELEASE-* / STAGE*/CLOSEOUT / ACCEPTANCE
```

### 文档地图（改代码前先看这三份）

| 要看什么 | 在哪 |
|---|---|
| 接口字段、错误码、SSE 事件 | [`docs/API.md`](docs/API.md) |
| 凭据/角色/授权边界 | [`docs/SECURITY.md`](docs/SECURITY.md) |
| 每轮改了什么、验证到哪一级 | [`docs/STAGE2-2026-11-17.md`](docs/STAGE2-2026-11-17.md)、[`docs/CLOSEOUT-0.8.9.md`](docs/CLOSEOUT-0.8.9.md)、[`docs/RELEASE-0.9.2.md`](docs/RELEASE-0.9.2.md) |
| 装、配对、升级、排障 | [docs/INSTALL.md](docs/INSTALL.md) |
| 门禁、测试分层、发版动作 | [docs/TESTING.md](docs/TESTING.md) |
| 真机怎么验 | [docs/ACCEPTANCE-0.8.9.md](docs/ACCEPTANCE-0.8.9.md) |

## 安装 host 插件（desktop profile）

本机已装好并验证：`profiles\desktop\node_modules\dsh-mobile-bridge` 是 `<repo-root>\host` 的目录联接，
`profiles\desktop\package.json` 的 `dsh.profile.bundles` 含 `dsh-mobile-bridge`。

```powershell
dsh plugin --profile <profile> add file:<repo-root>\dist\dsh-mobile-bridge-<v>.tgz
# 之后完整重启 DSH（不是 F5），再验证 http://127.0.0.1:48123/health
```

完整的安装、配对、虚拟机 NAT、升级/撤销/重置与排障步骤见 **[docs/INSTALL.md](docs/INSTALL.md)**。

## 打包为可分发插件

`host/` 已是完整可发布的 DSH 插件包（manifest、`cordis.patch.yml`、host bundle、client 面板、`locale/`、`icon.png`、LICENSE）：

```powershell
powershell -NoProfile -File tools/pack-plugin.ps1
# → dist/dsh-mobile-bridge-0.9.2.tgz（约 9.0 MB / 38 个文件，含 lib/adapters、lib/routes、lib/services 与 bin/tsnode-windows-amd64.exe）

# 发布门禁：解包逐文件比对 SHA-256，并检查三处版本号一致（不一致退出码 1）
node tools/verify-package.mjs
```

包体积变大是因为从 0.8.0 起插件自带内嵌 Tailscale 节点程序；节点程序缺失时脚本只警告并提示先跑 `tools/build-tsnode.ps1`，但打包清单里缺它会直接失败。插件、APK 与 GitHub Release tag 现在用同一个版本号。

脚本校验图标体积（≤ 256 KiB）与包内清单后调 `npm pack`，清单不全直接失败。装到任意 profile：

```powershell
dsh plugin --profile <profile> add file:<repo-root>\dist\dsh-mobile-bridge-0.9.2.tgz
```

`dsh plugin add` 会同时写入该 profile 的 `dsh.profile.bundles`，重启 DSH 即加载，桥接按 `cordis.patch.yml` 的默认值监听 `48123`/`48124`。已用一次性 profile `pkgtest` 实测安装 → `--dump-config` 能看到 `id: mobile-bridge` 及端口配置。

分发渠道元数据在 `contrib/`（awesome-dsh-plugin 的 YAML 与 dshmarket 的 `plugins.json`），发布前替换 `OWNER`/`REPO`、把 tgz 传到 GitHub Release（同时附上 `tsnode-windows-amd64.exe` 与 `SHA256SUMS-0.9.2.txt`，方便有人从源码安装时不必自己编译）；细节见 [`contrib/README.md`](contrib/README.md) 与 [`host/README.md`](host/README.md)。

## 手机连接

1. 装 `dist/TS7-DSH-Remote-<v>-debug.apk`（debug 包名 `com.ts7.dshremote.debug`）。
2. 手机与电脑同一 Wi-Fi，或都登录同一个 tailnet。
3. 打开 App：UDP 自动发现，或手填 `电脑IP:48123`；远程填 `100.x.x.x:48123` 并打开「通过 Tailscale 连接」。
4. 在 DSH 侧栏「手机远控」面板读 6 位配对码，输入手机。

图片上限、多主机、虚拟机 NAT 转发、明文策略见 **[docs/INSTALL.md](docs/INSTALL.md)**。

## Tailscale 远程

桥接会对每个网卡地址做分类：RFC1918 地址作为局域网端点，`100.64.0.0/10` 地址作为 Tailscale 端点，`/api/info`、`/api/pair` 和 UDP 发现应答都会带上这两类地址。

- App 保存主机时同时保存所有端点；自动重连按「局域网优先、Tailscale 兜底」的顺序逐个探测，再建立 SSE。
- Android 网络切换（Wi-Fi ↔ 蜂窝）时主动重新探测；SSE 断开后不再死连旧地址，而是重新选路。
- 如果电脑和手机在同一 Wi-Fi，流量走局域网，不经过 Tailscale；离开后自动切到 tailnet。
- 同一台电脑的多个端点必须指向同一个桥接实例。换机或重装导致设备 ID 变化时，App 会拒绝该端点，避免把任务发到另一台 DSH。
- 电脑端有两种方式加入 tailnet：装系统 Tailscale 并自己登录（桥接只读取它的地址），或者在手机远控面板里打开「内置 Tailscale 节点」（见下节），后者不需要安装任何东西。
- 如果 DSH 在 NAT 虚拟机里、Tailscale 只装在宿主机：在 设置 → 当前主机 → 添加备用地址，填 `宿主机TailscaleIP:转发端口`（例如 `100.x.x.x:48125`）。App 会把这条地址和局域网地址一起保存并自动选路；更彻底的做法是在虚拟机内也登录 Tailscale，或在宿主机上开内置节点并把 48123 转发进虚拟机。
- 手动添加主机时，表单下方有「通过 Tailscale 连接」开关。关闭时按填写的地址直连（局域网）；打开时先经 App 内嵌节点把流量送进 tailnet，再向该地址发起配对——填 `100.x` 地址、MagicDNS 名，或电脑在 NAT 虚拟机里只有 `192.168.x.x` 虚拟网段地址时用它。填 `100.x` 地址且内嵌节点已启用时开关自动打开，手动关掉后不再自动改回。配对走回环代理，但保存的仍是真实地址，之后的自动选路不受影响，并且这条地址在探测顺序里排到最前——这个顺序会写进配对档案，重连时不再先去试一台连不上的局域网地址。
- App 有两种远程方式，任选其一：安装系统 Tailscale 并开启 VPN；或在 设置 → 远程访问 → 内嵌 TAILSCALE 打开「随 App 启动」，按提示完成一次 tailnet 登录。内嵌节点是 userspace 实现，只有一个回环代理，不接管系统网络，因此不会和系统 Tailscale 或其他 VPN 冲突，但其他 App 也不会因此获得 tailnet 访问。
- 内嵌模式和系统模式可以同时存在：选路时局域网优先；局域网不可达时，内嵌节点已连接就走内嵌代理，否则仍可走系统 VPN 的直连地址。切换开关或完成登录后，App 会主动重连并重新选路，不需要手动改地址。

### 内嵌 Tailscale（实验）

设置 → 远程访问 → 内嵌 TAILSCALE → 打开「随 App 启动」。首次启动后点「打开 tailnet 登录页」，在浏览器里用与电脑相同的 tailnet 登录；回到 App 后状态变为「Tailscale 已连接」。也可以在设置里粘贴 auth key，App 会重启内嵌节点并直接登录。

- 实现是 `tailscale.com/tsnet` 的 userspace 节点，不创建 `VpnService`；App 只把目标 `100.64.0.0/10` 地址通过 `127.0.0.1` 上的临时代理转发。系统 Tailscale 或其他 VPN 仍可同时运行。
- 内嵌节点会以独立设备出现在 tailnet 中（默认名 `ts7-...`）。tailnet ACL 需要允许它访问电脑的 `48123/tcp`；电脑端不用改配置。
- 只代理本 App 的 DSH 流量，其他 App 不会获得 tailnet 访问；App 进程结束或关闭前台服务后节点停止。
- 只有「已安装并登录系统 Tailscale」和「内嵌节点已登录」两种方式都不可用时才会报连不上。切换内嵌开关会自动断开并重连当前主机。
- `android/app/libs/gobridge.aar` 是预编译的 tsnet 桥（arm64-v8a + x86_64，约 30 MB）。修改 `android/gobridge/bridge.go` 后需要重新生成：

```powershell
cd android\gobridge
$env:JAVA_HOME='..\..\.toolchain\jdk-17'
$env:ANDROID_HOME='..\..\.toolchain\android-sdk'
$env:ANDROID_NDK_HOME='..\..\.toolchain\android-sdk\ndk\android-ndk-r27c'
$env:PATH="$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:PATH"
$env:GOROOT='..\..\.toolchain\go'
$env:GOPATH='..\..\.toolchain\go-home'
& '..\..\.toolchain\go-home\bin\gomobile.exe' bind '-target=android/arm64,android/amd64' '-androidapi' '26' '-o' '..\app\libs\gobridge.aar' '.'
```

README 的构建命令仍可直接构建 APK；AAR 已提交，普通 Android 构建不需要 Go 工具链。debug 包把两个 ABI 都打进去，约 150 MB；发布时建议用 App Bundle 或按 ABI 拆分。

### 内嵌 Tailscale（电脑端）

侧边栏「手机远控」面板里有一张「内置 Tailscale 节点」卡片。打开开关后，桥接插件会在本机拉起一个 `tsnode` 子进程：它用 `tailscale.com/tsnet` 建 userspace 节点、以独立设备加入 tailnet，再把 tailnet 上的 `<端口>/tcp` 转发到本机 `127.0.0.1:48123`。电脑不需要安装 Tailscale 客户端，也不会接管系统网络（不建 TUN、不改路由），因此可以和系统 Tailscale 同时存在。

- 首次开启后卡片会显示登录地址，浏览器打开完成一次 tailnet 授权即可；也可以直接粘贴 auth key（`tskey-auth-…`）保存，节点会立刻重启并用 key 登录。
- 节点名默认 `dsh-<设备 ID 前段>`，可在卡片里改（DNS 安全字符，最长 63）；改完自动重启节点。
- 内置节点上线后，`/api/info`、`/api/pair` 和 UDP 发现应答里会多一条 `kind: "tailscale"`、`source: "embedded"` 的端点，手机端选路逻辑不用改。
- tailnet ACL 需要允许手机访问这台电脑的 `48123/tcp`；节点本身只能被动监听，不做 relay 或 exit node。
- 断线后按 2s → 5s → 10s → 20s → 40s → 60s 退避重启，连续失败则停止重试并在卡片里报错；改端口（`port` 配置）时会自动重启节点。
- 子进程随插件生命周期启停：桥接关闭、DSH 退出或 stdin 断开时节点自动下线（`--ephemeral=false`，key 持久化在 `$DSH_HOME/storages/mobile-bridge/tsnet`，重启不用重新登录）。
- 状态目录可以改：卡片里的「状态目录」填绝对路径即可；也可以用 `DSH_MOBILE_BRIDGE_TSNET_DIR` 环境变量（面板留空时生效）。默认目录不可写时会自动依次回退到 `<插件目录>/.tsnet-state`、系统临时目录，成功后把结果记进设置，下次直接用。
- 二进制在 `host/bin/tsnode-<平台>-<架构>`。Windows/amd64 已随包提供。其他平台或改了 `host/tsnode/main.go` 后重新构建：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/build-tsnode.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File tools/build-tsnode.ps1 -Goos linux -Arch arm64
```

依赖全部来自仓库内的 `.toolchain/go-home` 模块缓存，默认离线构建（`GOPROXY=off`）；需要联网解析新依赖时加 `-Online`。

- 如果卡片报 `Access is denied` / `open ...tailscaled.log.conf: Access is denied`，说明安全软件拦了新编译的未签名二进制写文件：把 `host\bin\tsnode-*.exe` 加进信任列表（360 安全卫士、火绒等都会如此），再点「重启节点」。

## PC 协作组

同一个手机绑定过的电脑可以组成一个绑定组，组内机器互相是「队友」，可以直接把活派给另一台机器，再用那台机器的本地模型、GPU 或它特有的环境干活。典型用法：A 电脑的 agent 负责主框架，需要 3D 模型资产，于是把「要什么风格的概念图」派给 B，B 用自己的本地图像生成模型出图，产物落在 B 指定工作区的文件夹里，A 再把路径拿回去继续做模型。

怎么组队：

1. 手机连好两台（或更多）电脑，设置页出现「协作组」卡片。
2. 点「把已配对的主机连成协作组」。手机先向当前主机要一次性邀请码，再让其余每台主机带着这个码加入当前主机——所以不需要在每台电脑上手动输 IP 和邀请码。当前主机是枢纽，邀请码一次性、5 分钟过期。
3. 组名、成员和在线状态会显示在卡片里；电脑端「手机远控」面板的「PC 绑定组」卡片能做同样的事（创建组、生成邀请码、把别人的邀请码贴进来加入、移出成员、退出组）。

组内互派任务：

- 每台电脑都要在面板里设一个「协作工作区」：选一个已登记的 DSH 工作区（推荐，会话直接挂在它下面），或者手填一个绝对路径。派活时不指定 `workspace` 就用对端这个工作区；也可以显式传对端上的绝对路径。相对路径会被拒绝——旧版本按进程 cwd 解析，协作会话就跑出工作区了。
- 组内主机共享一个组密钥（`dshg_…`），握手后互相 `hello` 心跳，90 秒没心跳记为离线。组密钥能调手机版 API（建会话、写 prompt、读历史），但**不能订阅 `/api/events`**，也不会被算成「手机在线」去抢审批。设了协作工作区之后，组密钥建的会话只能落在这个工作区里：`cwd` 越界或 `workspaceId` 不是本机工作区一律 403（手机自己派的会话不受这条限制）。
- 收图走 `GET /api/collab/files`（列目录里的图片/模型文件）和 `GET /api/collab/file`（取单个文件），只允许读协作工作区内部，越界路径直接 403，单次最多 200 个文件、64 MB。

组内 agent 用一个 `collab` 工具：

| action | 作用 |
| --- | --- |
| `peers` | 列出组内主机、地址、在线状态、各自协作工作区 |
| `delegate` | 把 prompt 派给某台主机：在它的协作工作区里跑一轮（`sessionId` 可续跑已有会话），回传回复和新增文件 |
| `status` | 查某次委派还在不在跑 |
| `files` | 列对端协作工作区里的生成物 |
| `fetch` | 把对端某个文件取到本机指定路径 |

`delegate` 默认最多等 240 秒（可传 `waitSeconds`，上限 900 秒），返回 `status: done | timeout | error` 和文件清单。超时后可以带 `sessionId` 再调一次接着追，不会新建会话。派过去的会话默认 `workspace-write` 权限，只在这个工作区里读写（`permission` 参数可改）。生成的设计图只写在对端的协作工作区里，不会被拉到别的工作区。



## 删除与过滤

DSH 桌面端的“删除会话”只是把会话从工作区导航里移除/归档，`session-persistence-jsonl` 没有删除 API，日志会一直留在 `$DSH_HOME/sessions` 下。

桌面端的“归档”记在 workspace registry 的全局集合 `archivedSessionIds` 里，而归档会话**仍留在工作区的 `sessionIds` 中**（取消归档要还原原来的位置）。所以桥接层按两件事过滤和同步：

- 任务列表只返回仍属于某个工作区 `sessionIds`、且不在归档集合里的会话；`/api/workspaces` 的 `sessionIds` 同样剔掉归档会话（否则 App 按它分组会得到一个空分组），并在同一响应里给出 `archivedSessionIds`。
- host 每 3 秒对一次归档集合（读的是 registry 内存数组，开销可忽略），新增归档广播 `session.removed`、取消归档广播 `session.added`。手机停在列表页、或正开着那个会话时都会立刻跟着消失/回来，不用重新进列表。

归档在 PC 和手机之间是同一份状态：手机任务详情菜单的「归档会话」写的就是这个 registry 集合，电脑上的任务列表也会同步隐藏。彻底删除是另一条路：

- `DELETE /api/sessions/:id` 会拒绝运行中的会话，以及仍驻留在 DSH 内存里的会话；通过检查后把会话从所有工作区 detach、取消归档、删除 `$DSH_HOME/sessions/*/<sessionId>` 目录，并广播 `session.removed`。

App 的任务详情菜单里有“彻底删除”，删除后不可恢复。运行中的会话会拒绝删除；已打开过、仍驻留内存的会话会提示重启 DSH 后再删。

## 手机是怎么连上 DSH 的

手机不经过 DSH 的插件市场，也不走 Web GUI 的 Typert 协议。`dsh-mobile-bridge` 是一个 host bundle，加载后会自己监听一个局域网端口，手机直接连这个端口：

```
Android App  ──HTTP/JSON + SSE──▶  http://<PC-IP>:48123  ──▶  DSH host services
```

所以：

- 插件不会出现在普通“插件列表”里；它的 PC 控制端是 DSH 侧栏的「手机远控」按钮和设置里的插件卡片，没有独立网页。
- 验证是否加载：DSH 侧栏出现「手机远控」按钮，`http://127.0.0.1:48123/health` 返回 `{"ok":true,...}`。
- 手机与 PC 同一局域网，App 里输入 `PC 的局域网 IP:48123` 和「手机远控」面板里的 6 位配对码即可。

## 构建 Android

仓库已提交 Gradle Wrapper（固定 8.9）：

```powershell
$env:JAVA_HOME='<toolchain>\jdk-17'; $env:ANDROID_HOME='<toolchain>\android-sdk'
$env:GRADLE_USER_HOME='<toolchain>\gradle-home'
cd <repo-root>\android; .\gradlew.bat :app:assembleDebug --no-daemon
```

产物按 ABI 拆成 arm64-v8a / x86_64 / universal 三个包（单包 ~34 MB，universal ~55 MB）；签名、拆分与工具链细节见 **[docs/INSTALL.md](docs/INSTALL.md)**。

## 测试

```powershell
cd host; node scripts/check.mjs; node --test          # 167 例（含 1 条默认跳过的真实宿主用例）
powershell -File tools/test-android.ps1               # Android 数据层 34 例
node tools/verify-package.mjs                         # 包一致性门禁
```

全部门禁、五级验收口径与测试盲区见 **[docs/TESTING.md](docs/TESTING.md)**。

## HTTP API 摘要

鉴权：`Authorization: Bearer dshm_...`。错误统一 `{"error":{"code","message"}}`。

**完整契约（字段、错误码、SSE 事件、宿主兼容说明）见 [`docs/API.md`](docs/API.md)，本文只列摘要。**

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 无鉴权健康检查 |
| GET | `/` | 已移除，返回 404（控制端在 DSH 侧栏） |
| GET | `/api/discovery` | 未鉴权发现应答（与 UDP 广播同内容，供 NAT 中继查询） |
| GET | `/api/setup/state` | 控制面板状态（仅 loopback） |
| GET | `/api/setup/tailscale` | 内嵌节点状态（仅 loopback） |
| POST | `/api/setup/tailscale` | 内嵌节点启停/填 auth key（loopback + CSRF） |
| GET | `/api/setup/logs` | 面板「导出运行日志」，返回可保存的 .log（仅 loopback） |
| POST | `/api/setup/{code,revoke,settings,reset}` | 本机设置（CSRF） |
| POST | `/api/pair` | 6 位码换 token |
| GET | `/api/info` | 桥接/设备/设置信息 |
| GET | `/api/logs` | 手机端「导出运行日志」取的桥接日志（Bearer） |
| GET | `/api/workspaces` | 工作区列表（含 `sessionIds` 与 `archivedSessionIds`） |
| POST | `/api/workspaces` | 在默认工作区目录下新建文件夹并登记成工作区 |
| GET | `/api/permission-presets` | 权限预设清单（新建任务页用） |
| GET | `/api/sessions?q=` | 任务列表 |
| POST | `/api/sessions` | 创建任务，可带 prompt/plan/permission/images |
| DELETE | `/api/sessions/:id` | 彻底删除会话日志（运行中拒绝） |
| POST | `/api/sessions/:id/archive` | 归档会话（与桌面端同一份归档集合，运行中 409） |
| POST | `/api/sessions/:id/unarchive` | 取消归档，会话回到工作区原位置 |
| GET | `/api/sessions/:id` | 会话详情 + pending |
| GET | `/api/sessions/:id/history` | 历史事件 |
| POST | `/api/sessions/:id/{prompt,cancel,rename,permission,plan}` | 任务操作；prompt 可带 `images` |
| POST | `/api/subscribe` / `/api/unsubscribe` | 订阅会话流 |
| GET | `/api/pending` | 全部待处理 |
| POST | `/api/approvals/:id` | `{action:'allow-once'|'reject'}` |
| POST | `/api/questions/:id` | `{answers:[{id,selected,custom?}]}` |
| GET | `/api/events` | SSE（组密钥 403） |
| GET | `/api/group` | 绑定组状态：组、成员、邀请码、协作工作区 |
| POST | `/api/group/invite` | 手机向当前主机要一次性邀请码（无组时自动建组） |
| POST | `/api/group/link` | 手机让另一台主机加入当前主机：`{peerBaseUrl,code,selfBaseUrl?}` |
| POST | `/api/setup/group` | 面板操作：`create\|invite\|join\|leave\|forget\|refresh`（loopback + CSRF） |
| POST | `/api/group/join` | 组内握手入口，用邀请码换组密钥（公开） |
| POST | `/api/group/hello` | 组内心跳 + gossip，Bearer 组密钥 |
| GET | `/api/collab/files?cwd&since` | 列协作工作区里的生成物 |
| GET | `/api/collab/file?cwd&path=` | 取单个文件（只读协作工作区内部） |

SSE 事件：`hello`、`session.snapshot`、`session.event`、`assistant.delta`、`session.added/updated/status/activity/removed/error`、`approval.requested/closed`、`question.requested/closed`、`notice`。`session.removed` 带 `archived: true` 时表示归档（不是删除），手机据此就地显示「取消归档」。

## 安全模型

- 桥接绑定 `0.0.0.0`，不做公网端口映射或中继；远程访问只依赖 Tailscale 的 WireGuard 加密隧道，应用层仍是明文 HTTP。
- token 是 `dshm_` + 32 字节随机数，服务端只存 SHA-256；撤销后立即失效。
- 绑定组密钥是 `dshg_` + 32 字节随机数，同样只存 SHA-256；它只能用于组内握手和组内协作，可以调手机版内容 API，但读不到 `/api/events`、也不算「手机在线」。邀请码一次性、5 分钟过期、单码 5 次失败。
- `/api/group/hello` 不是公开接口：必须带 `Bearer dshg_...`（组密钥），未带或错误一律 401；已配对的设备 token（`dshm_...`）不能代替组密钥；本机没有绑定组时返回 503 `group/unavailable`。它与 `/api/group/join`（用一次性邀请码换组密钥，公开）是两回事。
- `/api/collab/file(s)` 只读指定协作工作区内部（`..`、绝对路径、目录外软链一律 403），单次最多 200 个文件、64 MB。
- 配对码 120 秒、单码 5 次失败、单 IP 每分钟 10 次。
- 面板的 `/api/setup/*` 只允许 loopback；DSH 页面跨端口访问时校验 Origin，并保留 CSRF。
- 状态文件：`$DSH_HOME/storages/mobile-bridge/state.json`，原子写，先写临时文件再改名；POSIX 下再 `chmod 600`。Windows 不认 POSIX 权限位（`chmod` 在那里是空操作），实际保护来自用户目录的 ACL——`%USERPROFILE%\.dsh` 默认只有本机当前用户可读，别把这个目录放进共享盘或漫游配置。
- 手机的 token 目前明文存在 SharedPreferences（Keystore 加密未实现）；不要 root 手机或共享备份。
- App 的明文（http）只对私网放行：`NetworkPolicy` 在建立连接前判定主机——私网字面量（`10/8`、`172.16/12`、`192.168/16`、`100.64/10`、`127/8`、`169.254/16`）、IPv6 回环/链路本地/唯一本地、单标签主机名与 `*.local` / `*.lan` / `*.home.arpa` 等内网后缀允许 http；公网 IP 或公网域名必须 https，否则直接拒绝并提示（错误码 `network/cleartext-blocked`）。`res/xml/network_security_config.xml` 记录了这条策略为何不能只用系统配置表达（Android 的网络安全配置只能按域名逐条声明，表达不了整段私网）。

## 已知限制

- 修改 desktop profile 后需要重启 Electron；当前会话不会自动加载新插件。client 面板与旧会话过滤都需要重启后生效。
- 面板显示 `Failed to fetch` 时，先确认 `http://127.0.0.1:48123/health` 返回 `{"ok":true,...}`。Electron 页面来源是 `dsh-app://dsh`，host 已放行该 Origin；如果仍失败，查看 DevTools 的 Network/CORS 报错，必要时把实际 Origin 发我。
- 删除会话是直接删日志目录，不可恢复；运行中的会话会拒绝删除。
- 计划模式依赖 `/plan` 命令；若某个 profile 没有加载 `@deepseek-ai/dsh-plan-mode`，接口返回 501。
- 审批默认超时：审批 120 秒、普通提问 120 秒、plan-review 180 秒，可在「手机远控」面板调整。
- 不支持模型切换、fork、子代理控制、always-allow、公网映射、iOS。
- 图片是否被理解取决于当前会话模型；不支持图片的模型会在 DSH 侧报错，App 不做模型能力预判。
- Tailscale 自动切换依赖电脑在 tailnet 内；手机可以用系统 Tailscale VPN，也可以启用 App 内嵌节点。内嵌节点需要一次 tailnet 登录，且只代理本 App 流量，不提供 MagicDNS/其他 App 的系统级访问。
- 内嵌节点目前只支持 arm64-v8a 和 x86_64 两种 ABI；32 位设备请改用系统 Tailscale。
- 虚拟机自动发现依赖宿主机上的 `discovery-relay` 常驻；只做 TCP 端口转发时仍可手动填 `宿主机IP:转发端口`。
- 工具参数/结果在手机上会截断（正文 4000 字、参数 800 字），用于展示而非完整导出。
- 组内委派要求各机能互相直连（同一局域网或同一 tailnet）；跨 NAT 需要自己打通网络。协作工作区必须是每台机器本地的绝对路径（推荐直接在面板里选已登记的 DSH 工作区），组里不共享文件系统。
- 组内成员之间是"信任对端"的关系：拿到组密钥的机器可以在这台机器上建会话并写 prompt。只把邀请码给自己人的机器。

## 交付物

- `dist/TS7-DSH-Remote-0.9.2-arm64-v8a-debug.apk`（arm64 手机，39.2 MB）
- `dist/TS7-DSH-Remote-0.9.2-x86_64-debug.apk`（模拟器/少数平板，40.6 MB）
- `dist/TS7-DSH-Remote-0.9.2-debug.apk`（universal，61.5 MB）
- `dist/dsh-mobile-bridge-0.9.2.tgz`
- `host/`（可独立安装的 DSH bundle）
- `android/`（完整源码）
- `README.md`