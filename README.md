# TS7 DSH Remote

在局域网或 Tailscale 网络中，用 Android 手机远程操作 DeepSeek Harness（DSH）的 host 插件 + 原生 App。

参考 SKYBOX 的局域网配对方式：桌面端显示设备 ID、IP 和 6 位配对码；手机扫码/输入后建立长期 token。默认所有流量留在局域网；电脑开启 Tailscale 后，手机在局域网外会自动改走 tailnet，回到局域网再自动切回直连。手机可以同时连接多台已安装插件的主机，新建任务时最多附带 4 张图片。远程也可以不装系统 Tailscale，直接启用 App 内的实验性内嵌节点。

## 功能

- 任务列表：按桌面端工作区分组，默认全部收起（只看工作区名、会话数和运行中数量），点标题展开/收起；搜索时自动展开匹配的工作区，并匹配工作区、标题和目录
- 多主机：同时配对并保持多台 DSH 的 SSE 连接，顶部主机胶囊一键切换；各主机的任务、审批和通知互不串台
- 局域网/远程自动切换：电脑开启 Tailscale 时，插件同时广播局域网和 tailnet 地址；手机离开 Wi-Fi 自动改走 Tailscale，回到局域网自动切回直连
- 内嵌 Tailscale（实验）：App 自带 userspace tsnet 节点，不占用系统 VPN，可与系统 Tailscale 或其他 VPN 共存；设置里一键随 App 启动/停止，只把本 App 的 DSH 流量送进 tailnet
- 彻底删除：任务详情菜单可直接删除会话日志（不可恢复）
- 新建任务：工作区列表与桌面端同步（取不到时退回最近会话目录并给出重试）；选择工作区、输入 prompt、可选计划模式/权限预设
- 图片：新建任务或继续任务时最多附带 4 张 PNG/JPEG/WebP/GIF，App 先压到长边 1600、单张 ≤ 3.5 MB；是否理解图片取决于当前 DSH 模型
- 虚拟机自动发现：宿主机跑一个 UDP 中继，把手机的发现包转发给 NAT 虚拟机，手机不用再手填转发地址
- 任务详情：默认只显示对话、轮次状态和错误，工具调用合并成一行摘要（如「执行 5 步 · Bash, Read」），点摘要或菜单「显示执行细节」才展开完整过程；流式回复、停止/重命名
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
  test/               node:test 测试
  locale/             市场卡片标题与描述（zh / en）
  icon.png            插件图标（≤ 256 KiB）
contrib/              分发元数据：awesome-dsh-plugin YAML、dshmarket plugins.json
tools/                打包脚本 pack-plugin.ps1、图标生成、重启脚本、发现中继
android/              Android 客户端（Gradle + Compose）
  gobridge/           内嵌 Tailscale 的 Go 源码（gomobile 生成 AAR）
  app/libs/           预编译 gobridge.aar（arm64-v8a + x86_64）
