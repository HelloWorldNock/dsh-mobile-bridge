# v0.9.10 — 运行日志卡片从 PanelBody 拆出（R22 第六刀）

继续切 `PanelBody`：「运行日志」卡片独立成 `LogCard`，`panel.mjs` 1,058 → **1,032 行**。

## 变更

- `host/client-src/components.mjs` 新增 `LogCard({ logsPath, open, busy, text, onToggle, onCopy, onRefresh, baseUrl })`：
  收起/展开、读取中、空日志、导出链接、复制与刷新按钮全在组件里，只派发回调；
  取数逻辑（`loadLogs` → loopback `/api/setup/logs`）仍留在 `PanelBody`。
- `host/client-src/panel.mjs`：内联的 37 行卡片换成一次 `h(LogCard, {...})`。
- 新增渲染测试 `LogCard collapses, expands and wires its callbacks`：
  收起态有导出链接（`href` 指向 `/api/setup/logs?lines=800`、`download` 文件名正确）、
  展开态显示正文与「复制全部/刷新」、按钮回调按序触发、读取中显示「读取中…」。

## 验证

```
node tools/build-client.mjs         → 生成 55,787 字节；--check 通过
node --check host/lib/client.js     → 语法通过
cd host && node --test              → tests 176 / pass 175 / skip 1
node tools/verify-package.mjs       → PASS（38 文件 / 26 个 lib/** 同哈希）
gradlew :app:clean && assembleDebug → BUILD SUCCESSFUL（0.9.10 / versionCode 31，ABI 三包）
```

## 备注

- 版本号用 `tools/set-version.mjs` 一次改三处（本轮新增的小工具，避免 PowerShell 引号问题）。
- 网络：`git push` 用 `-c http.sslBackend=openssl -c http.proxy=http://127.0.0.1:17890`；
  `gh release` 需清空代理环境变量。

## 附件

- `TS7-DSH-Remote-0.9.10-arm64-v8a-debug.apk` / `-x86_64-debug.apk` / `-debug.apk`（universal）
- `dsh-mobile-bridge-0.9.10.tgz`
- `tsnode-windows-amd64.exe`
- `SHA256SUMS-0.9.10.txt`
