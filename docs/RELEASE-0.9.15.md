# v0.9.15 — 发版流程固化成一条命令

这一版不加功能，把过去十几轮手工重复的发版动作写成脚本，并用它自己发布这一版（dogfooding）。

## 变更

- 新增 `tools/release.mjs`：一条命令跑完
  `preflight → bump → pack → build-apk → sums → gates → commit → tag → push → release`。
  - `--dry-run`：只打印计划，不动仓库；
  - `--from <step>`：从某一步续跑（比如构建失败后从 `build-apk` 重来）；
  - `--skip-build`：只发 host 包（用于纯文档/工具改动）；
  - 内置环境坑的处理：`git push` 用 `-c http.sslBackend=openssl -c http.proxy=<本地代理>`，
    `gh release` 反过来清空代理变量。
- 版本号、APK 命名、`SHA256SUMS-<版本>.txt`、门禁调用（`verify-package` +
  `verify-apk-signature` + `check.mjs` + `node --test`）都在脚本里固定下来，
  不再靠人记。

## 这一版自己是用它发的

```powershell
node tools/release.mjs --version 0.9.15 --notes docs/RELEASE-0.9.15.md --dry-run   # 先看计划
node tools/release.mjs --version 0.9.15 --notes docs/RELEASE-0.9.15.md             # 真发
```

## 验证

```
node tools/release.mjs --dry-run   → 十步计划完整打印，退出码 0
node tools/verify-package.mjs      → PASS（含 APK versionCode 与源码一致）
tools/verify-apk-signature.ps1     → PASS（v1–v4，CN=Android Debug）
cd host && node --test             → 181 例（180 过 + 1 集成用例跳过）
```

## 附件

- `TS7-DSH-Remote-0.9.15-arm64-v8a-debug.apk` / `-x86_64-debug.apk` / `-debug.apk`（universal）
- `dsh-mobile-bridge-0.9.15.tgz`
- `tsnode-windows-amd64.exe`
- `SHA256SUMS-0.9.15.txt`
