# 整改路线状态总览（R01–R27）

> 这份表是「路线走到哪」的唯一索引：每一项给出**证据位置**与**层级口径**
> （L1 已实现 / L2 已单测 / L3 已集成 / L4 已真机 / L5 已交付，定义见 [`TESTING.md`](TESTING.md)）。
> 最近更新：0.9.15。

## 阶段一：交付收口（R01–R10）

| 编号 | 事项 | 状态 | 证据 |
|---|---|---|---|
| R01 | 修 `.gitignore`，测试入库 | ✅ | `git ls-files host/test` = 12 个（0.8.9 时的口径），`node --test` 可复跑 |
| R02 | 打包一致性门禁 | ✅ | `tools/verify-package.mjs`（递归比 `lib/**` SHA-256 + 三处版本号 + SHA256SUMS 对账） |
| R03 | 重打包并逐项核对 | ✅ | 0.8.9 起每版都跑；抓到过 0.8.8 的 7 文件漂移 |
| R04 | 统一超时 + 清理死提示 | ✅ | `state.js` 的 `TIMEOUT_DEFAULTS`（120/120/180），`index.js` 引用；启动日志改指侧栏面板 |
| R05 | 手机端取消归档 | ✅ L1+L2 | `BridgeRepository.unarchiveActiveSession()` + 菜单切换 + 已归档提示条；Kotlin 侧可搜到该字符串 |
| R06 | README + contrib | ✅ | 7 条路由、0.8.6–0.9.x 能力、删 `resync`、Windows 权限描述、五级口径；`contrib/` 跟到最新发布版 |
| R07 | 三处升版 + Note | ✅ | 每版 `package.json` / `index.js` / `build.gradle.kts` 一致，`docs/RELEASE-*.md` 齐 |
| R08 | 正式发布 | ✅ | v0.8.9 → v0.9.8 共 10 个 Release，资产含 tgz / 三包 APK / tsnode / SHA256SUMS |
| R09 | 真机主链路验收 | ◐ 部分 | API 层已脚本化：`tools/acceptance.mjs`（**14 项自动 + 8 项待真机**；`--approvals` 下 A7 计划审阅已实测通过、A5 审批链路按宿主是否触发审批如实记 skip），报告 [`ACCEPTANCE-RESULT-2026-11-17.md`](ACCEPTANCE-RESULT-2026-11-17.md)：12 通过 / 1 失败（A8，运行中的 0.8.8 未重启）/ 9 跳过 |
| R10 | 最小 CI | ✅ | `.github/workflows/ci.yml`：`check.mjs` + `node --test` + 打包后过门禁 + `build-client --check` |

## 阶段二：可靠性强化（R11–R18）

| 编号 | 事项 | 状态 | 证据 |
|---|---|---|---|
| R11 | 启动兼容性探针 | ✅ | `lib/compatibility-check.js`（必需/可选分级、签名用 `Function.length`），面板横幅 + `/api/setup/state.compatibility` |
| R12 | Android P0 数据层测试 | ✅ L2 | `app/src/test` 55 例（配对记录/选路/待办合并/重连节奏/明文白名单/迁移/时间线折叠） |
| R13 | 真实 DSH 契约用例 | ✅ L3 | `host/test/integration/prompt.test.js`（真 prompt → 历史落盘 → 归档），默认跳过 |
| R14 | Android Keystore | ✅ L1+L2 | `SecureStorage`（EncryptedSharedPreferences + 迁移），**真机落盘待 R09** |
| R15 | 网络安全配置 | ✅ L1 | `NetworkPolicy` + `network_security_config.xml`（公网明文即拒） |
| R16 | 鉴权审计 | ✅ | `/api/group/hello` 只认组密钥；29 条设备路由的 401 矩阵 |
| R17 | 协作组角色权限设计 | ✅ 设计 | [`SECURITY.md`](SECURITY.md)：四角色、凭据映射、逐路由守卫表、落地顺序 |
| R18 | 构建可复现 | ✅ | `android/gradlew*` + `gradle/wrapper`（8.9）；`tools/test-android.ps1` 绕开中文路径坑 |