dist/                 debug APK 与插件 tgz 产物
.toolchain/           JDK17 / Android SDK / Gradle / Go（本地工具链）
```

## 安装 host 插件（desktop profile）

本机已完成安装并重启验证：

1. `%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-mobile-bridge` 是指向 `<repo-root>\host` 的目录联接。
2. `profiles\desktop\package.json` 的 `dsh.profile.bundles` 包含 `"dsh-mobile-bridge"`。

当前桥接已在运行，侧栏「手机远控」按钮与面板已在真实 desktop 窗口验证。

更新 client `/client.js` 后，在 DSH 窗口按 **F5** 刷新页面即可重新加载，不需要重启整个应用；更新 host `server.js` 才会需要重启 Electron。只关闭面板不会重新加载 client。

如果侧栏按钮点击后消失，或根本不显示：先按 F5；仍不行再完整退出 DSH（托盘退出，不能只关窗口）。0.1.0 已修复 `BRIDGE_PORT` 未定义导致的整块组件卸载，并为面板加了错误边界。也可以双击 `tools/restart-dsh.cmd` 做完整重启（会关闭当前会话窗口，重新打开后继续原会话）。

`dsh-mobile-bridge` 随 DSH 桌面端自动启动：它是 desktop profile 的 host bundle，DSH 启动时加载并监听端口，不需要手工运行；关闭 DSH 后端口也随之消失。PC 侧控制端是 DSH 内的 client 插件，不再提供网页设置页。

- 桥接监听 `0.0.0.0:48123`，UDP 发现 `48124`；虚拟机场景由宿主机中继在 `48126/udp` 代答
- 打开方式：DSH 侧栏底部「手机远控」按钮，或 设置 → 插件 → 手机远控 卡片
- 面板显示设备 ID、IP、6 位配对码（120 秒有效）、已配对设备、开关和超时
- 面板底部「版本」卡片显示当前插件版本，「检查更新」会去 GitHub 比对最新 release；手机端 设置 → 关于 同样有「检查更新」，启动后 6 小时内只自动查一次
- 图标使用 `绘制图标.png` 生成的 Q 版鲸鱼 adaptive icon，生成脚本为 `tools/make_icon.py`

本机这份是开发态：目录联接 + `dsh.profile.bundles` 里写着 `"dsh-mobile-bridge"`，改 `host/` 里的代码立即生效。

> 0.3.1 起 `/api/workspaces` 会返回每个工作区的 `sessionIds`，手机端按它做工作区分组；旧版桥接没有该字段、工作区列表为空或路径大小写不一致时，App 会退回按会话 `cwd` 归组，不再把所有任务塞进“未归类”。0.3.2 把工作区 `updatedAt` 统一成毫秒数，修掉新版 DSH 下手机端「没有可用工作区」。0.3.0 新增图片 prompt、`/api/discovery` 和局域网/Tailscale 端点上报。host bundle 只在 DSH 启动时加载，升级后需要完整退出并重启 DSH（不是只按 F5），`/api/info` 才会带 `endpoints` 和图片能力。如果 DSH 跑在虚拟机里，Tailscale 必须装在虚拟机内，或按下面的“备用地址”方式把宿主机的 tailnet 转发地址告诉手机。

## 打包为可分发插件

`host/` 已是完整可发布的 DSH 插件包（manifest、`cordis.patch.yml`、host bundle、client 面板、`locale/`、`icon.png`、LICENSE）：

```powershell
powershell -NoProfile -File tools/pack-plugin.ps1
# → dist/dsh-mobile-bridge-0.8.3.tgz（约 8.9 MB / 23 个文件，含 bin/tsnode-windows-amd64.exe）
```

包体积变大是因为从 0.8.0 起插件自带内嵌 Tailscale 节点程序；节点程序缺失时脚本只警告并提示先跑 `tools/build-tsnode.ps1`，但打包清单里缺它会直接失败。插件、APK 与 GitHub Release tag 现在用同一个版本号。

脚本校验图标体积（≤ 256 KiB）与包内清单后调 `npm pack`，清单不全直接失败。装到任意 profile：

```powershell
dsh plugin --profile <profile> add file:<repo-root>\dist\dsh-mobile-bridge-0.8.3.tgz
```

`dsh plugin add` 会同时写入该 profile 的 `dsh.profile.bundles`，重启 DSH 即加载，桥接按 `cordis.patch.yml` 的默认值监听 `48123`/`48124`。已用一次性 profile `pkgtest` 实测安装 → `--dump-config` 能看到 `id: mobile-bridge` 及端口配置。

分发渠道元数据在 `contrib/`（awesome-dsh-plugin 的 YAML 与 dshmarket 的 `plugins.json`），发布前替换 `OWNER`/`REPO`、把 tgz 传到 GitHub Release（同时附上 `tsnode-windows-amd64.exe` 与 `SHA256SUMS-0.8.3.txt`，方便有人从源码安装时不必自己编译）；细节见 [`contrib/README.md`](contrib/README.md) 与 [`host/README.md`](host/README.md)。

## 手机连接

1. 安装 `dist/TS7-DSH-Remote-0.8.3-debug.apk`。
2. 手机与电脑连同一个 Wi-Fi，或都登录同一个 Tailscale tailnet。
3. 打开 App，等待 UDP 自动发现，或手动输入 `电脑IP:48123`（远程时填 `100.x.x.x:48123`，并打开表单下方的「通过 Tailscale 连接」开关）。
4. 在 DSH 侧栏「手机远控」面板读取 6 位配对码，输入手机。
5. 配对成功后 token 保存在本机，后续自动重连；局域网和 Tailscale 两条线路会自动选择，无需手动切换。
6. 需要更多主机时，在 App 顶部的「主机 +」或 设置 → 添加另一台主机，重复 2–5。每台主机独立保存 token、任务和审批；同一台电脑运行多个 DSH 实例时，需要给各自的桥接插件配置不同端口。App 按「设备 ID + 端口」区分主机，共用状态文件的多个实例也能分别保留。
7. 发图片：新建任务页或任务详情输入框点「图片」，从系统相册选 1–4 张；App 会压到长边 1600、单张 ≤ 3.5 MB 后以 base64 随 prompt 发送。模型不支持图片时，DSH 会返回自己的错误。

MuMu 模拟器使用 NAT，宿主地址是 `10.0.2.2`；测试时填 `10.0.2.2:48123`。

如果 DSH 跑在 VMware/VirtualBox 的 NAT 虚拟机里（例如虚拟机 IP 在 `192.168.x.x` 网段），手机既连不上该地址，也收不到虚拟机的 UDP 广播。宿主机需要做两件事：

```powershell
# 1) TCP：把宿主机 48125 转发到虚拟机的桥接端口
netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=48125 connectaddress=203.0.113.20 connectport=48123

