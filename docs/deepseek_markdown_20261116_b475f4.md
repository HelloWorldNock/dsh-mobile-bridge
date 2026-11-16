# TS7 DSH Remote 整改路线（v0.8.9 交付收口版）

> 决策基准：2026-11-16 评审快照
> 版本决策：**直接发布 v0.8.9**（跳过 0.8.8，不补发、不浪费版本号）
> 总原则：冻结新功能，按「先收口交付 → 再固门禁与契约 → 最后解耦与安全加固」推进
> 验收口径：严格区分「已实现 / 已单测 / 已集成 / 已真机 / 已交付验收」五级，禁止混用

---

## 0. 决策记录

| # | 决策项 | 结论 | 理由 |
|---|---|---|---|
| D-1 | 版本号 | **发 v0.8.9** | 0.8.8 产物落后源码且承载两批改动，补发语义混乱；0.8.9 收口更干净 |
| D-2 | 是否重写架构 | 否 | 技术路线无根本性错误，功能闭环已成立，重写收益低 |
| D-3 | 门禁位置 | 先 `verify-package.mjs` 哈希门禁，CI 随后补 | 不阻塞首发，零依赖立即可用 |
| D-4 | 适配层节奏 | 先 `compatibility-check.js` 轻量探针，再渐进演进到 `adapters/dsh/` | 避免一次性大改 |
| D-5 | Android 安全节奏 | Keystore + release 签名在首发后立即做；ABI 拆分可稍后 | 先保交付，再保安全 |
| D-6 | 文档处理 | `host/README.md` 重写并重定向至根 README；三篇交接文档合并入库 `docs/HANDOFF.md` | 保留历史，建立单一事实源 |

---

## 1. 阶段一：交付收口（3–5 天，最高优先级）

**目标：源码、测试、tgz、APK、Release 完全一致，且真机主链路完成验收。**

### 1.1 任务清单

| 编号 | 事项 | 涉及文件 | 验收条件 | 预估 |
|---|---|---|---|---|
| R01 | 修复 `.gitignore`，测试入库 | `.gitignore`、`host/test/*` | `git ls-files host/test` = 12 文件；新 clone `cd host && npm test` 跑 101 例全过 | 0.5 天 |
| R02 | 新增打包一致性门禁 | `tools/verify-package.mjs`（新建） | 解压 tgz，逐项比对 `lib/*.js` 与源码 SHA-256；不一致退出非零并输出差异表；校验版本三处一致 | 0.5 天 |
| R03 | 重打包并逐项核对 | `dist/dsh-mobile-bridge-0.8.9.tgz` | 7 个差异文件 + 4 项 0.2.x 适配（异步 `resolveByPath`、`durable parent`、`subagentAddress`、`settings.plugins.tab`、`dto.reason`）全部进包；R02 门禁通过 | 0.5 天 |
| R04 | 统一超时 + 清理死提示 | `host/lib/index.js`、`host/lib/state.js` | 删除 `index.js` 冗余默认值，统一到 `state.js` 的 120/120/180s；`index.js:184` 启动日志改为引导用户在 DSH 侧栏打开面板 | 0.5 天 |
| R05 | 补手机端取消归档 | `data/BridgeRepository.kt`、`ui/screens/SessionScreen.kt` | 新增 `unarchiveActiveSession()`；归档会话菜单出现「取消归档」；全仓可搜到该字符串 | 0.5 天 |
| R06 | 修 README + 更新 contrib | `README.md`、`contrib/dshmarket/plugins.json`、`contrib/awesome-dsh-plugin/*.yml` | 补 7 条 API 路由；补 0.8.6/0.8.7 能力；删 `resync`；修正 Windows 权限描述；`contrib` 指向 0.8.9 | 0.5 天 |
| R07 | 升版三处 + Release Note | `host/package.json`、`host/lib/index.js:19`、`android/app/build.gradle.kts`、`docs/RELEASE-0.8.9.md` | 三处版本号均为 0.8.9；note 覆盖归档 + 0.2.x 适配两批改动 | 0.5 天 |
| R08 | 正式发布 v0.8.9 | Git tag、GitHub Release | tag `v0.8.9`；Release 含 tgz、APK、`SHA256SUMS-0.8.9.txt`、**tsnode 二进制附件**；双端「检查更新」提示 0.8.9 | 0.5 天 |
| R09 | 真机主链路验收 | 真机 / MuMu | 配对 → 会话 → 流式 → 双端审批 → 图片 → 断线重连 → 切网 → 归档/取消归档 → 日志导出 → NAT 发现，逐项记录 | 1 天 |
| R10 | 最小 CI | `.github/workflows/ci.yml`（新建） | Push/PR 自动跑 `node scripts/check.mjs && node --test`（host 仅 3.7s） | 0.5 天 |

### 1.2 阶段一执行顺序（依赖关系）

