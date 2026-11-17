# v0.9.18 — 修好「已连接 / 连接中」反复跳（SSE 被立刻掐断）

手机端与本机的连接一直在「已连接 / 连接中」之间跳。日志里能看到 `phone stream detached`
每 1–2 秒刷一次——流刚连上就被关掉了。

## 根因（两个 bug 叠在一起）

1. **`/api/events` 的 hello 帧引用了不存在的 `version`**
   R21 把路由从 `server.js` 拆成 `routes/sessions.js` 时，`version` 是原来靠闭包拿到的，
   拆分后忘了注入 → 一连上就抛 `ReferenceError: version is not defined`。

2. **拆分时有一批分支写成了裸 `return`，而不是 `return true`**
   路由族的契约是「处理了就返回 true」。裸 `return` 返回 `undefined`，调度器当成没处理、
   继续往下走到 `throw new BridgeError('not-found', ...)`；此时响应头已经发出去了，
   `handler` 的兜底分支就 `res.end()`——于是 JSON 接口看起来正常（响应体已写完）而
   **SSE 被立刻掐断**。`routes/sessions.js` 里这样的分支有 **10 处**。

顺带发现：`if (res.headersSent)` 的兜底分支以前**静默** `res.end()`，这类错误在日志里完全看不见。
现在会打一行 `request failed after headers sent: …`，这是这次能定位到根因的关键。

## 变更

- `lib/server.js`：给 `createSessionRoutes` 注入 `version`；`headersSent` 兜底改为先记 error 再 end。
- `lib/routes/sessions.js`：10 处裸 `return` → `return true`；解构里补 `version`。
- 新增回归用例 `event stream delivers hello and stays open`：断言 hello 帧到达、且 250ms 后流仍然开着
  （以前这条必红）。
- 探针不再误报：`slots`（宿主侧根本不用）移出探测，`attachments` 改成走 `ctx.get('attachments')` 的服务探测
  ——之前按属性探测，在 DSH 0.2.2 的严格代理下被记成「降级」，面板上那条红色警告就是它。
- 面板横幅：只有**真的不兼容**才用红色告警，纯降级改用中性提示（`.dmb-notice`）。

## 验证

```
node .tmp/probe-sse.mjs（直连 48123）  → hello 104B 到达，流保持 12s 未关闭（此前 1–2ms 就断）
cd host && node --test                 → 186 例（185 过 + 1 集成用例跳过）
node tools/gates.mjs                   → 8 通过 / 0 失败 / 6 需人工
```

## 附件

- `TS7-DSH-Remote-0.9.18-arm64-v8a-debug.apk` / `-x86_64-debug.apk` / `-debug.apk`（universal）
- `dsh-mobile-bridge-0.9.18.tgz`
- `tsnode-windows-amd64.exe`
- `SHA256SUMS-0.9.18.txt`