# 2) UDP：复制 tools/discovery-relay.example.json 为 tools/discovery-relay.json，改好本机地址后注册发现中继
powershell -NoProfile -ExecutionPolicy Bypass -File tools/install-discovery-relay.ps1
```

`discovery-relay.json` 里填虚拟机的 `target`（`IP:48124`）、宿主机访问转发端口的 `httpUrl`、宿主机的 `publicHost`、转发端口 `publicPort`，以及可选的宿主机 Tailscale 地址 `tailscaleHost` 和显示名 `hostName`。中继监听 `48126/udp`，收到发现包后先查 `/api/discovery`；旧版桥接没有该接口时退回 `/health`，用配置里的显示名补一条应答。应答里的地址统一改写成宿主机地址（`publicHost:publicPort` 和 Tailscale 地址），所以手机看到的是可达的入口，而不是虚拟机的 `192.168.x.x` 地址。App 同时扫描 `48124` 和 `48126`，局域网里的普通 DSH 和 NAT 虚拟机都能自动出现。防火墙需放行 `48126/udp`。更彻底的做法是把虚拟机网卡改成桥接，让虚拟机直接获得路由器网段地址。

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

桥接层做了两件事：

- 任务列表只展示仍属于某个工作区 `sessionIds` 的会话，已移出工作区的旧会话默认不再返回。
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

```powershell
$env:JAVA_HOME='<toolchain>\jdk-17'
$env:ANDROID_HOME='<toolchain>\android-sdk'
$env:GRADLE_USER_HOME='<toolchain>\gradle-home'
& '<toolchain>\gradle-8.9\bin\gradle.bat' `
  -p '<repo-root>\android' :app:assembleDebug --no-daemon
```

产物：`android/app/build/outputs/apk/debug/app-debug.apk`。debug 包名是 `com.ts7.dshremote.debug`。

如果 Kotlin 编译报 `AccessDeniedException` 且 `whoami /groups` 显示 `Low Mandatory Level`，说明 `.toolchain` 带了低完整性标签，执行一次：

```powershell
icacls "<toolchain>" /setintegritylevel '(OI)(CI)High'
```

安装到 MuMu（把 MuMu 自带的 `adb.exe` 加进 PATH，或写它的完整路径）：

```powershell
adb install -r `
  '<repo-root>\android\app\build\outputs\apk\debug\app-debug.apk'
adb shell am start `
  -n com.ts7.dshremote.debug/com.ts7.dshremote.MainActivity
```

## 测试

```powershell
cd host
npm run check
npm test
```

当前 80 个 host 测试全部通过，覆盖：配对/token/撤销、DTO 投影、审批接管与回退、双端审批（桌面先答/手机先答撤销桌面卡/被动结果继续等手机/断连）、问题回答、plan-review、HTTP 鉴权、CSRF、会话/历史/prompt/rename/cancel/permission/plan、创建会话（`sessionId` 续跑、cwd 归位工作区、派发失败清理空会话）、图片 prompt（格式/大小/数量校验）、旧会话过滤与文件删除、局域网/Tailscale 地址分类与端点合并、`/api/info` 端点上报、绑定组创建/邀请码/加入/退出/gossip、组密钥权限边界（含派活不能越出协作工作区）、协作工作区配置（相对路径拒绝）、协作工作区下的文件列举与越界拒绝、组内委派（workspaceId 优先、cwd 回退、续跑、并发权限、缺失时报错）。

