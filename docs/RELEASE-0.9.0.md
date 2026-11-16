# v0.9.0 — 可靠性强化（宿主探针 / 明文白名单 / 凭据加密 / 数据层单测）

这一版不加功能，把「装上以后会不会静默坏掉」和「手机丢了 token 会不会裸奔」这两类问题补上：

1. DSH 升级把接口改坏时，面板能立刻说出来，而不是点了没反应。
2. 手机端只对局域网 / Tailnet 走明文；公网地址直接被拒。
3. 配对 token 改成 Keystore 加密存储，老版本明文数据自动迁移并清除。
4. Android 数据层有了 34 例 JVM 单测，Host 侧补鉴权矩阵与真实宿主契约用例。

## 一、宿主兼容性探针（R11）

`host/lib/compatibility-check.js`：DSH 启动时只读点一遍桥接真正依赖的接口——

- `sessionController.{list,prompt,cancel,rename,create,resolveAgent,follow}`
- `workspaceRegistry.{list,create,resolveByPath,unarchiveSession,archivedSessionIds}`
- `on` / `get` / `effect` / `logger` / `slots` / `attachments`
- `ctx.get` 的 4 个可选服务（`typertGateway` / `commands` / `permissionPresets` / `sessions`）

必需项缺失或签名不符 → 判定「主链路不可用」；只有可选项缺失 → 记降级与影响。结果写运行日志（`logCompatibility`），并通过 `/api/setup/state.compatibility` 下发给面板，面板顶部出横幅。签名用 `Function.length` 判断，`resolveByPath` 是同步实现时只降级不报错（`await` 同步值也成立）。

## 二、明文（http）白名单（R15）

`data/NetworkPolicy.kt` + `res/xml/network_security_config.xml` + 清单引用：

- 放行：私网字面量（`10/8`、`172.16/12`、`192.168/16`、`100.64/10`、`127/8`、`169.254/16`）、IPv6 回环 / 链路本地 / 唯一本地、单标签主机名、`*.local` / `*.lan` / `*.home.arpa` / `*.internal` 等内网后缀。
- 拒绝：公网 IP 与公网域名走 http，`BridgeClient` 构造时即抛 `network/cleartext-blocked`，UI 显示原因；`https` 一律放行。

顺带修掉一个真漏洞：`ftp://host` 会被 `normalizeBaseUrl` 改写成 `http://ftp://host`，主机名退化成单标签「ftp」而蒙混过关。现在先看用户写的原始协议，非 http/https 直接拒绝。

## 三、配对凭据加密（R14）

- 新增 `data/SecureStorage.kt`：`EncryptedSharedPreferences`（主密钥在 Android Keystore，键名 AES256-SIV、值 AES256-GCM），文件 `dsh_remote_secure`。
- `HostStore` / `SessionPrefs` 的 Context 版本全部走加密存储；启动时 `DshApp.onCreate → migrateIfNeeded()` 把老明文文件里的 `hosts`/`activeHostId`/0.1.x 旧键搬进加密存储并清空明文。
- Keystore 不可用（定制 ROM、备份跨机恢复）时不瘫掉：退回明文并记一条错误日志，导出日志里能看到当前是不是加密的。
- 主机返回 401（设备被撤销 / 主机重置）时，手机端立刻清掉本机 token 并提示「请重新配对」，不再拿着废 token 反复重连。

## 四、鉴权审计（R16）

- `/api/group/hello` 的文档矛盾结案：代码只认 `Bearer dshg_...`（组密钥），**设备 token 与空头一律 401**，本机无绑定组时 503——它不是公开接口。README 安全模型补了一条澄清。
- 新增 29 条设备路由的「缺 token / 伪造 token 都 401」矩阵测试、hello 四态、无组 503。

## 五、Android 数据层单测（R12）

