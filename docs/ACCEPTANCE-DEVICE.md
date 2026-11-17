# 真机验收（R09 · 设备侧）

> API 层 13 项由 `tools/acceptance.mjs` 自动化（最近：**13 通过 / 0 失败 / 9 跳过**）。这里只记「必须有真机」的部分。
> 最近更新：2026-11-17 23:15（宿主 0.9.18 + 手机端 0.9.18-debug，无线调试驱动）。

## 设备与环境

| 项 | 值 |
|---|---|
| 手机 | REDMI K80（`24117RK2CC`，`zorn`），Android **16 / SDK 36 / arm64-v8a** |
| 手机端版本 | **0.9.18-debug**（用 `adb install -r` 装的 `dist/TS7-DSH-Remote-0.9.18-arm64-v8a-debug.apk`） |
| 驱动方式 | 无线调试（`adb pair` → `adb connect`，之后走 mDNS 传输），文字取自 `uiautomator dump` |
| 主机 | 0.9.18，`/health` 正常，兼容性「宿主接口齐全」 |
| 证据 | `docs/evidence/`：`02-app.png`（已连接 + 51 会话）、`04-after-airplane.png`（飞行模式后自动恢复）、`05-host-selected.png`、`06-notification.png`（通知栏） |

## 结果

| 项 | 结论 | 证据与观察 |
|---|---|---|
| 安装与启动 | **通过** | `adb install -r` 成功；`dumpsys package` 显示 `versionName=0.9.18-debug`；启动后进入任务列表 |
| 配对与识别 | **通过** | 主机 `/api/setup/state` 里手机在线，`lastSeenAt` 持续刷新 |
| 任务列表与工作区 | **通过** | 手机显示「51 个会话 · DESKTOP-Q3LRK9H · 局域网」，13 个工作区，计数与主机一致 |
| **A10 断线重连** | **通过** | `cmd connectivity airplane-mode` 开 10 秒再关；App 回到前台时显示 **已连接**，无需手动重连；主机侧 `lastSeenAt` 恢复刷新（`04-after-airplane.png`） |
| **A19 前台服务与通知** | **通过** | `dumpsys notification` 里有 `channel=dsh_connection`、`flags=FOREGROUND_SERVICE` 的常驻通知；另有一条任务完成通知「任务完成 · 仅回复收到」（`06-notification.png`） |
| **A11 局域网 → tailnet 切换** | **失败** | 关掉 Wi-Fi 后等 2 分钟：主机侧 `lastSeenAt` 停更、日志出现 `phone stream detached`，手机没有切到 tailnet 重连。需要确认手机端 Tailscale 是否在登录状态；也可能需要在 App 里手动重试一次候选地址 |
| A9 历史图片回显与全屏 | 待验 | 需要 `adb`（关 Wi-Fi 后无线调试随之断开，见下） |
| A15 归档 → 就地取消归档 | 待验 | 同上 |
| A5 审批点按 | 未验 | 本机宿主审批策略是 `never`，不会弹卡（代答通道已由脚本 `--approvals` 验证） |

## 副作用与注意事项

- **无线调试跑在 Wi-Fi 上**：`svc wifi disable` 会同时断掉 adb。所以 A11/A12 这类「关网」项要么放到最后做，要么插 USB 线做。
- 本次执行到 A11 时 Wi-Fi 被关掉且没能自动恢复（`svc wifi enable` 因设备已离线未生效），
  需要人工在手机上重新打开 WLAN，之后 `adb connect` 才能继续 A9/A15。

## 复跑命令

```powershell
$adb = '.toolchain\android-sdk\platform-tools\adb.exe'
& $adb connect 192.168.1.106:41835     # 端口以手机「无线调试」页显示为准
& $adb shell uiautomator dump /sdcard/_ui.xml
& $adb pull /sdcard/_ui.xml .tmp/_ui.xml
node .tmp/ui-find.mjs .tmp/_ui.xml <关键词>   # 把文字节点换算成设备坐标，再 input tap
```
