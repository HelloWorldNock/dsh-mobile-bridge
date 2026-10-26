# TS7 DSH Remote

在同一个局域网内，用 Android 手机远程操作 DeepSeek Harness（DSH）的 host 插件 + 原生 App。

参考 SKYBOX 的局域网配对方式：桌面端显示设备 ID、IP 和 6 位配对码；手机扫码/输入后建立长期 token。所有流量留在局域网，不经过公网。

## 功能

- 任务列表：搜索、运行状态、工作区、计划/权限标签；默认隐藏已从工作区移除的旧会话
- 彻底删除：任务详情菜单可直接删除会话日志（不可恢复）
- 新建任务：选择工作区、输入 prompt、可选计划模式/权限预设
- 任务详情：时间线、工具调用与结果、流式回复、停止/重命名
- 权限审批：手机优先弹出审批卡；允许一次/拒绝；无人接管时回退桌面
- 计划审阅：plan-review 卡片展示完整计划，批准后退出计划模式并继续执行
- 普通提问：单选/多选/自定义回答
- 通知：审批、提问、任务完成；通知动作可直接允许/拒绝
- 前台服务：保持 SSE 连接；断线自动重连
- 亮色 UI：浅色背景、DeepSeek 蓝强调色、自适应 Q 版鲸鱼图标

## 架构

```
Android App (Kotlin + Compose)
        │  HTTP JSON + SSE (Bearer token)
        ▼
dsh-mobile-bridge (host 插件, 0.0.0.0:48123)
        │  Host service 直调
        ▼
ctx.sessionController / ctx.sessions / ctx.workspaceRegistry
ctx.approval / ctx.userQuestions / ctx.commands
```

- 手机端不实现 DSH 的 Typert 协议，只使用精简 JSON/SSE。
- 审批通过 `approval/request` waterfall 抢占；只有在线手机且 `phoneFirst` 开启时接管。
- 无人接管或超时：有桌面客户端时 `next()` 回退；没有桌面客户端时返回 `unavailable`，避免挂起。
- 计划模式通过 agent 的 `/plan`、`/plan off` 命令切换；计划正文来自 `plan-review` 问题的 `intent.detail`，不依赖不可用的根 `planMode` 服务。

## 目录

```
host/                 DSH host 插件（无构建步骤，ESM）
  lib/                server / auth / events / approvals / dto / discovery ...
  test/               node:test 测试
  locale/             市场卡片标题与描述（zh / en）
  icon.png            插件图标（≤ 256 KiB）
contrib/              分发元数据：awesome-dsh-plugin YAML、dshmarket plugins.json
tools/                打包脚本 pack-plugin.ps1、图标生成、重启脚本
android/              Android 客户端（Gradle + Compose）
docs/screenshots/     MuMu 联调截图
dist/                 debug APK 与插件 tgz 产物
.toolchain/           JDK17 / Android SDK / Gradle（本地工具链）
```

## 安装 host 插件（desktop profile）

本机已完成安装并重启验证：

1. `%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-mobile-bridge` 是指向 `<repo-root>\host` 的目录联接。
2. `profiles\desktop\package.json` 的 `dsh.profile.bundles` 包含 `"dsh-mobile-bridge"`。

当前桥接已在运行，侧栏「手机远控」按钮与面板已在真实 desktop 窗口验证（`docs/screenshots/84-panel-live.png`）。

更新 client `/client.js` 后，在 DSH 窗口按 **F5** 刷新页面即可重新加载，不需要重启整个应用；更新 host `server.js` 才会需要重启 Electron。只关闭面板不会重新加载 client。

如果侧栏按钮点击后消失，或根本不显示：先按 F5；仍不行再完整退出 DSH（托盘退出，不能只关窗口）。0.1.0 已修复 `BRIDGE_PORT` 未定义导致的整块组件卸载，并为面板加了错误边界。也可以双击 `tools/restart-dsh.cmd` 做完整重启（会关闭当前会话窗口，重新打开后继续原会话）。

`dsh-mobile-bridge` 随 DSH 桌面端自动启动：它是 desktop profile 的 host bundle，DSH 启动时加载并监听端口，不需要手工运行；关闭 DSH 后端口也随之消失。PC 侧控制端是 DSH 内的 client 插件，不再提供网页设置页。

