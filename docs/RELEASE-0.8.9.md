# v0.8.9 — 交付收口版（归档闭环 + DSH 0.2.x 适配 + 发布门禁）

这一版不发新功能，做三件收口的事：

1. 把 0.8.8 攒下但从未发布的两批改动（归档状态同步、DSH 0.2.x 适配）真正装进产物并打上 tag。
2. 补掉手机上唯一的功能缺口：归档能取消。
3. 把「源码 / 测试 / tgz / APK / Release 一致」从人工核对变成一条命令。

版本号跳过 0.8.8：`dist/` 里那份 0.8.8 产物打包在 2026-11-08，比源码旧 7 个文件，同时承载归档与 0.2.x 两批改动，补发语义不清。0.8.9 直接收口。

## 一、归档闭环（原 0.8.8 内容）

电脑上归档的会话，手机任务列表里不再出现；归档 / 取消归档的变化会实时推到手机上。

- `GET /api/sessions` 双重过滤：必须属于某个工作区，且不在 registry 的 `archivedSessionIds` 里。
- `GET /api/workspaces` 的 `sessionIds` 同样剔掉归档会话，并在同一响应里返回 `archivedSessionIds`。
- `createSessionHub()` 每 3 秒对一次归档集合：新增归档广播 `session.removed { archived: true }`，取消归档广播 `session.added`。
- 新增 `POST /api/sessions/:id/archive` 与 `/unarchive`，写的是桌面端同一份集合；运行中归档返回 409。

## 二、手机端可以取消归档（本版新增）

0.8.8 留下的不对称：手机能归档、不能恢复，只能回电脑上操作。这一版补上：

- `BridgeRepository` 新增 `unarchiveActiveSession()`，调 `/api/sessions/:id/unarchive`，成功后重新订阅该会话、刷新详情与列表。
- 归档集合进入 runtime 状态：`/api/workspaces.archivedSessionIds` 每次刷新带回来，`session.removed(archived=true)` 补一个，`session.added` 删掉。
- 电脑归档了你正在看的任务时，**不再把你踢回列表**：任务留在屏幕上，提示「这个任务已在电脑上归档，可在菜单里取消归档」，菜单项自动变成「取消归档」。
- `SessionScreen` 新增 `SessionDialog.Unarchive` 确认框；归档确认框的文案同步改成「电脑上面板或手机当前任务菜单都能取消归档」。

## 三、DSH 0.2.x 适配（原 0.8.8 内容）

宿主 0.2.x 的四处接口变化都已对齐，否则装上就是「面板挂不上 / 子代理会话打不开 / 新建工作区是空壳」：

- `resolveByPath` 在 0.2.x 是 async，`POST /api/workspaces` 改成 `await`，不再拿到恒真的 Promise。
- 子代理会话在 0.2.x 只接受 durable parent 地址：events 的 follow 在 `isSubagentAddressError` 时重试一次。
- `subagentAddress` 相关错误识别随 history 一起落地，子代理会话能正常打开。
- 面板改挂 `settings.plugins.tab`（旧 `settings.plugin.item` 已无声明者），侧栏按钮继续用 `settings.plugins`。
- DTO 补齐 `reason` 字段。

## 四、超时默认值与启动日志

- 审批 / 提问 / 计划审阅的默认超时原来有两个来源：`state.js` 是 120/120/180 秒，`index.js` 的 `DEFAULTS` 是 30/60/120 秒——只有配置里传了非法值时才落到后者，于是面板显示 120 秒、实际按 30 秒跑。
- 现在只有一处定义：`state.js` 导出 `TIMEOUT_DEFAULTS`（120/120/180），`index.js` 的 `DEFAULTS` 直接展开它。
- 启动日志最后一行原来让用户打开 `http://127.0.0.1:48123/` 配对，但根路径从控制端搬进 DSH 之后只回 404。现在改成「在 DSH 侧栏点『手机远控』打开面板，用面板上的 6 位配对码配对新手机」。

## 五、发布门禁（新增）