```
R01（测试入库）
  └─→ R02（哈希门禁）
        └─→ R03（重打包核对）
              └─→ R04 / R05 / R06（并行修复）
                    └─→ R07（升版 + note）
                          └─→ R08（发版）
                                └─→ R09（真机验收，可与 R08 并行预演）
                                      └─→ R10（CI 上线）
```

### 1.3 阶段一验收标准

- [ ] 新 clone `cd host && node scripts/check.mjs && node --test` → 18 模块、101 通过
- [ ] `node tools/verify-package.mjs` → tgz 内全部 `lib/*.js` 与源码 SHA-256 一致
- [ ] GitHub release v0.8.9 含 tgz / APK / SHA256SUMS / tsnode，双端检查更新提示 0.8.9
- [ ] README API 表与 `server.js` 实测一致，无 `resync`，权限描述准确
- [ ] `contrib/` 指向 0.8.9，三处版本号一致
- [ ] 手机可取消归档；超时统一 120/120/180；启动日志不再指向 404
- [ ] 真机矩阵全过并留档

---

## 2. 阶段二：可靠性强化（3–5 天）

**目标：宿主升级可预警，Android 数据层有回归网，安全水位从「个人自用」提到「可分发」。**

### 2.1 任务清单

| 编号 | 事项 | 涉及文件 | 验收条件 | 预估 |
|---|---|---|---|---|
| R11 | 启动兼容性探针 | `host/lib/compatibility-check.js`（新建）、`host/lib/index.js` | 启动自检 `sessionController` / `workspaceRegistry` / `approval` / `userQuestions` 关键方法存在性与签名；异常写运行日志 + 侧栏面板降级警告 | 1 天 |
| R12 | Android P0 数据层测试 | `android/app/src/test/...`（新建） | 覆盖 `HostStore` 读写、选路优先级与 `promoteLan()`、SSE 断线重连、`applyPending`、双端审批竞态 | 1.5 天 |
| R13 | 真实 DSH 集成用例 | `host/test/integration/`（新建） | 至少 1 条真实 `sessionController.prompt` 契约用例，非 mock | 0.5 天 |
| R14 | Android Keystore | `data/HostStore.kt`、`data/SessionPrefs.kt` | `EncryptedSharedPreferences` + AES-GCM；token 不再明文；退出配对/撤销设备同步清理 | 1 天 |
| R15 | 网络安全配置 | `android/app/src/main/res/xml/network_security_config.xml`（新建）、`AndroidManifest.xml` | 仅 RFC1918 与 `100.64.0.0/10` 允许明文；公网域名禁止明文 | 0.5 天 |
| R16 | 鉴权审计 | `host/lib/server.js`、`host/test/server.test.js` | 核实 `/api/group/hello` 在 §2.2 与 §5.2 的矛盾；补齐所有路由鉴权规则测试覆盖 | 0.5 天 |
| R17 | 协作组角色权限设计 | `docs/SECURITY.md`、`host/lib/group.js`（设计先行） | 明确 Owner / Operator / Reader / Restricted 角色与工作区粒度授权；本期可只出设计 + 最小实现 | 1 天 |
| R18 | 构建可复现 | `android/gradlew`、`gradlew.bat`、`gradle/wrapper/`、`tools/build-tsnode.ps1` | 提交 Wrapper；tsnode 改为 Release 附件或下载脚本；CI 增加 Android `assembleDebug` | 1 天 |

### 2.2 阶段二验收标准

- [ ] 启动探针能识别不兼容接口并写面板/日志
- [ ] Android JVM 测试覆盖 P0 项，`./gradlew test` 通过
- [ ] 至少 1 条真实 DSH 契约用例通过
- [ ] token 已加密存储，抓包/读 SharedPreferences 无明文
- [ ] 公网域名明文请求被拒
- [ ] `/api/group/hello` 鉴权规则有测试，矛盾消除
- [ ] 协作组权限设计文档入库
- [ ] 新机器按文档可完成 Host + Android 构建

---

## 3. 阶段三：结构优化（中长期）

**目标：降低热点维护成本，建立 API 契约，收敛文档。**

| 编号 | 事项 | 涉及文件 | 收益 | 优先级 |
|---|---|---|---|---|
| R19 | 拆 `BridgeRepository.kt` | → `ConnectionRouter` / `SessionSyncManager` / `PendingQueueManager` | 降低状态机复杂度 | 高 |
| R20 | 拆 `SessionScreen.kt` | → 时间线 / 菜单 / 图片查看子组件 | 改善 UI 可维护性 | 中 |
| R21 | 拆 `server.js` | → `routes/` + `services/` | 降低路由与业务耦合 | 高 |
| R22 | 拆 `client.js` | → `client/` 面板子模块 + 纯函数单测 | 降低面板开发风险 | 高 |
| R23 | `host/adapters/dsh/` 正式落地 | `adapters/dsh/*-adapter.js` | 隔离宿主升级冲击 | 高 |
| R24 | API 契约文档 | `docs/API.md`（HTTP + SSE + 错误码统一定义） | 降低两端漂移 | 中 |
| R25 | 文档单一事实源 | `docs/ARCHITECTURE|INSTALL|UPGRADE|SECURITY|API|TESTING|RELEASE.md` | 减少部署排障成本 | 中 |
| R26 | Release 签名 + ABI 拆分 | `android/app/build.gradle.kts`、keystore 管理 | 63.5 MB → 约 30 MB | 中 |
| R27 | 审批 always-allow / 模型切换 / fork / 子代理控制 | 按范围决策 | 不优先，避免范围膨胀 | 低 |

