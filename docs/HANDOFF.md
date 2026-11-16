# TS7 DSH Remote — 交接文档

写给接手的人（或下一个 agent）。假设你熟 Node 与 Android，但没碰过这个仓库。当前状态见 [STATUS-2026-11-16.md](STATUS-2026-11-16.md)，设计评价见 [ANALYSIS-2026-11-16.md](ANALYSIS-2026-11-16.md)。

## 1. 这是什么

一个 DSH 桌面端的 host 插件 + 配套 Android App：让手机在局域网或 Tailscale 网络里远程驱动 DeepSeek Harness——看任务、发 prompt（可带 4 张图）、审批工具调用、审阅计划、收通知、归档会话、和另一台 PC 组队派活。

仓库两块：`host/`（插件，ESM 无构建，18 个模块 ≈6.5k 行）+ `android/`（App，Kotlin/Compose，36 个文件 ≈8.4k 行）。手机端不实现 DSH 的 Typert 协议，只走精简 JSON + SSE。

## 2. 五分钟上手（本机已完成安装）

```powershell
# 1 健康检查：能返回 {"ok":true,"version":"0.8.8",...} 说明插件已加载
curl.exe -s http://127.0.0.1:48123/health

# 2 跑测试（这项只在有 test/ 的机器上有效，见第 9 节）
cd host; node scripts/check.mjs; node --test

# 3 完整重启宿主（改 host 代码后必须做）
taskkill /IM "DeepSeek Harness.exe" /T /F
Start-Process "D:\Program Files\DeepSeek Harness\DeepSeek Harness.exe"
```

本机安装形态是**开发态 junction**：`C:\Users\Administrator\.dsh\profiles\desktop\node_modules\dsh-mobile-bridge` → `F:\AgentWorkProject\TS7 DSH手机远控\host`，并且该 profile 的 `package.json` 里 `dsh.profile.bundles` 含 `"dsh-mobile-bridge"`。所以改 `host/` 源码、重启宿主即生效，不用装包。换机器时要按 `README.md:65` 的方式装（`dsh plugin --profile <p> add file:dist\…tgz`）。

## 3. 代码地图

入口是 `host/lib/index.js`：装配 state → auth → group/collab → updater → tailscale → broadcast → hub → approvals → server，最后 `server.listen()`、`tailscale.start()`、注册 `collab` 工具。插件声明 `inject = ['sessionController', 'workspaceRegistry']`，其余服务从 `ctx` 现取。

改代码时按这张表定位：

| 你要做的事 | 改这里 |
| --- | --- |
| 加/改 HTTP 接口、SSE 事件 | `host/lib/server.js`（1,401 行，最大） |
| 面板 UI（侧栏按钮、设置卡片、绑定组、日志） | `host/lib/client.js`（1,176 行，无测试） |
| 手机能看到什么字段 | `host/lib/dto.js`（投影） |
| 审批/提问的双端行为与超时 | `host/lib/approvals.js` |
| 会话流、归档集合对账 | `host/lib/events.js` |
| 历史读取（含子代理会话） | `host/lib/history.js` |
| 内嵌 tailnet 节点 | `host/lib/tailscale.js` + `host/tsnode/main.go` |
| 组/邀请码/组密钥 | `host/lib/group.js`；委派在 `collab.js` + `tool.js` |
| 日志落盘与导出 | `host/lib/logs.js` |
| Android 连接/重连/待办合并 | `android/.../data/BridgeRepository.kt`（71 KB，最复杂） |
| Android 时间线与菜单 | `android/.../ui/screens/SessionScreen.kt` |
| Android 设置与日志导出 | `android/.../ui/screens/SettingsScreen.kt` |
| 内嵌节点（手机侧） | `android/gobridge/bridge.go` → 生成 `app/libs/gobridge.aar` |

## 4. 三条必须懂的机制

**配对与鉴权**：面板出 6 位码（120 s、单码 5 次失败、单 IP 10 次/分）→ `POST /api/pair` 换 `dshm_` + 32 字节 token → 服务端只存 SHA-256。之后所有请求带 `Authorization: Bearer`；`/api/setup/*` 只允许 loopback 且校验 Origin + CSRF。

