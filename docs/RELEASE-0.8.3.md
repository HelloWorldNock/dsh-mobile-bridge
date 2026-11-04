# v0.8.3 — 双端自动检查更新、绑定组加入修复

两件事：电脑面板和手机 App 都能自己发现 GitHub 上的新版本；另一台机器在「PC 绑定组」里粘贴地址点「加入」不再静默失败。

## 1. 双端自动检查 GitHub 更新

电脑端：DSH 侧栏「手机远控」面板最下面新增「版本」卡片，显示当前插件版本和上次检查结果，点「检查更新」立刻重查。发现新版本时直接给出该版本说明摘要和「打开发布页」按钮。

手机端：设置 → 关于，版本号右侧是「检查更新」，下面一行是状态（`已是最新版本 · 11-04 22:31 查过` / `有新版本 0.8.4 · …` / 具体错误）。有新版本时多一个「去下载 x.y.z」直接跳 release 页。

机制上有两个刻意的选择：

- **不走 GitHub API 主路径**。未登录调用 `api.github.com` 每小时只有 60 次，共享出口 IP 的机器很容易早就打光（本次实测就是 `403 rate limit exceeded`）。所以两端都改请求 `https://github.com/<repo>/releases/latest` 并跟随重定向，从最终 URL `/releases/tag/vX.Y.Z` 里取出 tag 再比对版本；API 只在需要拉取说明正文时尽力补一次，失败不影响「有没有新版本」的判断。
- **两边各查各的**。电脑端由 host 进程在后台查（启动 5 秒后一次，之后每 6 小时一次，结果缓存 6 小时），面板按钮走 `POST /api/setup/update` 强制刷新；手机端自己在 `start()` 里判断距上次检查是否超过 6 小时，超过才发请求，结果存在 `SharedPreferences`。没有引入任何后台服务或常驻线程。

## 2. 绑定组「加入没反应」修复

面板上填好对端地址和邀请码，点「加入」什么都不发生——三个原因叠在一起：

- **地址少了 `http://`**。服务端用 `new URL(text)` 解析，`192.168.1.108:48123` 这种写法会直接抛 `ERR_INVALID_URL`，返回 400 `请填写对端地址`。现在两端都容忍省略 scheme：`normalizeBaseUrl()`（host）与 `parseGroupUrl()`（面板）都按「缺 scheme 补 `http://`」处理，并明确拒绝带用户名密码、非 http(s)、缺端口的写法。
- **邀请码 5 分钟就过期**（`INVITE_TTL_MS`），过期后点加入同样只是失败。
- **失败提示根本看不见**。错误原来写在面板顶部那条 alert 里，而面板是可滚动区域、用户正停在底部的加入卡片；更糟的是 3 秒一次的状态轮询成功后会把 `error` 清空，提示最多活 3 秒，顶部状态灯还会因此变成「桥接未运行」。

现在：加入/生成邀请码这类**操作错误与桥接健康状态彻底分离**（`actionError` / `error` 两个状态），绑定组卡片和「桥接设置」卡片各自内联常驻显示属于自己的错误；「加入」按钮不再因为输入框为空就变灰，而是点击时先做本地校验再发请求，错误文案直接顶在输入框下面。

顺带修掉的另一个问题：加入组时通告给对端的是本机地址，旧实现只取 `lanAddresses()[0]`，多网卡机器（虚拟机网卡、WSL、APIPA 169.254）可能把对端根本连不上的地址发出去，于是「加进去了但一直显示离线」。新的 `advertisedBaseUrl()` 会按对端网络挑：对端是 tailnet 主机就只给 `100.x` / `*.ts.net` 端点，否则给局域网端点。

## 变更清单

- 新增 `host/lib/update.js`（版本比较、重定向取 tag、release 解析、6 小时缓存与定时检查）、`host/test/update.test.js`；`host/test/server.test.js` 增加 `POST /api/setup/update` 的端到端用例与 `boot({ updater })` 注入。
- `host/lib/server.js`：`createBridgeServer({ updater })`、`/api/setup/state` 返回 `update`、新增 `POST /api/setup/update`（loopback + CSRF，无 updater 时 503）、`advertisedBaseUrl()`。
- `host/lib/endpoints.js`：新增 `isTailnetHost()`。
- `host/lib/group.js`：`normalizeBaseUrl()` 容忍无 scheme、拒绝账号密码。
- `host/lib/client.js`：「版本」检查更新卡片；`actionError` 与桥接错误分离，绑定组/桥接设置卡片内联错误；`parseGroupUrl()` 本地校验。
- `host/lib/index.js`：装配 updater，`dispose()` 时清理定时器。
- Android：新增 `data/UpdateChecker.kt`；`AppState` 增加 `update` / `updateChecking`；`BridgeRepository` 增加 `checkUpdate()` 与启动自动检查；`SettingsScreen` 的「关于」段重写；`AppRoot` 透传回调。
- 版本：`host/package.json` → 0.8.3；App `versionCode` 13 → 14，`versionName` 0.8.2 → 0.8.3。
- 测试：`npm run check` 16 个模块通过，`npm test` 73 个用例全通过。

## 附件

- `dsh-mobile-bridge-0.8.3.tgz` — 插件包，已含 `bin/tsnode-windows-amd64.exe`
- `TS7-DSH-Remote-0.8.3-debug.apk` — Android 客户端
- `SHA256SUMS-0.8.3.txt`

## 安装

```
dsh plugin --profile desktop add file:.<下载目录>\dsh-mobile-bridge-0.8.3.tgz
```

装完要完整退出并重启 DSH（不是刷新页面），面板才会出现「版本」卡片。

## 说明

- 检查更新只读 GitHub 的公开 release 页，不需要 token；仓库私有或从未发过 release 时会显示对应的说明文字，而不是报错。
- 手机端 debug 包的 `versionName` 带 `-debug` 后缀（`0.8.3-debug`），版本比较会忽略这个后缀，不会因此误判成「有新版本」。
- 内嵌 Tailscale 节点仍然只做入站代理（`-listen :48123 -local 127.0.0.1:48123`），所以本机 Node 进程出站到 `100.x` 依旧不通；跨 tailnet 的双向派活仍需在本机安装桌面版 Tailscale。
