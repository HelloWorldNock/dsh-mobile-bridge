# 测试与门禁（R25：从 README 拆出的单一事实源）

> 所有"能不能发版"的判断都以这份文档为准。README 只保留一行指针，避免两处数字漂移。

## 1. 三层测试

| 层 | 命令 | 现状 | 覆盖 |
|---|---|---|---|
| Host 单元/路由 | `cd host && node scripts/check.mjs && node --test` | **179 例（178 过 + 1 跳过）**，27 个模块 | 配对/鉴权/审批/会话/工作区/归档/组/协作/适配层/兼容性探针/路由模块 |
| Android 数据层 | `powershell -File tools/test-android.ps1` | **55 例** | 配对记录、选路、待办合并、重连节奏、明文白名单、明文→加密迁移、连接路由决策、会话与时间线折叠、时间线行折叠与纯文本导出 |
| 真实宿主契约 | `cd host && $env:DSH_BRIDGE_INTEGRATION='1'; node --test test/integration/prompt.test.js` | 1 例（默认跳过） | 对运行中的桥接跑真 prompt 并核对历史落盘 |
| 验收矩阵（API 层） | `node tools/acceptance.mjs --out docs/ACCEPTANCE-RESULT-x.md` | 11 项自动 + 10 项待真机 | 配对/鉴权/列表/建会话/归档/日志/图片校验；结果可归档 |

`node --test` 里那 1 条"跳过"就是集成用例：没设 `DSH_BRIDGE_INTEGRATION=1` 时它不会去动你的 DSH。

### 1.1 Host 侧细节

`scripts/check.mjs` 递归对 `lib/**` 做 `node --check`（语法），`verify-package.mjs` 再对
`lib/**` 逐个比 SHA-256。两者都必须扫子目录，否则 `lib/adapters/`、`lib/routes/`、
`lib/services/` 会被漏检。

测试文件分工：

| 文件 | 关注点 |
|---|---|
| `auth.test.js` / `approvals.test.js` | 配对码与 token 生命周期、双端审批接管 |
| `server.test.js` | 全部路由的鉴权矩阵、CSRF、会话动作、归档、协作文档边界、错误码 |
| `events.test.js` / `history.test.js` | 归档集合对账、事件折叠、历史分页 |
| `group.test.js` / `collab.test.js` | 绑定组握手、派活不能越出协作工作区 |
| `adapters.test.js` | 宿主形状差异（`{items}` 与裸数组、同步/异步 `resolveByPath`、归档集合读不到） |
| `compatibility-check.test.js` | 探针的必需/可选分级、签名漂移、空 ctx |
| `services.test.js` | 图片数量/类型/base64/大小上限、标题、时区、文件名、路径比较 |
| `routes-workspaces.test.js` / `routes-setup.test.js` | 拆出来的路由族（不经过 HTTP） |`n| `client-render.test.js` | 面板真渲染：假 React + 假 window 调 `PanelBody` / `SidebarAction` / `SafeSettingsCard`，断言不抛、关键文案在、`only` 过滤生效 |`n| `client-bundle.test.js` | 面板：纯函数边界、叶子组件元素树、8 个入口函数仍在 bundle 里、`lib/client.js` 未过期（`build-client --check`）、假 loader 载入后 `apply` 注册两个插槽 |`n| `routes-sessions.test.js`（无独立模块测试） | 会话路由族由 `server.test.js` 的 HTTP 用例覆盖（鉴权矩阵、动作、历史、图片、待办、SSE） |`n| `routes-connections.test.js` | 绑定组与协作路由族：join/hello 在身份解析之前、协作文件不出白名单、`requireIdentity` 只在需要的路径上调用 |

### 1.2 Android 侧细节

仓库路径含中文时 Gradle 的 test worker 会失败（`ClassNotFoundException: GradleWorkerMain`——
worker 的 classpath 通过 `@<argfile>` 传给子 JVM）。`tools/test-android.ps1` 先建
ASCII 路径的 junction（`C:\dshproj`、`C:\dshgh`）再从那里跑；纯 ASCII 路径下直接
`.\gradlew.bat :app:testDebugUnitTest` 也可以。

## 2. 发布门禁