- 桥接监听 `0.0.0.0:48123`，UDP 发现 `48124`
- 打开方式：DSH 侧栏底部「手机远控」按钮，或 设置 → 插件 → 手机远控 卡片
- 面板显示设备 ID、IP、6 位配对码（120 秒有效）、已配对设备、开关和超时；真实 desktop 验证截图见 `docs/screenshots/84-panel-live.png`
- 图标使用 `绘制图标.png` 生成的 Q 版鲸鱼 adaptive icon，生成脚本为 `tools/make_icon.py`

本机这份是开发态：目录联接 + `dsh.profile.bundles` 里写着 `"dsh-mobile-bridge"`，改 `host/` 里的代码立即生效。

## 打包为可分发插件

`host/` 已是完整可发布的 DSH 插件包（manifest、`cordis.patch.yml`、host bundle、client 面板、`locale/`、`icon.png`、LICENSE）：

```powershell
powershell -NoProfile -File tools/pack-plugin.ps1
# → dist/dsh-mobile-bridge-0.1.0.tgz（约 138 KB / 17 个文件）
```

脚本校验图标体积（≤ 256 KiB）与包内清单后调 `npm pack`，清单不全直接失败。装到任意 profile：

```powershell
dsh plugin --profile <profile> add file:<repo-root>\dist\dsh-mobile-bridge-0.1.0.tgz
```

`dsh plugin add` 会同时写入该 profile 的 `dsh.profile.bundles`，重启 DSH 即加载，桥接按 `cordis.patch.yml` 的默认值监听 `48123`/`48124`。已用一次性 profile `pkgtest` 实测安装 → `--dump-config` 能看到 `id: mobile-bridge` 及端口配置。

分发渠道元数据在 `contrib/`（awesome-dsh-plugin 的 YAML 与 dshmarket 的 `plugins.json`），发布前替换 `OWNER`/`REPO`、把 tgz 传到 GitHub Release；细节见 [`contrib/README.md`](contrib/README.md) 与 [`host/README.md`](host/README.md)。

## 手机连接

1. 安装 `dist/TS7-DSH-Remote-0.1.0-debug.apk`。
2. 手机与电脑连同一个 Wi-Fi。
3. 打开 App，等待 UDP 自动发现，或手动输入 `电脑IP:48123`。
4. 在 DSH 侧栏「手机远控」面板读取 6 位配对码，输入手机。
5. 配对成功后 token 保存在本机，后续自动重连。

MuMu 模拟器使用 NAT，宿主地址是 `10.0.2.2`；测试时填 `10.0.2.2:48123`。

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
$env:JAVA_HOME='<repo-root>\.toolchain\jdk-17'
$env:ANDROID_HOME='<repo-root>\.toolchain\android-sdk'
$env:GRADLE_USER_HOME='<repo-root>\.toolchain\gradle-home'
& '<repo-root>\.toolchain\gradle-8.9\bin\gradle.bat' `
  -p '<repo-root>\android' :app:assembleDebug --no-daemon
```

产物：`android/app/build/outputs/apk/debug/app-debug.apk`。debug 包名是 `com.ts7.dshremote.debug`。

如果 Kotlin 编译报 `AccessDeniedException` 且 `whoami /groups` 显示 `Low Mandatory Level`，说明 `.toolchain` 带了低完整性标签，执行一次：

```powershell
icacls "<repo-root>\.toolchain" /setintegritylevel '(OI)(CI)High'
```

安装到 MuMu：

```powershell
& 'adb' install -r `
  '<repo-root>\android\app\build\outputs\apk\debug\app-debug.apk'
& 'adb' shell am start `
  -n com.ts7.dshremote.debug/com.ts7.dshremote.MainActivity
```

## 测试

```powershell
cd host
npm run check
npm test
```

当前 22 个 host 测试全部通过，覆盖：配对/token/撤销、DTO 投影、审批接管与回退、问题回答、plan-review、HTTP 鉴权、CSRF、会话/历史/prompt/rename/cancel/permission/plan、创建会话、旧会话过滤与文件删除。

MuMu 端到端已验证：配对、任务列表、新建任务、流式回复、审批允许/拒绝、plan-review 批准后继续、通知动作、前台服务、断线重连。亮色 UI 截图见 `docs/screenshots/50-light-connect.png`、`51-light-session.png`；Q 版图标见 `54-chibi-icon.png`；过滤后的任务列表见 `55-filtered-tasks.png`；DSH 侧栏控制面板见 `docs/screenshots/84-panel-live.png`。