## 阶段三：结构优化（R19–R27）

| 编号 | 事项 | 状态 | 证据 |
|---|---|---|---|
| R19 | 拆 `BridgeRepository.kt` | ✅ | 抽出 `KeyValueStore` / `PendingMerge` / `ReconnectPolicy` / `ConnectionRouter` / `SessionSyncManager`，仓库只剩副作用 |
| R20 | 拆 `SessionScreen.kt` | ✅ | 1,084 → 585 行；`TimelineFormat`（纯逻辑）+ `SessionTimeline.kt` + `SessionDialogs.kt` |
| R21 | 拆 `server.js` | ✅ | 1,438 → 738 行；`routes/{setup,workspaces,connections,sessions}.js` + `services/{prompt,format}.js` + `adapters/dsh/` |
| R22 | 拆 `client.js` | ✅ | `client-src/{styles,helpers,components}.mjs` + 生成器 `--check` + 渲染冒烟测试（`test/client-render.test.js`）+ 九个区块全部组件化（`DevicesCard` / `LogCard` / `UpdateCard` / `BridgeSettingsCard` / `GroupCard` / `TailscaleCard` 等），`panel.mjs` 1,160 → **626 行**；`client-src/` + 生成器 + 渲染测试（`client-bundle` / `client-render` / `client-tailscale`） |
| R23 | `adapters/dsh/` 落地 | ✅ | 会话/工作区适配层，`server.js` 里 0 处直接摸宿主接口 |
| R24 | API 契约文档 | ✅ | [`API.md`](API.md)：四层鉴权、22 条路由、形状、12 类 SSE、60 个错误码 |
| R25 | 文档单一事实源 | ✅ | [`API.md`](API.md) / [`INSTALL.md`](INSTALL.md) / [`TESTING.md`](TESTING.md) / [`SECURITY.md`](SECURITY.md) + README 文档地图 |
| R26 | 签名 + ABI 拆分 | ◐（链路齐、密钥待你生成） | 拆分已生效（单包 65 → 34 MB）；签名链路 + `tools/make-keystore.ps1`（一条命令生成密钥与 properties）+ `tools/verify-apk-signature.ps1`（G05 门禁，已在 debug 包上证到 v1–v4 与 `CN=Android Debug`）。**私钥仍需你本地生成**：本次执行环境禁止创建 `.jks` |
| R27 | always-allow / 模型切换 / fork / 子代理控制 | ⏸ | 路线本身标为低优先，等范围决策 |

## 发版方式（0.9.15 起）

`node tools/release.mjs --version <v> --notes docs/RELEASE-<v>.md` 一条命令跑完
bump → 打包 → 构建 → 哈希 → 四道门禁 → 提交/打 tag/推送 → GitHub Release；
`--dry-run` 只看计划，`--from <step>` 断点续跑；流程里含 `pointers` 一步（把 README/contrib/ROADMAP 的版本引用一并改掉）。v0.9.15 本身就是用它发的。

## 需要仓库主人做的两件事（当前唯一阻塞）

### 1. 生成发布私钥（R26 最后一步）

