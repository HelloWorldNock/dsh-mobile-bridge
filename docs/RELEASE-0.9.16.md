# v0.9.16 — 修好 DSH 0.2.2 上的「插件加载即失败」

升级到 DSH **0.2.2-rc.3** 后，桥接插件直接 `fiberPhase: failed`，诊断只有一句
`cannot get property "slots" without inject`——面板还在，但 PC 侧 48123 根本没起来。

## 根因

0.2.2 起宿主把「没写进 `inject` 的服务」做成**严格代理**：读 `ctx.slots` 这种未声明的服务会
直接抛错，而不是返回 `undefined`。而启动兼容性探针恰好会对 `slots` / `attachments` 做属性探测，
于是**探针自己把 `apply()` 打崩了**——插件从未重新注册，`start()` 自然不会跑。

讽刺的是，探针本来就是为了发现「宿主升级后静默坏掉」而写的；这次它先把自己撞坏了。

## 变更

- `lib/compatibility-check.js`
  - `readPath()` 逐级 `try/catch`：严格代理抛错按「不可读」处理，并把原因写进探针输出
    （`（宿主严格模式：未写进 inject 的服务不可读）`），不再让整个 `apply` 崩溃；
  - `logger` 接受 function 或 object（0.2.2 传的是函数）；
  - 参数个数（`Function.length`）不符**降级为警告**而不是「必需接口坏了」：
    0.2.2 把 `cancel`/`rename` 换成了「单个对象参数」，适配层本来就按对象调用，两种宿主都能工作；
    同时把 `list`（0–3）/`prompt`（1–5）/`cancel`（1–3）/`rename`（1–3）的接受区间放宽。
- 新增回归用例：宿主用严格代理时探针不抛错、`slots` 记为降级；`cancel()` 少参数只降级不判失败。

## 实测（DSH 0.2.2-rc.3）

```
/health                                   → {"ok":true,"version":"0.9.15","deviceId":"G3RNTSW6"}
bridge.log                                → 兼容性 0 项必需不兼容（slots/attachments 各一条降级提示）
node tools/acceptance.mjs                 → 13 通过 / 0 失败 / 9 跳过（A8 也转绿了）
rename 探针（新建会话→改名→读列表）        → 200 且标题已更新，rename 可用
```

## 升级注意

- 之前 `failed` 的插件需要禁用再启用一次（或在设置里重载），HMR 不会自动重试已失败的条目。
- `A8`（图片超限被拒）在运行 0.8.8 的老宿主上一直是红的；这次宿主换成 0.9.x 后自动转绿。

## 附件

- `TS7-DSH-Remote-0.9.16-arm64-v8a-debug.apk` / `-x86_64-debug.apk` / `-debug.apk`（universal）
- `dsh-mobile-bridge-0.9.16.tgz`
- `tsnode-windows-amd64.exe`
- `SHA256SUMS-0.9.16.txt`
