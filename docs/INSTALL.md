# 安装、配对与升级（R25：从 README 拆出的单一事实源）

> README 只留一段概览 + 指向本文。命令与路径以这里为准。

## 1. 安装 host 插件（desktop profile）

本机已验证的装法（目录联接 + profile bundles）：

1. `%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-mobile-bridge` 指向 `<repo-root>\host` 的目录联接。
2. `profiles\desktop\package.json` 的 `dsh.profile.bundles` 里包含 `"dsh-mobile-bridge"`。
3. **完整重启 DSH**（托盘退出，或 `tools\restart-dsh.cmd`）。host bundle 只在启动时加载，F5 不够。
4. 验证：`http://127.0.0.1:48123/health` 返回 `{"ok":true,"version":"<版本>","deviceId":"…"}`，且 DSH 侧栏出现「手机远控」。

用 tgz 装到任意 profile：

```powershell
powershell -NoProfile -File tools/pack-plugin.ps1     # → dist/dsh-mobile-bridge-<v>.tgz
dsh plugin --profile <profile> add file:<repo-root>\dist\dsh-mobile-bridge-<v>.tgz
```

`dsh plugin add` 会同时写入该 profile 的 `dsh.profile.bundles`；重启后按 `cordis.patch.yml` 的默认值
监听 `48123`（发现用 `48124/udp`）。

## 2. 手机连接与配对

1. 装 `dist/TS7-DSH-Remote-<v>-debug.apk`（debug 包名 `com.ts7.dshremote.debug`）。
2. 手机与电脑同一 Wi-Fi，或都登录同一个 tailnet。
3. 打开 App：UDP 自动发现，或手填 `电脑IP:48123`（远程填 `100.x.x.x:48123` 并打开「通过 Tailscale 连接」）。
4. 在 DSH 侧栏「手机远控」面板读 6 位配对码，输入手机。
5. token 保存在本机（Keystore 加密），后续自动重连，局域网/Tailscale 自动选路。
6. 更多主机：App 顶部「主机 +」，重复 2–5；同一台电脑跑多个 DSH 实例时给各自桥接配不同端口。
7. 发图片：新建任务页或详情输入框点「图片」，1–4 张 PNG/JPEG/WebP/GIF，App 压到长边 1600、单张 ≤3.5 MB。

**明文策略**：App 只对私网地址（`10/8`、`172.16/12`、`192.168/16`、`100.64/10`、回环、链路本地）、
单标签主机名与 `*.local` 等内网后缀走 http；公网 IP/域名必须 https，否则直接拒绝
（`network/cleartext-blocked`）。细节见 [SECURITY.md](SECURITY.md) 与 `docs/API.md`。

### 2.1 虚拟机宿主（NAT）

DSH 跑在 NAT 虚拟机里时，手机既连不上虚拟机地址也收不到它的 UDP：

```powershell
# TCP 转发
netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=48125 connectaddress=<VM-IP> connectport=48123
# UDP 发现中继（复制 example 后改地址）
PowerShell -NoProfile -ExecutionPolicy Bypass -File tools/install-discovery-relay.ps1
```

中继监听 `48126/udp`，收到发现包先查 `/api/discovery`，旧版桥接退回 `/health`。App 同时扫描
`48124` 与 `48126`。更彻底的做法是把虚拟机网卡改成桥接。

## 3. 构建 Android

仓库已提交 Gradle Wrapper（固定 8.9）：

```powershell
$env:JAVA_HOME='<toolchain>\jdk-17'
$env:ANDROID_HOME='<toolchain>\android-sdk'
$env:GRADLE_USER_HOME='<toolchain>\gradle-home'
cd <repo-root>\android
.\gradlew.bat :app:assembleDebug --no-daemon
```

产物：`android/app/build/outputs/apk/debug/app-debug.apk`。

- Kotlin 报 `AccessDeniedException` 且 `whoami /groups` 显示 `Low Mandatory Level` →
  `icacls "<toolchain>" /setintegritylevel '(OI)(CI)High'`。
