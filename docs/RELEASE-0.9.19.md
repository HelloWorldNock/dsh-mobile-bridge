# v0.9.19 — 真机验收跑通 + 修掉路由里最后一批裸 return

这一版没有新功能：把真机验收跑到「A9 / A10 / A15 / A19 通过、A11 通过」，并修掉测试过程中暴露的一个路由 bug。

## 修复：嵌套分支的裸 `return` 让响应「发完又被 404 兜底」

`routes/sessions.js` 里像这样的分支：

```js
if (sessionMatch !== null) {
  if (method === 'GET' && action === null) {
    sendJson(res, 200, {...})
    return            // ← 只跳出内层 if
  }
  ...
}
```

裸 `return` 只退出内层 `if`，外层继续往下走，最后落到 `throw not-found`；此时响应头已经发出，
`handler` 的兜底分支只能 `res.end()`。所以 **JSON 接口看起来正常，SSE 却会被立刻掐断**。

0.9.18 只改了 6 空格那一层，这次把嵌套层 **6 + 2 处**一并改成 `return true`。

## 真机验收结果（REDMI K80，Android 16）

| 项 | 结果 |
|---|---|
| 安装启动 / 配对 / 任务列表计数 | 通过 |
| A10 断线重连（飞行模式 10 秒） | 通过 |
| A19 前台服务与通知 | 通过（`dsh_connection` + FOREGROUND_SERVICE，另有完成通知） |
| A15 归档 → 手机就地取消归档 | 通过（主机侧 `archivedSessionIds` 确认移除） |
| A9 历史图片回显与全屏 | 通过（240×160 图片，全屏查看器正常） |
| A11 局域网 → tailnet | **通过**：App 内嵌 tsnet，关掉 Wi-Fi 后 +42 秒从 tailnet 连回来 |
| A12 tailnet → 局域网 | 待验（需无线调试恢复后看路径标签） |
| A5 审批点按 | 未验（本机宿主审批策略是 never） |

新增工具：`tools/a11-failover.mjs`（关网前先挂定时恢复 + 采样 `lastSeen` 判定 failover）、
`tools/ui-find.mjs`（`uiautomator dump` 文字 → 设备坐标）。

## 验证

```
cd host && node --test        → 186 例（185 过 + 1 集成用例跳过）
node tools/gates.mjs          → 8 通过 / 0 失败 / 6 需人工
node tools/a11-failover.mjs --serial <adb 序列号> --wait 90
                              → ✔ 关 Wi-Fi 后 42s 内换路径连回；✔ Wi-Fi 自动恢复
```

## 附件

- `TS7-DSH-Remote-0.9.19-arm64-v8a-debug.apk` / `-x86_64-debug.apk` / `-debug.apk`（universal）
- `dsh-mobile-bridge-0.9.19.tgz`
- `tsnode-windows-amd64.exe`
- `SHA256SUMS-0.9.19.txt`
