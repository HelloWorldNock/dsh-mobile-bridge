# v0.9.1 — 结构重构版（适配层 / 路由拆分 / 面板生成 / ABI 拆分）

这一版**不改功能**，把 0.9.0 之后的结构性欠账还掉，同时让「包小了、文档齐了、发布有门禁」。
行为与 0.9.0 一致：错误码、路由语义、归档/取消归档、审批与提问、SSE 事件都没变。

## 一、宿主适配层（R23）

新增 `host/lib/adapters/dsh/`：

- `session-adapter.js`：`list()` 同时吃 `{items}` 与裸数组；`prompt/cancel/rename/create` 的参数形状集中在这；
  缺方法抛 `adapter/unsupported`。
- `workspace-adapter.js`：`list()` 读不到给 `[]`；`resolveByPath()` 统一 `await`（0.2.x 是 async、0.1.x 是同步）；
  `archivedIds()` 与 `archivedIdsOrNull()` 区分「没有归档」与「读不到」；写操作异常原样上抛，`WorkspaceActiveSessionError`
  仍映射 409。

`server.js` 里原本 33 处直接访问 `ctx.sessionController` / `ctx.workspaceRegistry`，现在为 0。

## 二、`server.js` 按路由族拆分（R21）

1,438 → **738 行**（-48.7%），路由全部成族：

| 模块 | 承接 |
|---|---|
| `lib/routes/setup.js` | `/api/setup/*`（loopback + CSRF 两道把关写在模块入口） |
| `lib/routes/workspaces.js` | `GET/POST /api/workspaces` |
| `lib/routes/connections.js` | 组握手（join/hello）、组状态、邀请/牵线、协作文件 |
| `lib/routes/sessions.js` | 会话全族：列表/新建、详情、历史、图片、prompt/cancel/rename/permission/plan/archive/删除、权限预设、订阅、待办、审批与提问、SSE |
| `lib/services/prompt.js` | 图片数量/类型/base64/大小上限、标题、时区 |
| `lib/services/format.js` | 文件名清理、路径比较、时间归一化、日志行数 |

搬迁方式是「原样搬运 + 经 `api` 注入原闭包能力」，函数体没改写，所以错误码与副作用顺序不变。

## 三、面板：源码片段 + 生成 bundle（R22 第一刀）

DSH 的 client 插件只能是单个 bundle（加载器只认包名），所以改成：

- `host/client-src/helpers.mjs`：纯函数（`fmtTime` / `parseGroupUrl` / `formatCode`），ESM 导出供测试；
- `host/client-src/panel.mjs`：bundle 骨架，含 `/* __CLIENT_HELPERS__ */` 占位；
- `tools/build-client.mjs`：生成 `lib/client.js`，`--check` 拦「改了片段忘生成」，CI 已接入。

生成结果与原文件 diff 仅 2 行。**面板首次有自动化测试**（6 例）：纯函数边界、bundle 未过期、
假 loader 载入后 `apply` 注册两个插槽。

## 四、ABI 拆分与签名链路（R26）

- `splits { abi { include("arm64-v8a", "x86_64"); isUniversalApk = true } }`：release arm64 **33.1 MB**、
  x86_64 34.6 MB、universal 55.4 MB（debug 39.2 / 40.6 / 61.5 MB）。单包从 65 MB 降到 ~34 MB。
- 签名：读 `android/keystore.properties`（gitignore）；文件存在就用 release keystore 签名，
  不存在仍产出未签名 release 包。**私钥不在仓库**，需要自己 `keytool -genkeypair` 生成并保管。

## 五、文档与门禁

- `docs/API.md`：四层鉴权、22 条路由、请求/响应形状、12 类 SSE 事件、60 个错误码、宿主兼容说明。
- `docs/INSTALL.md` / `docs/TESTING.md`：安装/配对/NAT/构建/升级/排障；三层测试、12 项门禁、五级口径。
- `docs/SECURITY.md`：Owner / Operator / Reader / Restricted 与工作区粒度授权设计。
- `verify-package.mjs` 与 `check.mjs` 改成递归扫描 `lib/**`（适配层/路由/服务子目录不再漏检）。

## 验证

```
cd host && node scripts/check.mjs     → checked 27 host modules
cd host && node --test                → tests 164 / pass 163 / skip 1（真实宿主用例默认跳过）
node tools/verify-package.mjs         → PASS（38 个文件 / 26 个 lib/** 与源码同哈希）
tools/test-android.ps1                → 34 个用例，失败 0
gradlew :app:assembleDebug/Release    → BUILD SUCCESSFUL（0.9.1 / versionCode 22，按 ABI 拆三包）
apksigner verify --print-certs        → debug 包：CN=Android Debug
```

以上是 L1/L2 + 可构建 + 包一致 + 真实宿主契约（1 条 L3）。**0.9.1 的真机矩阵仍未跑**（R09），
Keystore 加密的落盘确认、公网域名拒绝、断线重连与切网都还需要设备复核。

## 升级注意

- Host 插件换包后**完整重启 DSH**；面板若显示「宿主接口不兼容」横幅，先跑
  `curl 127.0.0.1:48123/api/setup/state` 看 `compatibility` 明细。
- Android 现在有三种 APK：**arm64-v8a**（绝大多数手机）、**x86_64**（模拟器/少数平板）、
  **universal**（不确定架构时）。装错架构会报 `INSTALL_FAILED_NO_MATCHING_ABIS`。
- debug 包名仍是 `com.ts7.dshremote.debug`，可与旧版并存；token 在 Keystore 加密存储里，覆盖安装不需要重新配对。

## 附件

- `TS7-DSH-Remote-0.9.1-arm64-v8a-debug.apk`（39.2 MB）
- `TS7-DSH-Remote-0.9.1-x86_64-debug.apk`（40.6 MB）
- `TS7-DSH-Remote-0.9.1-debug.apk`（universal，61.5 MB）
- `dsh-mobile-bridge-0.9.1.tgz` — 桌面插件包
- `tsnode-windows-amd64.exe` — 内嵌 Tailscale 节点程序（源码安装时需要）
- `SHA256SUMS-0.9.1.txt`