### 3.1 拆分原则

- **保持 API 与行为不变**，逐模块迁移，不做大规模重写
- 先补测试再拆分，拆完测试必须仍全过
- 优先拆「热点 + 无测试」组合：`BridgeRepository.kt` → `server.js` / `client.js`

---

## 4. 发布门禁清单（每次发版必过）

| # | 门禁项 | 检查方式 | 阶段一是否必过 |
|---|---|---|---|
| G01 | 源码与安装包一致 | `node tools/verify-package.mjs` | ✅ 必过 |
| G02 | 测试可复现 | 新 clone `npm test` 101 例 | ✅ 必过 |
| G03 | Host 自动检查 | `check.mjs + node --test` | ✅ 必过 |
| G04 | Android 构建 | 固定工具链 `assembleDebug` | ✅ 必过 |
| G05 | 签名验证 | release 签名 APK | ⬜ 阶段二起必过 |
| G06 | 凭据保护 | token 加密存储 | ⬜ 阶段二起必过 |
| G07 | 鉴权审计 | 路由鉴权测试覆盖 | ⬜ 阶段二起必过 |
| G08 | DSH 兼容性 | 启动探针通过 | ⬜ 阶段二起必过 |
| G09 | 真机主链路 | 配对/会话/Prompt/流式/审批 | ✅ 必过 |
| G10 | 网络切换 | LAN/Tailnet/断网/恢复 | ✅ 必过 |
| G11 | 后台运行 | 通知/后台恢复/进程回收 | ✅ 必过 |
| G12 | 发布信息 | 版本号/Note/contrib 一致 | ✅ 必过 |

### 4.1 每次发布记录模板

```yaml
release: v0.8.9
commit: <sha>
tag: v0.8.9
host_version: 0.8.9
android_version: 0.8.9 (versionCode 20)
dsh_compat: ">=0.2.1-rc.2 <0.3.0-0"
node_range: "^22.15 || >=24"
tgz_sha256: <hash>
apk_sha256: <hash>
tsnode_sha256: <hash>
tests: "101/101 passed"
device_acceptance: "passed: <matrix>"
known_issues: []
```

---

## 5. 验收口径（五级分层，写入 README/TESTING）

| 层级 | 含义 | 通过标准 |
|---|---|---|
| L1 已实现 | 源码中存在完整实现 | 代码 review |
| L2 已单测 | 相关逻辑通过单元测试 | `npm test` / `gradlew test` |
| L3 已集成 | 多模块实际联动 | 对接真实 DSH 宿主 |
| L4 已真机 | 真实 Android 设备完成操作 | 真机矩阵记录 |
| L5 已交付 | 独立环境安装、配对、运行、升级 | 独立机器复现 |

> 禁止把 L2 通过等同于 L3/L4/L5。原报告 §10「经过真机验证」与 §9「未做真机」的矛盾，按此口径统一修正为：**项目核心功能具备代码实现与 Host 单元测试基础，Host 桥接服务已运行；Android 端完整功能、跨网络稳定性及真实设备体验尚待验收。**

---

## 6. 风险与未验证项（发版前必须补验）

| 项 | 状态 | 补验动作 |
|---|---|---|
| 真机端到端（配对/流式/审批/图片/断线/NAT） | 未验证 | R09 逐条跑并留档 |
| Android 构建可复现 | 未验证 | R18 用固定工具链构建并比对产物 |
| 手机是否在线 / SSE 连接数 | 未验证 | `Get-NetTCPConnection -LocalPort 48123` |
| tgz 内 `tailscale.js` / `tool.js` / `dto.js` 语义差异 | 仅比大小 | R03 逐行 diff |
| 远端 release 是否覆盖 v0.8.1–v0.8.4 | 未验证 | GitHub API 分页 |
| DSH 宿主精确版本 | 未验证 | `dsh --version` |
| `client.js` 在 0.2.x 实际插槽渲染 | 未验证 | F5 后看侧栏/设置卡片 |
| `bridge.go` 写死 `192.168.1.100` 对切网影响 | 未验证 | 真机切网观测 |

---

## 7. 一句话行动指令

**冻结功能，按 R01→R10 完成 v0.8.9 交付收口并过 12 项门禁中的阶段一必过项，再进入阶段二；期间每周复核一次包一致性、测试门禁与未关闭 P0/P1。**