- 装到 MuMu：`adb install -r <apk>`，然后 `adb shell am start -n com.ts7.dshremote.debug/com.ts7.dshremote.MainActivity`。

## 3.1 发布签名与 ABI 拆分（R26）

`android/app/build.gradle.kts` 已经接好两条路，但**密钥永远不进仓库**：

```properties
# android/keystore.properties（已 gitignore，只放在本机）
storeFile=/absolute/path/to/release.jks
storePassword=…
keyAlias=…
keyPassword=…
```

- 文件存在 → `assembleRelease` 用 `signingConfigs.release` 签名；
- 文件不存在 → 仍产出未签名 release 包（用来验证拆分体积），`apksigner verify` 会报
  `Missing META-INF/MANIFEST.MF`，属于预期；
- 自建密钥：`keytool -genkeypair -keystore release.jks -alias <alias> -keyalg RSA -keysize 2048 -validity 10000`，
  密钥与口令自己保管（丢了就无法给老用户推送同一签名的升级）。

ABI 拆分（`splits { abi { include("arm64-v8a", "x86_64"); isUniversalApk = true } }`）实测：

| 产物 | 体积 | 内含 ABI |
|---|---|---|
| `app-arm64-v8a-*.apk` | 33–39 MB | arm64-v8a |
| `app-x86_64-*.apk` | 35–41 MB | x86_64 |
| `app-universal-*.apk` | 55–62 MB | arm64-v8a / armeabi-v7a / x86 / x86_64 |

单包从 65 MB 降到 ~34 MB（release）/~39 MB（debug）。校验签名：

```powershell
& "<sdk>\build-tools\35.0.0\apksigner.bat" verify --print-certs <apk>
```

## 4. 升级

| 场景 | 动作 |
|---|---|
| 升级 host 插件 | 覆盖 `host/`（或换 tgz）→ **完整重启 DSH** → `/health` 版本已变 → 面板无兼容性横幅 |
| 升级 App | 直接覆盖安装；token 在 Keystore 加密存储里，不需要重新配对 |
| 从 ≤0.9.0 升到 0.9.x | 首次启动会做一次明文→加密迁移；若之后装回 0.8.x，那版读老文件会显示「未配对」，重新配对即可 |
| 撤销一台手机 | 面板「已配对设备」→ 撤销；手机下次请求收到 401，会清掉本机 token 并提示重新配对 |
| 改默认工作区目录 | 面板「桥接设置」填绝对路径；手机才能在它下面新建工作区文件夹 |

## 5. 卸载与重置

```powershell
# 面板入口：/api/setup/reset（loopback + CSRF）撤销全部设备并刷新配对码
# 手机端：设置 → 移除主机；或清除应用数据（会连加密存储一起清掉）
```

内嵌 Tailscale 节点的运行时状态在 `host/.tsnet-state/`（不进仓库）；节点程序
`host/bin/tsnode-<平台>-<架构>` 走 Release 附件，源码安装先跑 `tools/build-tsnode.ps1`。

## 6. 排障速查

| 现象 | 处理 |
|---|---|
| 面板 `Failed to fetch` | 先 `curl 127.0.0.1:48123/health`；页面来源是 `dsh-app://dsh`，host 已放行 |
| 侧栏按钮点了就消失 | F5；仍不行完整重启宿主 |
| 手机看不到「归档会话/取消归档」 | App 版本低于 0.8.9 |
| 手机连不上但 health 正常 | 检查是否公网地址走 http 被拒（日志有 `network/cleartext-blocked`） |
| 内嵌节点 `Access is denied` | 把 `host\bin\tsnode-*.exe` 加白 |
| 「检查更新」超时 | 检查 `HTTPS_PROXY`，面板重试 |
| Gradle test worker 报 `ClassNotFoundException: GradleWorkerMain` | 用 `tools/test-android.ps1`（ASCII junction），见 [TESTING.md](TESTING.md) |