DSH client 插件已在隔离 web profile 和真实 desktop 窗口验证：侧栏出现「手机远控」按钮，点击后弹出面板，能读取桥接状态、设备、配对码和设备列表；修复 `BRIDGE_PORT` 未定义后，按钮在面板关闭后仍保持存在，错误边界与 `dsh-app://app` CORS 生效。截图 `84-panel-live.png` 即真实 desktop 面板。

注意：PC 控制端已从网页改为 DSH client 插件，`host/lib/setup-page.js` 已删除。更新 `client.js` 后在 DSH 窗口按 F5 刷新页面即可加载；只有修改 host `server.js` 才需要完整重启 Electron。需要完整重启时可运行 `tools/restart-dsh.cmd`。

## HTTP API 摘要

鉴权：`Authorization: Bearer dshm_...`。错误统一 `{"error":{"code","message"}}`。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 无鉴权健康检查 |
| GET | `/` | 已移除，返回 404（控制端在 DSH 侧栏） |
| GET | `/api/setup/state` | 控制面板状态（仅 loopback） |
| POST | `/api/setup/{code,revoke,settings,reset}` | 本机设置（CSRF） |
| POST | `/api/pair` | 6 位码换 token |
| GET | `/api/info` | 桥接/设备/设置信息 |
| GET | `/api/workspaces` | 工作区列表 |
| GET | `/api/sessions?q=` | 任务列表 |
| POST | `/api/sessions` | 创建任务，可带 prompt/plan/permission |
| DELETE | `/api/sessions/:id` | 彻底删除会话日志（运行中拒绝） |
| GET | `/api/sessions/:id` | 会话详情 + pending |
| GET | `/api/sessions/:id/history` | 历史事件 |
| POST | `/api/sessions/:id/{prompt,cancel,rename,permission,plan}` | 任务操作 |
| POST | `/api/subscribe` / `/api/unsubscribe` | 订阅会话流 |
| GET | `/api/pending` | 全部待处理 |
| POST | `/api/approvals/:id` | `{action:'allow-once'|'reject'}` |
| POST | `/api/questions/:id` | `{answers:[{id,selected,custom?}]}` |
| GET | `/api/events` | SSE |

SSE 事件：`hello`、`session.snapshot`、`session.event`、`assistant.delta`、`session.added/updated/status/activity/removed/error`、`approval.requested/closed`、`question.requested/closed`、`notice`、`resync`。

## 安全模型

- 只绑定局域网，不做公网穿透，不支持 TLS。
- token 是 `dshm_` + 32 字节随机数，服务端只存 SHA-256；撤销后立即失效。
- 配对码 120 秒、单码 5 次失败、单 IP 每分钟 10 次。
- 面板和 `/api/setup/*` 只允许 loopback；DSH 页面跨端口访问时校验 Origin，并保留 CSRF。
- 状态文件：`$DSH_HOME/storages/mobile-bridge/state.json`，原子写，权限 600。
- 手机端 token 目前明文存在 SharedPreferences（Keystore 加密未实现）；不要 root 手机或共享备份。
- App 开启 `usesCleartextTraffic`，仅用于局域网 HTTP。

## 已知限制

- 修改 desktop profile 后需要重启 Electron；当前会话不会自动加载新插件。client 面板与旧会话过滤都需要重启后生效。
- 面板显示 `Failed to fetch` 时，先确认 `http://127.0.0.1:48123/health` 返回 `{"ok":true,...}`。Electron 页面来源是 `dsh-app://dsh`，host 已放行该 Origin；如果仍失败，查看 DevTools 的 Network/CORS 报错，必要时把实际 Origin 发我。
- 删除会话是直接删日志目录，不可恢复；运行中的会话会拒绝删除。
- 计划模式依赖 `/plan` 命令；若某个 profile 没有加载 `@deepseek-ai/dsh-plan-mode`，接口返回 501。
- 审批默认超时：审批 120 秒、普通提问 120 秒、plan-review 180 秒，可在「手机远控」面板调整。
- 不支持附件、模型切换、fork、子代理控制、always-allow、公网、iOS。
- 工具参数/结果在手机上会截断（正文 4000 字、参数 800 字），用于展示而非完整导出。

## 交付物

- `dist/TS7-DSH-Remote-0.1.0-debug.apk`
- `host/`（可独立安装的 DSH bundle）
- `android/`（完整源码）
- `docs/screenshots/`（MuMu 联调截图）
- `README.md`