MuMu 端到端已验证：配对、任务列表、新建任务、流式回复、审批允许/拒绝、plan-review 批准后继续、通知动作、前台服务、断线重连、图片选择与发送、NAT 虚拟机自动发现。亮色 UI、Q 版图标、过滤后的任务列表和 DSH 侧栏控制面板都实际跑过。

DSH client 插件已在隔离 web profile 和真实 desktop 窗口验证：侧栏出现「手机远控」按钮，点击后弹出面板，能读取桥接状态、设备、配对码和设备列表；修复 `BRIDGE_PORT` 未定义后，按钮在面板关闭后仍保持存在，错误边界与 `dsh-app://app` CORS 生效。

注意：PC 控制端已从网页改为 DSH client 插件，`host/lib/setup-page.js` 已删除。更新 `client.js` 后在 DSH 窗口按 F5 刷新页面即可加载；只有修改 host `server.js` 才需要完整重启 Electron。需要完整重启时可运行 `tools/restart-dsh.cmd`。

## HTTP API 摘要

鉴权：`Authorization: Bearer dshm_...`。错误统一 `{"error":{"code","message"}}`。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 无鉴权健康检查 |
| GET | `/` | 已移除，返回 404（控制端在 DSH 侧栏） |
| GET | `/api/discovery` | 未鉴权发现应答（与 UDP 广播同内容，供 NAT 中继查询） |
| GET | `/api/setup/state` | 控制面板状态（仅 loopback） |
| POST | `/api/setup/{code,revoke,settings,reset}` | 本机设置（CSRF） |
| POST | `/api/pair` | 6 位码换 token |
| GET | `/api/info` | 桥接/设备/设置信息 |
| GET | `/api/workspaces` | 工作区列表（含 `sessionIds`） |
| GET | `/api/sessions?q=` | 任务列表 |
| POST | `/api/sessions` | 创建任务，可带 prompt/plan/permission/images |
| DELETE | `/api/sessions/:id` | 彻底删除会话日志（运行中拒绝） |
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

SSE 事件：`hello`、`session.snapshot`、`session.event`、`assistant.delta`、`session.added/updated/status/activity/removed/error`、`approval.requested/closed`、`question.requested/closed`、`notice`、`resync`。

## 安全模型

- 桥接绑定 `0.0.0.0`，不做公网端口映射或中继；远程访问只依赖 Tailscale 的 WireGuard 加密隧道，应用层仍是明文 HTTP。
- token 是 `dshm_` + 32 字节随机数，服务端只存 SHA-256；撤销后立即失效。
- 绑定组密钥是 `dshg_` + 32 字节随机数，同样只存 SHA-256；它只能用于组内握手和组内协作，可以调手机版内容 API，但读不到 `/api/events`、也不算「手机在线」。邀请码一次性、5 分钟过期、单码 5 次失败。
- `/api/collab/file(s)` 只读指定协作工作区内部（`..`、绝对路径、目录外软链一律 403），单次最多 200 个文件、64 MB。
- 配对码 120 秒、单码 5 次失败、单 IP 每分钟 10 次。
- 面板的 `/api/setup/*` 只允许 loopback；DSH 页面跨端口访问时校验 Origin，并保留 CSRF。
- 状态文件：`$DSH_HOME/storages/mobile-bridge/state.json`，原子写，权限 600。
- 手机的 token 目前明文存在 SharedPreferences（Keystore 加密未实现）；不要 root 手机或共享备份。
- App 开启 `usesCleartextTraffic`：局域网里是明文 HTTP；Tailscale 隧道本身加密，但应用层没有额外 TLS。

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

- `dist/TS7-DSH-Remote-0.8.3-debug.apk`
- `dist/dsh-mobile-bridge-0.8.3.tgz`
- `host/`（可独立安装的 DSH bundle）
- `android/`（完整源码）
- `README.md`
