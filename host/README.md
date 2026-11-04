# dsh-mobile-bridge

在同一局域网内，用 Android 手机操作 DeepSeek Harness（DSH）的 host 插件。

插件随 profile 启动，自己在 `0.0.0.0:48123` 上开一个只走局域网的桥接端口（UDP `48124` 做设备发现），手机连上来后可以浏览会话、发 prompt（可附最多 4 张图片）、审批工具调用、审阅计划、收通知。DSH 侧没有独立网页，控制端是侧栏底部的「手机远控」按钮和 设置 → 插件 里的卡片；手机端 App 仓库内 `android/`。

## 安装

这是 host bundle，除了装包还要让 profile 选中它。三条路径任选：

**插件市场（推荐，自动完成两步）** —— 在 DSH 的插件市场里搜「手机远控」安装，市场会写 `dsh.profile.bundles` 并重启宿主。

**本地 tarball** —— 先 `npm pack`（或运行仓库里的 `tools/pack-plugin.ps1`）拿到 `dsh-mobile-bridge-0.3.0.tgz`：

```powershell
dsh plugin --profile desktop add file:<path-to>\dsh-mobile-bridge-0.3.0.tgz
```

**npm** —— 包发布后：

```powershell
dsh plugin --profile desktop add dsh-mobile-bridge
```

`dsh plugin ... add` 会同时装包并把包名写进 `~/.dsh/profiles/<profile>/package.json` 的 `dsh.profile.bundles`（实测 0.2.1-rc.2），装完重启 DSH 即生效（托盘退出，不能只关窗口）。只有手工复制目录或做目录联接时，才需要自己往 `bundles` 里加 `"dsh-mobile-bridge"`。`cordis.patch.yml` 自带 `insert`，选进 bundles 后无需再写 cordis 配置。

## 配置

`cordis.patch.yml` 给出的默认值都能在 profile 的 patch 层覆盖：

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `port` | `48123` | 桥接 HTTP/SSE 端口 |
| `discoveryPort` | `48124` | UDP 发现端口 |
| `bindHost` | `0.0.0.0` | 监听地址，只想本机可达时改 `127.0.0.1` |
| `discovery` | `true` | 是否回答手机端的 UDP 广播 |
| `phoneFirst` | `true` | 审批优先弹手机；无人接管时回落桌面 |
| `approvalTimeoutMs` | `30000` | 工具审批等待上限 |
| `questionTimeoutMs` | `60000` | 普通提问等待上限 |
| `planReviewTimeoutMs` | `120000` | 计划审阅等待上限 |
| `hostName` | 系统主机名 | 手机列表里显示的电脑名 |

## 安全模型

- 配对需要桌面面板里显示的 6 位码，120 秒有效；配对成功后手机持有长期 token，断线自动重连。
- 所有请求要求 `Authorization: Bearer <token>`，token 和设置存在 `$DSH_HOME/mobile-bridge/state.json`。
- 监听局域网和 tailnet 地址；插件只在本机开 HTTP/SSE，不对外上报数据。拿不到 token 的设备无法接入。
- 审批与计划审阅都走 DSH 自己的请求通道：请求同时下发给手机和桌面端，谁先处理以谁为准；手机先答时会给桌面端那条已转发的 waterfall 事件下发 `cancel` 帧，桌面卡片自行撤掉。两端都没有时返回 `unavailable`，不会挂起。
- 绑定组与协作：同一个手机配对过的多台主机可以组成一个组（`group.js`），组内用组密钥互相 `hello` 心跳，并能通过 `/api/collab/*` 读对端协作目录里的生成物；agent 侧配一个 `collab` 工具做委派（`tool.js` + `collab.js`）。

## 验证

```powershell
node --test            # 62 个测试：auth / approvals / discovery / dto / endpoints / group / collab / server
node scripts/check.mjs # 语法与导出检查
dsh --profile desktop --dump-config | Select-String mobile-bridge
```

端口起来后 `curl http://127.0.0.1:48123/health` 返回 `{"ok":true,...}`；`/api/discovery` 返回与 UDP 发现相同的非敏感信息，供 NAT 中继使用。

## 卸载

从 `dsh.profile.bundles` 里删掉 `dsh-mobile-bridge`，再 `dsh plugin --profile desktop remove dsh-mobile-bridge`，重启 DSH。

## 打包与分发

```powershell
powershell -NoProfile -File ..\tools\pack-plugin.ps1   # 产物写到仓库根 dist/
```

脚本在 `host/` 下跑一次 `npm pack --json`，并做三件事：图标超过 256 KiB 直接失败、检查 `files` 是否收进 `locale` 和 `icon.png`、核对 tgz 里是否真有 `lib/index.js`、`lib/client.js`、`cordis.patch.yml`、`locale/*.json`、`icon.png`、`LICENSE`。当前产物 `dsh-mobile-bridge-0.3.0.tgz` 约 140 KB / 18 个文件，图标 109 KB。

插件在市场里的卡片信息来自 `locale/zh.json`、`locale/en.json` 的 `meta.title` / `meta.description`，图标走 `exports["./icon"]` → `icon.png`，两者都在 `files` 里，安装后即可被市场读到。`engines.dsh` 声明为 `>=0.2.1-rc.2 <0.3.0-0`，避免装进不兼容的宿主。

市场条目在仓库 `contrib/`：`awesome-dsh-plugin/dsh-mobile-bridge.yml` 提 PR 用，`dshmarket/plugins.json` 给私有目录用，发布前把 `OWNER` / `REPO` 换成真实仓库并让 `tarball` 指向 GitHub Release。

装包闭环已实测（一次性 profile `pkgtest`）：

```powershell
dsh plugin --profile pkgtest add file:<path-to>\dist\dsh-mobile-bridge-0.3.0.tgz
dsh --profile pkgtest --dump-config | Select-String mobile-bridge
# - id: mobile-bridge / name: dsh-mobile-bridge / port: 48123 / discoveryPort: 48124 / phoneFirst: true
```