把逻辑抽成纯函数再测：`KeyValueStore`(+`InMemoryKeyValueStore`)、`PendingMerge`、`ReconnectPolicy`、`SecureStorage.migrate`。34 例覆盖：

| 文件 | 例数 | 覆盖 |
|---|---|---|
| `HostStoreTest` | 8 | 读写、0.1.x 单主机迁移、`activeId`、`hostId` 与端口规则 |
| `EndpointsTest` | 7 | 地址分类、局域网优先、合并去重、显式钉住传输 |
| `PendingMergeTest` | 6 | 服务端权威 / 本地新卡片存活 / 同 id 不重复 |
| `ReconnectPolicyTest` | 3 | 建连与事件流两套退避曲线 |
| `NetworkPolicyTest` | 7 | 私网放行、公网拒绝、https 放行、IPv6 |
| `SecureStorageTest` | 3 | 明文→加密迁移与幂等 |

## 六、构建与集成（R18 / R13）

- `android/gradlew`、`gradlew.bat`、`gradle/wrapper/` 入库，固定 Gradle 8.9。
- 新坑：仓库路径含中文时 Gradle test worker 用 `@argfile` 传 classpath 会取不到，报 `ClassNotFoundException: GradleWorkerMain`。`tools/test-android.ps1` 先建 ASCII junction（`C:\dshproj`、`C:\dshgh`）再跑。
- `host/test/integration/prompt.test.js`：对着**正在运行的** DSH 跑真实契约——读配对码 → 配对 → 建会话 → 派 prompt（`read-only` 权限）→ 等这一轮结束 → 从历史确认落盘 → 归档。默认跳过，`DSH_BRIDGE_INTEGRATION=1` 才执行。本机实测：一轮 4.5 s，归档 200。

## 七、协作组角色权限设计（R17）

`docs/SECURITY.md`：Owner / Operator / Reader / Restricted 四角色、凭据→角色映射（手机 token 默认 Operator，组内新增 `dshp_`，`dshg_` 只作 Owner）、scope 形状（`workspaceIds` + `cwdPrefixes`）、逐路由最低角色守卫表、6 步落地顺序、5 条未决风险。本期只出设计与落地计划，代码未动。

## 验证

```
cd host && node scripts/check.mjs     → checked 19 host modules
cd host && node --test                → tests 114 / pass 113 / skip 1（集成用例默认跳过）
DSH_BRIDGE_INTEGRATION=1 node --test test/integration/prompt.test.js → 1 passed（真实宿主）
node tools/verify-package.mjs         → PASS（19 个 lib/*.js 与源码同哈希，版本三处一致）
tools/test-android.ps1                → 34 个用例，失败 0
gradlew :app:assembleDebug            → BUILD SUCCESSFUL（0.9.0 / versionCode 21）
```

以上是 L1/L2（实现 + 单测 + 可构建）与部分 L3（真实宿主契约）。**未做**：0.9.0 的真机矩阵（R09）、Keystore 加密在真机上的落盘确认、公网域名拒绝的真机复现。按五级口径，这些仍算未验收。

## 升级注意

- 电脑端要**完整重启 DSH**，宿主探针与 `/api/setup/state.compatibility` 才会出现。
- 手机端首次启动会做一次明文→加密迁移；如果之后又装回 0.8.x，那版读的是老文件，会显示「未配对」——重新配对即可。
- 从 0.8.9 升级不需要重新配对：迁移会把老 token 原样搬进加密存储。
- 内嵌 Tailscale 节点程序仍走 Release 附件（`tsnode-windows-amd64.exe`），源码安装先跑 `tools/build-tsnode.ps1`。

## 附件

- `TS7-DSH-Remote-0.9.0-debug.apk` — Android 客户端
- `dsh-mobile-bridge-0.9.0.tgz` — 桌面插件包
- `tsnode-windows-amd64.exe` — 内嵌 Tailscale 节点程序（源码安装时需要）
- `SHA256SUMS-0.9.0.txt`