**审批与提问是双端并发，不是代理**：请求到达后先建手机卡片，同时把请求交给桌面端；两端谁先答谁定结果。手机先答 → host 对已转发的 waterfall 事件下发 `cancel` 帧，桌面卡片 abort 后自行撤掉；桌面先答 → host 广播 `approval.closed` / `question.closed { answeredBy: 'desktop' }`。开关（`phoneEnabled`）与实时连接（`phoneConnected`）是两个独立判断：手机暂时断线时卡片留在待办里等它重连，只有开关关掉、且桌面端也不在，才交回 DSH。改这块前先读 `approvals.js` 的注释，里面写清了四种分支。

**归档与桌面端共用一份状态**：归档不是移出工作区，而是 registry 的全局集合 `archivedSessionIds`，且不产生事件。所以 `events.js` 每 3 秒对一次集合，把变化翻成 `session.removed` / `session.added`；列表接口必须同时过滤 `workspace.sessionIds` 和归档集合，`/api/workspaces` 的 `sessionIds` 也要剔掉归档 id（否则 App 得到一个空分组）。

## 5. 运行环境与外部依赖

- **宿主**：DSH Desktop，本机 `D:\Program Files\DeepSeek Harness\`，内置 node v24.21.0；插件声明 `engines.dsh = ">=0.2.1-rc.2 <0.3.0-0"`，当前宿主是 0.2.x。
- **端口**：`48123/tcp` 桥接、`48124/udp` 发现、`48126/udp` 宿主机发现中继（仅 NAT 虚拟机场景）。
- **工具链**：`.toolchain/`（JDK17、android-sdk、gradle-8.9、go、go-home、gradle-home），由 `tools/setup-toolchain.ps1` 从清华镜像拉取，约 2.7 GB，不入库。
- **代理**：本机 `HTTPS_PROXY=http://127.0.0.1:17890`；但 `tools/publish-github.ps1` 默认走 `127.0.0.1:7890`，发布时要显式 `-Proxy $env:HTTPS_PROXY`，否则连不上 GitHub（`tools/device-login.ps1` 同理）。
- **GitHub**：`origin = https://github.com/HelloWorldNock/dsh-mobile-bridge.git`；发布需要一个 `repo` scope 的 PAT，仓库里不存 token。
- **Tailscale**：内嵌节点首次使用要在浏览器完成一次 tailnet 授权，或用 `tskey-auth-…`；tailnet ACL 需放行手机到 PC 的 `48123/tcp`。

## 6. 状态、密钥与敏感文件

| 文件 | 内容 | 注意 |
| --- | --- | --- |
| `%DSH_HOME%\storages\mobile-bridge\state.json` | deviceId、hostName、devices（含 tokenHash）、group（组密钥）、peers、settings | 4.7 KB，权限 600；本机现有 11 条配对记录。**不要外发** |
| `%DSH_HOME%\storages\mobile-bridge\logs\bridge.log` | 运行日志，环形 1500 行 + 落盘，>3 MB 轮转 | 面板/手机都能导出，排障先看它 |
| `host/.tsnet-state\tailscaled.state` | 内嵌节点的 tailnet 密钥与登录态 | 已 gitignore；删掉就要重新授权 |
| `tools/discovery-relay.json` | 本机发现中继配置（内网地址、宿主机名） | 已 gitignore，模板是同目录 `discovery-relay.example.json` |
| `android/app/libs/gobridge.aar` + `gobridge-sources.jar` | 预编译 tsnet 桥（15.7 MB） | **已入库**，仓库 `.git` 因此有 17.9 MB |

## 7. 开发闭环（改什么 → 怎么生效）