| # | 门禁 | 命令 | 阶段 |
|---|---|---|---|
| G01 | 源码与安装包一致 | `node tools/verify-package.mjs` | 每次发版必过 |
| G02 | Host 测试可复现 | `cd host && node --test` | 每次发版必过 |
| G03 | Host 语法检查 | `cd host && node scripts/check.mjs` | 每次发版必过 |
| G04 | Android 构建 | `cd android && .\gradlew.bat :app:assembleDebug`（现按 ABI 拆成 arm64-v8a / x86_64 / universal 三个包） | 每次发版必过 |
| G04b | Release 构建（需密钥） | 先 `powershell -File tools/make-keystore.ps1` 生成密钥与 `android/keystore.properties`，再 `:app:assembleRelease` | 发 release 包时 |
| G05 | 签名验证 | `powershell -File tools/verify-apk-signature.ps1`（默认校验 `dist/` 里最新的 debug 包；签名方案、证书 DN、SHA-256 一并打印，未签名则退出码 1）。发布包加 `-ExpectCommonName "CN=…"` 断言用自己的证书 | ✅ 可执行 |
| G06 | 凭据保护 | 真机读 `shared_prefs` 无明文 | R14 已完成代码，真机待验 |
| G07 | 鉴权审计 | 路由鉴权矩阵测试 | ✅ |
| G08 | DSH 兼容性 | 面板顶部无兼容性横幅 / `/api/setup/state.compatibility.ok` | ✅ |
| G09 | 真机主链路 | 见 [ACCEPTANCE-0.8.9.md](ACCEPTANCE-0.8.9.md)（矩阵需按当前版本重跑） | 待跑 |
| G10 | 网络切换 | LAN ↔ Tailscale ↔ 断网恢复 | 待跑 |
| G11 | 后台运行 | 通知 / 后台恢复 / 进程回收 | 待跑 |
| G12 | 发布信息 | 版本三处一致 + Note + contrib | ✅ |

### 2.1 包一致性门禁做什么

`tools/verify-package.mjs`：解开 tgz → 逐文件比 `lib/**` SHA-256（不漏不多）→ 校验
`package.json` / `lib/index.js` / `build.gradle.kts` 三处版本号一致 → 和
`dist/SHA256SUMS-<版本>.txt` 对账。任一项不符输出差异表并以退出码 1 结束。

它抓到过的真实问题：0.8.8 产物落后源码 7 个文件；`lib/adapters/` 加进来之后，浅层扫描
把适配层误判成"tgz 多出的文件"。

## 3. 五级验收口径

| 层级 | 含义 | 通过标准 |
|---|---|---|
| L1 已实现 | 源码里存在完整实现 | 代码 review |
| L2 已单测 | 相关逻辑有测试覆盖 | `node --test` / `gradlew test` |
| L3 已集成 | 多模块实际联动 | 对接真实 DSH 宿主 |
| L4 已真机 | 真实 Android 设备完成操作 | 真机矩阵有记录 |
| L5 已交付 | 独立环境安装、配对、运行、升级 | 另一台机器复现 |

**禁止把 L2 当成 L4/L5。** 当前口径（0.9.x）：Host 侧 L2 + 1 条 L3 契约用例；Android 数据层
L2；Keystore 加密与网络策略 L1 + 可构建；端到端主链路仍缺一轮 L4。

## 4. 发版动作清单

```powershell
# 1) 三处版本号：host/package.json、host/lib/index.js 的 VERSION、android/app/build.gradle.kts
# 2) 重建产物
powershell -NoProfile -File tools/pack-plugin.ps1
cd android; .\gradlew.bat :app:assembleDebug --no-daemon
# 3) 改名 + 算哈希
#    dist/dsh-mobile-bridge-<v>.tgz、dist/TS7-DSH-Remote-<v>-debug.apk、dist/SHA256SUMS-<v>.txt
# 4) 门禁
node tools/verify-package.mjs
cd host; node scripts/check.mjs; node --test
# 5) 打 tag + 传资产（含 tsnode 与 SHA256SUMS）
git tag -a v<v> -m "..."; git push origin main; git push origin v<v>
gh release create v<v> --notes-file docs/RELEASE-<v>.md <assets...>
# 6) contrib 指到新版本（只指已发布的版本）
```

## 5. 已知测试盲区

- `client.js`（面板，1,199 行）**没有任何测试**：它是浏览器 bundle，只能在 DSH 里手动验。
- `BridgeRepository.kt`（1,660 行）只测了抽出来的纯模块，状态机本身无测试。
- 内嵌 Tailscale 的 Go 侧（`gobridge/`）只有交叉编译，没有 Go 单测。
- 真实性只能靠真机矩阵补齐，见 [ACCEPTANCE-0.8.9.md](ACCEPTANCE-0.8.9.md)。
