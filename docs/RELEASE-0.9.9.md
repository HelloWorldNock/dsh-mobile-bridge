# v0.9.9 — 设备卡片从 PanelBody 拆出（R22 第五刀）

面板里最大的一块 `PanelBody`（约 940 行）开始切：第一个搬出去的是「已配对设备」卡片。
行为不变，由新增的渲染测试看着。

## 变更

- `host/client-src/components.mjs` 新增 `DevicesCard({ devices, busy, onRevoke })`：
  只吃 `devices` / `busy` 与一个撤销回调，不碰外部状态；过滤已撤销设备、空态文案、撤销按钮都在组件内。
- `host/client-src/panel.mjs`：1,079 → **1,058 行**，原来的内联卡片换成
  `h(DevicesCard, { devices: snap.devices || [], busy, onRevoke })`（撤销确认与 POST 留在 PanelBody）。
- 新增测试 `DevicesCard renders the empty state and the list with revoke callback`：
  空态文案、已撤销设备不出现、撤销按钮点击后回调拿到正确 device（顺带修了测试里
  「数组子节点要递归」的遍历 bug——`map` 出来的列表是一个数组子节点）。

## 验证

```
node tools/build-client.mjs         → 生成 55,531 字节；--check 通过
node --check host/lib/client.js     → 语法通过
cd host && node --test              → tests 175 / pass 174 / skip 1
node tools/verify-package.mjs       → PASS（38 文件 / 26 个 lib/** 同哈希）
gradlew :app:clean && assembleDebug → BUILD SUCCESSFUL（0.9.9 / versionCode 30，ABI 三包）
```

## 备注

- 本轮 `git push` 仍然要绕过本机代理（`-c http.proxy= -c https.proxy=`），否则 schannel 握手失败。
- `gh release` 需要清空 `HTTP_PROXY/HTTPS_PROXY/ALL_PROXY` 才能上传资产。

## 附件

- `TS7-DSH-Remote-0.9.9-arm64-v8a-debug.apk` / `-x86_64-debug.apk` / `-debug.apk`（universal）
- `dsh-mobile-bridge-0.9.9.tgz`
- `tsnode-windows-amd64.exe`
- `SHA256SUMS-0.9.9.txt`