| 改动 | 生效方式 |
| --- | --- |
| `host/lib/client.js`（面板） | 宿主窗口按 **F5** 刷页面即可，不必重启 |
| `host/lib/*`（其余 host 代码） | 必须**完整重启**宿主（托盘退出，或 taskkill + 重新启动） |
| `android/` | 重新 `gradle :app:assembleDebug` 并 `adb install -r` |
| `android/gobridge/bridge.go` | 用 `.toolchain` 的 Go + gomobile 重新绑定生成 AAR（命令在 `README.md:159`） |
| `host/tsnode/main.go` | `tools/build-tsnode.ps1`（默认离线，依赖在 `.toolchain/go-home`） |

**坑**：仓库里的 `tools/restart-dsh.cmd` 用 `start "DeepSeek Harness.exe"` 依赖 exe 在 PATH 或 `DSH_HOME` 下，而本机 exe 在 `D:\Program Files\DeepSeek Harness\`、`DSH_HOME` 是 `C:\Users\Administrator\.dsh`——这个脚本在本机会 kill 掉进程后起不来。用第 2 节里的 `Start-Process` 绝对路径启动。

## 8. 构建与发布

```powershell
# 打包插件（会校验图标 ≤256 KiB、files 清单、tgz 必需文件）
powershell -NoProfile -File tools/pack-plugin.ps1        # → dist/dsh-mobile-bridge-<ver>.tgz