- `tools/verify-package.mjs`：解开 tgz，把 `lib/*.js` 与源码逐文件比对 SHA-256（不漏不多），检查 `package.json` / `lib/index.js` / `build.gradle.kts` 三处版本号一致，再和 `dist/SHA256SUMS-<版本>.txt` 对账。任一不符输出差异表并以退出码 1 失败。
- 用它检出过 0.8.8 的老问题：`client.js`、`dto.js`、`events.js`、`history.js`、`server.js`、`tailscale.js`、`tool.js` 七个文件与源码不一致。
- `.github/workflows/ci.yml`：push / PR 自动跑 `node scripts/check.mjs && node --test`。
- `host/test/` 12 个测试文件入库（`.gitignore` 里的 `test/` 规则改成 `/test/`，只忽略仓库根部的临时目录）。

## 变更清单

主机（`host/`）：

- `lib/index.js`：`VERSION = '0.8.9'`；`DEFAULTS` 展开 `TIMEOUT_DEFAULTS`；启动日志改指侧栏面板。
- `lib/state.js`：新增导出 `TIMEOUT_DEFAULTS`（120/120/180 秒），`createDefaultState()` 引用它。
- `package.json`：0.8.9。

手机（`android/`）：

- `data/AppState.kt`：`activeArchived`。
- `data/Events.kt`：`SessionIdEnvelope.archived`。
- `data/Models.kt`：`WorkspaceList.archivedSessionIds`。
- `data/BridgeRepository.kt`：`archivedSessionIds` 状态、`unarchiveActiveSession()`、`session.removed(archived=true)` 保留当前任务、`session.added` 清归档标记。
- `ui/screens/SessionScreen.kt`：菜单项在「归档会话」与「取消归档」之间切换 + `SessionDialog.Unarchive`。
- `app/build.gradle.kts`：0.8.9 (versionCode 20)。

工具与文档：

- `tools/verify-package.mjs`（新增）。
- `.github/workflows/ci.yml`（新增）。
- `README.md`：补 7 条缺漏的 API 路由、0.8.6–0.8.9 能力、删掉已不存在的 `resync` 事件、修正 Windows 下的权限描述、新增五级验收口径。
- `contrib/`：`dshmarket/plugins.json` 与 `awesome-dsh-plugin/dsh-mobile-bridge.yml` 指向 0.8.9。
- `.gitignore`：`test/` → `/test/`。

## 验证

- `node scripts/check.mjs` → 18 个模块通过。
- `node --test`（`cd host`）→ 101 个用例全通过。
- `gradle -p android :app:assembleDebug` → BUILD SUCCESSFUL（1 分 45 秒，JDK17 + SDK35 固定工具链）。
- `node tools/verify-package.mjs` → tgz 与源码 19 个 `lib/*.js` 全部一致，版本三处一致。

以上都是 L1/L2（实现 + 单测 + 构建）。**真机矩阵（配对 → 会话 → 流式 → 双端审批 → 图片 → 断线重连 → 切网 → 归档/取消归档 → 日志导出 → NAT 发现）在 0.8.9 这一轮尚未重跑**，见 `README.md` 的「验收口径（五级分层）」。

## 升级注意

- 电脑端要**完整重启 DSH**（托盘退出或 `tools/restart-dsh.cmd`），host bundle 才会重新加载；只按 F5 只刷新面板。
- 手机换装 0.8.9 APK 才有「取消归档」入口；旧版 APK 也能看到归档会话消失（服务端过滤的效果），只是无法恢复。
- 从 0.8.8 及更早升级时，`host/bin/` 里的内嵌节点程序不在仓库里：用 tgz 安装的自带 `bin/tsnode-windows-amd64.exe`，从源码安装的要先跑 `tools/build-tsnode.ps1`。

## 附件

- `TS7-DSH-Remote-0.8.9-debug.apk` — Android 客户端
- `dsh-mobile-bridge-0.8.9.tgz` — 桌面插件包
- `tsnode-windows-amd64.exe` — 内嵌 Tailscale 节点程序（源码安装时需要）
- `SHA256SUMS-0.8.9.txt`
