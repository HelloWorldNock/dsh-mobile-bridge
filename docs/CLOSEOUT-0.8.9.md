# v0.8.9 阶段一执行记录（R01–R10）

> 执行时间：2026-11-16 23:42 — 2026-11-17 00:1x（本机）
> 基准：[deepseek_markdown_20261116_b475f4.md](deepseek_markdown_20261116_b475f4.md)
> commit：`dbe4a9a` · tag `v0.8.9`

| 编号 | 事项 | 状态 | 证据 |
|---|---|---|---|
| R01 | 修 `.gitignore`，测试入库 | ✅ | `.gitignore` 的无锚点 `test/` 改成 `/test/`；`git ls-files host/test` = **12 个文件**；`cd host && node scripts/check.mjs && node --test` → **18 模块 / 101 通过 / 0 失败** |
| R02 | 新增打包一致性门禁 | ✅ | `tools/verify-package.mjs`：解 tar.gz → 逐文件比 `lib/*.js` SHA-256、查缺失/多余、校验三处版本号、对账 `SHA256SUMS-<版本>.txt`；不符退出码 1 |
| R03 | 重打包并逐项核对 | ✅ | 先用旧包跑门禁，复现 0.8.8 的 7 文件漂移（client/dto/events/history/server/tailscale/tool）→ 重打 `dist/dsh-mobile-bridge-0.8.9.tgz`（8,997,780 B / 29 文件）→ 门禁 **19 个 `lib/*.js` 全部一致，PASS，exit 0** |
| R04 | 统一超时 + 清理死提示 | ✅ | `state.js` 导出唯一来源 `TIMEOUT_DEFAULTS`（120/120/180 s），`index.js` 的 `DEFAULTS` 展开它，删除 30/60/120 冗余值；启动最后一行日志改为「在 DSH 侧栏点『手机远控』…」（根路径只回 404） |
| R05 | 补手机端取消归档 | ✅ | `BridgeRepository.unarchiveActiveSession()`；`archivedSessionIds` 从 `/api/workspaces` 与 `session.removed(archived=true)` 维护；菜单在「归档会话 / 取消归档」间切换 + `SessionDialog.Unarchive` + 已归档提示条；「取消归档」在 Kotlin 侧 15 处可搜到；`gradle :app:assembleDebug` 通过，APK 内 dex 实测含该字符串 |
| R06 | 修 README + 更新 contrib | ✅ | README 补 7 条缺漏路由（`/health`、`GET|POST /api/setup/tailscale`、`/api/setup/logs`、`/api/logs`、`POST /api/workspaces`、`/api/permission-presets`）、补 0.8.6–0.8.9 能力、删 `resync`、改 Windows 权限描述、加五级验收口径；`contrib/dshmarket/plugins.json` 与 `awesome-dsh-plugin/dsh-mobile-bridge.yml` 指 0.8.9 |
| R07 | 升版三处 + Release Note | ✅ | `host/package.json` 0.8.9、`host/lib/index.js` `VERSION='0.8.9'`、`build.gradle.kts` 0.8.9(20)；`docs/RELEASE-0.8.9.md` 覆盖归档 + 0.2.x 适配 + 本版新增 |
| R08 | 正式发布 v0.8.9 | ✅ | commit `dbe4a9a` + tag `v0.8.9` 已推 origin；Release `v0.8.9` 含 tgz(8.58 MB) / APK(60.87 MB) / `tsnode-windows-amd64.exe`(21.32 MB) / `SHA256SUMS-0.8.9.txt`；远端 `latest` = v0.8.9，双端「检查更新」因此指向它；从 Release 重新下载的 tgz 实测 sha256 = `e5201aec…76c7`，与 `SHA256SUMS` 和本地一致 |
| R09 | 真机主链路验收 | ⬜ 待跑 | 本机无可用设备（`adb devices` 空，MuMu 未装到默认路径），桥接进程仍加载 0.8.8（重启 DSH 才换）。矩阵与判据见 [ACCEPTANCE-0.8.9.md](ACCEPTANCE-0.8.9.md) |
| R10 | 最小 CI | ✅ | `.github/workflows/ci.yml`：job `host` 跑 `check.mjs` + `node --test`；job `package` 打包后跑 `verify-package.mjs`（本地已按同样命令演练，exit 0） |

## 门禁复跑命令

```powershell
# G02 测试
cd host; node scripts/check.mjs; node --test

# G01 包一致性
cd ..; node tools/verify-package.mjs

# G04 Android 构建（固定工具链）
$env:JAVA_HOME='.toolchain\jdk-17'; $env:ANDROID_HOME='.toolchain\android-sdk'
& '.toolchain\gradle-8.9\bin\gradle.bat' -p android :app:assembleDebug --no-daemon
```

## 产物哈希（`dist/SHA256SUMS-0.8.9.txt`）

```
57efad4c96dc6d5ed226740db1fc2aab7bea38af8e05fa49cbfc80c03e160a26  TS7-DSH-Remote-0.8.9-debug.apk
e5201aece57ac6f36733b6fa79be5a3ab439a1278a96e9384d3c0425fc1276c7  dsh-mobile-bridge-0.8.9.tgz
5b67efa17da2926f12a6f79d0ae054ce087129efb8a128fcac0ffcd0a042ab35  tsnode-windows-amd64.exe
```

## 层级判定（五级口径）

| 面 | 层级 | 说明 |
|---|---|---|
| Host 桥接（配对/会话/prompt/审批/归档/工作区/绑定组/协作） | L2 | 101 例单测通过；其中归档与路由/鉴权分支有覆盖 |
| Host 包一致性 | L5 边缘 | tgz 与源码同哈希，远端 Release 资产与本地同哈希 |
| Android 端 0.8.9 改动（取消归档/菜单/提示条） | L1 + 可构建 | 代码实现 + `assembleDebug` 通过 + APK 内字符串实测；未上真机 |
| 端到端主链路（0.8.9） | 未达 L4 | 需按 ACCEPTANCE-0.8.9.md 跑一轮 |

> 结论：0.8.9 的 tag 与 Release 只代表「实现 + 单测 + 可构建 + 包一致 + 已发布」。真机矩阵未跑之前，不把任何一项写成「已真机验证」。