我这边的执行环境禁止创建 `.jks`（安全策略命中 `secret.ext.jks`），所以只能把链路和门禁做到「一条命令可用」。
在仓库根目录跑一次即可：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/make-keystore.ps1
# 生成 .toolchain\keystore\release.jks + android\keystore.properties（两者都已 gitignore）
cd android; .\gradlew.bat :app:assembleRelease --no-daemon
powershell -NoProfile -File tools/verify-apk-signature.ps1 -Apk android\app\build\outputs\apk\release\app-arm64-v8a-release.apk -ExpectCommonName "CN=TS7 DSH Remote"
```

密钥与口令请离线备份：丢了就再也发不出「同签名」的升级包。

### 2. 跑一轮真机矩阵（R09 的设备项）

API 层已经脚本化（`node tools/acceptance.mjs`，13 项自动）。剩下这些必须真机点按，逐项记录在
[`ACCEPTANCE-0.8.9.md`](ACCEPTANCE-0.8.9.md) 里即可：

| 项 | 为什么只能真机 |
|---|---|
| ~~A5 审批点按~~ | 脚本已能建会话 → 设 `read-only` 预设（body 是 `{preset}`）→ 派 shell 请求 → 轮询审批卡；但**本机宿主审批策略是 never**，`read-only` 下也直接执行，拿不到卡片。要验得换一台会问审批的宿主 |
| ~~A7 plan-review~~ | **已自动化**：`--approvals` 下走「建会话 → `POST plan {active:true}` → prompt」能稳定拿到卡并代答；仍建议真机点一次确认 UI 呈现 |
| A9 历史图片回显与全屏 | 要在手机上点开图片 |
| A10 断线重连 | 需要设备侧断网/恢复 |
| A11 / A12 LAN ↔ tailnet 切换 | 需要设备离网/回网 |
| A15 电脑归档 → 手机就地取消 | 需要手机上正开着该会话 |
| A18 NAT 虚拟机自动发现 | 需要宿主机 discovery-relay 与设备 |
| A19 前台服务与后台通知 | 需要设备锁屏观察 |

另外两件本机可验证、但依赖「重启 DSH 载入 0.9.x」的事：
- `node tools/acceptance.mjs` 里的 **A8** 现在仍是失败（运行中的宿主是 0.8.8），重启宿主后应变绿；
- 面板顶部的「宿主兼容性」横幅、`/api/setup/state.compatibility` 也只有在重启后才反映当前代码。

### A7 的实测历程（已解决）

第一版探路用 `POST /api/sessions {plan:true, prompt}`，结果模型直接开始执行工具、没有 plan-review 卡；
改用「先建会话 → `POST /api/sessions/:id/plan` → 再 prompt」仍然没有卡片，原因是**字段写错**：
该路由要的是 `{active:boolean}`，我传了 `{plan:true}`，得到 400 `plan/bad-request`「active 必须是布尔值」。
改对之后一次就拿到 `planReview:true` 的卡（计划正文 2945 字），并成功用 `POST /api/questions/:id` 代答。
已把这条写进 `API.md`（会话动作的 body 契约）与 `tools/acceptance.mjs`（A7，`--approvals` 下跑）。

顺带又抓到第二处契约错误：`POST /api/sessions/:id/permission` 要的是 `{preset:string}`，我在上一轮 API.md 里写成了 `{value}`；
实测传 `{value}` 会得到 400 `permission/bad-request`「缺少 preset」。两处都已在 `API.md` 里改正，A5 也改成先设预设再派 prompt。

## 还没做完的三件事

1. **R09 真机矩阵**：`tools/acceptance.mjs` 覆盖了 API 层（A7 计划审阅已自动化通过，A5 审批链路受宿主审批策略限制），剩下的 A9–A12/A15/A18/A19 需要一台真机
   （审批点按、图片全屏、断网/切网、锁屏通知、NAT 发现、彻底删除）。
2. **R26 发布私钥**：跑一次 `tools/make-keystore.ps1` 即可（密钥与口令由它生成并写进已 gitignore 的位置）；我这边的执行环境禁止创建 `.jks`，所以只能把链路和门禁做到「一条命令可用」。
3. ~~R22 剩余~~：已完成（九个区块组件化）。

## 当前质量基线（0.9.8）

```
host      : 27 模块 / 181 例（180 过 + 1 集成用例默认跳过）
android   : 55 例
门禁      : verify-package PASS（38 文件 / 26 个 lib/** 同哈希，版本三处一致）
构建      : assembleDebug / assembleRelease 均成功（versionCode 36，ABI 三包）
发布      : 最新 v0.9.15（GitHub Release 含 tgz / 三包 APK / tsnode / SHA256SUMS）
```