# 构建 APK
$env:JAVA_HOME='<repo>\.toolchain\jdk-17'
$env:ANDROID_HOME='<repo>\.toolchain\android-sdk'
$env:GRADLE_USER_HOME='<repo>\.toolchain\gradle-home'
& '<repo>\.toolchain\gradle-8.9\bin\gradle.bat' -p '<repo>\android' :app:assembleDebug --no-daemon
```

发布链路是 `tools/publish-github.ps1`（幂等：仓库/release/资产已存在则复用或替换），它建仓、推 main、打 `vX.Y.Z`、传资产；版本号要同时改三处：`host/package.json`、`host/lib/index.js` 的 `VERSION`、`android/app/build.gradle.kts` 的 `versionCode`/`versionName`。

**发布状态（2026-11-16 收口后）**：`v0.8.9` 已打在 `dbe4a9a` 上并推到 origin，GitHub Release 内含 tgz / APK / `tsnode-windows-amd64.exe` / `SHA256SUMS-0.8.9.txt`；`contrib/` 的 tarball 与 version 已指 0.8.9。0.8.5–0.8.8 没有补发（0.8.8 产物落后源码，补发语义不清，按整改路线 D-1 直接跳版）。

## 9. 测试

`host/test/` 下 12 个文件、101 个用例（`node --test`，约 3.8 s），覆盖 auth/approvals/collab/group/server/dto/events/history/logs/endpoints/tailscale/update；`scripts/check.mjs` 做语法与导出检查（18 个模块）。

**测试已入库**：`.gitignore` 里的无锚点 `test/` 改成 `/test/`，`git ls-files host/test` 现在是 12 个文件，新 clone 直接 `cd host && npm test` 就能跑满 101 例。发布前还有一道包一致性门禁：`node tools/verify-package.mjs`（解包逐文件比 SHA-256 + 三处版本号一致）。

有 CI：`.github/workflows/ci.yml`（push/PR 跑 `check.mjs` + `node --test`，另一个 job 打包后过 `verify-package.mjs`）。`server.test.js`（1,126 行）是主要回归网；`client.js` 面板、`tool.js`、`index.js`、`state.js`、`discovery.js`、`preview.js` 无测试。

## 10. 已知坑速查

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 手机上看不到「归档会话」菜单 | 手机上装的是 0.8.7，服务端 0.8.8（日志里那条 `app 0.8.7-debug` 就是当前真机） | 换装 0.8.8 APK |
| 换了 tgz 装到别的机器，子代理会话打不开、新建工作区是空壳 | `dist` 里的 tgz 打于 11/8，缺 11/14 的 0.2.x 适配 | 重新 `pack-plugin.ps1`，并逐文件比对 tgz 内 `lib/*.js` 与源码 |
| 面板报 `Failed to fetch` | 桥接没起或 Origin 不服 | 先 `curl 127.0.0.1:48123/health`；页面来源是 `dsh-app://dsh`，host 已放行 |
| 侧栏按钮点了就消失 | client bundle 报错（历史上有过 `BRIDGE_PORT` 未定义） | F5；仍不行完整重启宿主 |
| 内嵌节点报 `Access is denied` / `tailscaled.log.conf` | 新编译的 tsnode 未签名，被安全软件拦写文件 | 把 `host\bin\tsnode-*.exe` 加白，再点「重启节点」 |
| 状态目录不可写 | 默认目录权限问题 | 插件会依次回退 `<插件目录>/.tsnet-state` → 临时目录（本机就在 `.tsnet-state`） |
| 「检查更新」一直超时 | 代理不通（日志里 `update check failed ... timeout`） | 检查 `HTTPS_PROXY`，面板重试 |
| Gradle 报 `AccessDeniedException` + `Low Mandatory Level` | `.toolchain` 带了低完整性标签 | `icacls "<toolchain>" /setintegritylevel '(OI)(CI)High'` |
| MuMu 连不上 | 模拟器 NAT 网段 | 填 `10.0.2.2:48123` |
| 手机在虚拟机宿主机之间发现不了 | DSH 在 NAT 虚拟机里 | 宿主机跑发现中继（`install-discovery-relay.ps1`，UDP 48126）+ TCP portproxy |
| 超时和文档不一致 | `host/README.md` 配置表写 30/60/120 s，实际默认值在 `state.js`：120/120/180 s | 0.8.9 起只有一处定义：`state.js` 的 `TIMEOUT_DEFAULTS`，`index.js` 直接引用；`host/README.md` 仍停在 0.3.0，以根 README 为准 |
| 手机上「取消归档」找不到 | 0.8.9 之前只能电脑恢复 | 换装 0.8.9 APK：归档后任务会留在当前任务里，菜单变「取消归档」；被电脑归档时顶部还有提示条 |

## 11. 接手后先做什么

阶段一（交付收口）已在 0.8.9 完成：测试入库、哈希门禁、重打包核对、超时统一、手机取消归档、README/contrib 补齐、升版发版、最小 CI。**唯一没做完的是 R09 真机矩阵**——按 [ACCEPTANCE-0.8.9.md](ACCEPTANCE-0.8.9.md) 逐项跑并留档。

接着按 [deepseek_markdown_20261116_b475f4.md](deepseek_markdown_20261116_b475f4.md) 阶段二推进：启动兼容性探针（R11）→ Android P0 数据层测试（R12）→ 真实 DSH 契约用例（R13）→ Keystore 加密 token（R14）→ 网络安全配置（R15）→ `/api/group/hello` 鉴权审计（R16）→ 协作组角色权限设计（R17）→ 构建可复现（R18，含提交 gradlew wrapper）。功能扩展（审批 always-allow / 模型切换 / fork / 子代理控制）排在最后。

## 12. 交接验收清单

- [ ] `curl 127.0.0.1:48123/health` 返回 `ok`，版本与 `host/package.json` 一致
- [ ] DSH 侧栏有「手机远控」按钮，面板能出 6 位码、能看到已配对设备
- [ ] 手机配对成功，任务列表按工作区分组，能新建任务并看到流式回复
- [ ] 审批与提问在手机和桌面**同时**弹卡，任一端处理后另一端撤卡
- [ ] 图片能发也能在时间线里显示（点开全屏）
- [ ] 归档后手机列表消失；手机端菜单能归档，也能「取消归档」（需 0.8.9 APK）
- [ ] 内嵌节点卡片能启动并给出登录地址；断线按 2→60 s 退避
- [ ] 两台 PC 能组队，`delegate` 能在对端协作工作区产出文件
- [ ] 设置里「导出运行日志」能拿到含主机段落的文本
- [ ] `cd host; npm test` 101 例通过（确认 test/ 已入库后再作为常规门禁）
- [ ] `pack-plugin.ps1` 产物与源码逐文件一致，`dist/` 版本号与三处版本号一致
