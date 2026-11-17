# 真机验收（R09 · 设备侧）

> API 层 13 项由 `tools/acceptance.mjs` 自动化（最近：**13 通过 / 0 失败 / 9 跳过**）。这里只记「必须有真机」的部分。
> 最近更新：2026-11-17 23:30（宿主 0.9.18 + 手机端 0.9.18-debug，adb 无线调试驱动）。

## 设备与环境

| 项 | 值 |
|---|---|
| 手机 | REDMI K80（`24117RK2CC`，代号 `zorn`），Android **16 / SDK 36 / arm64-v8a** |
| 手机端版本 | **0.9.18-debug**（`adb install -r dist/TS7-DSH-Remote-0.9.18-arm64-v8a-debug.apk`） |
| 驱动 | 无线调试：`adb pair` → mDNS 传输；界面用 `uiautomator dump` 取文字与坐标，再 `input tap` |
| 主机 | 0.9.18，`/health` 正常，兼容性「宿主接口齐全」 |
| 证据 | `docs/evidence/`（编号见下） |

## 结果

| 项 | 结论 | 证据与观察 |
|---|---|---|
| 安装与启动 | **通过** | `dumpsys package` → `versionName=0.9.18-debug`；启动进入任务列表（`02-app.png`） |
| 配对与识别 | **通过** | 主机 `/api/setup/state` 里 `lastSeenAt` 持续刷新 |
| 任务列表与工作区 | **通过** | 手机显示「52 个会话 · DESKTOP-Q3LRK9H · 局域网」、13 个工作区，计数与主机一致 |
| **A10 断线重连** | **通过** | `cmd connectivity airplane-mode` 开 10 秒再关；回到前台自动「已连接」，无需手动重连（`04-after-airplane.png`） |
| **A19 前台服务与通知** | **通过** | `dumpsys notification`：`channel=dsh_connection`、`flags=FOREGROUND_SERVICE` 常驻通知；另有「任务完成 · 仅回复收到」通知（`06-notification.png`） |
| **A15 归档 → 手机就地取消归档** | **通过** | 电脑端 `POST /api/sessions/:id/archive` → 手机会话页出现横幅「这个任务已归档…点右上角菜单『取消归档』可以放回去」（`10-archived-banner.png`）；点右上菜单 → 「取消归档」→ 确认弹窗（`11-menu.png`）→ 主机侧 `archivedSessionIds` **已移除该会话**（`12-unarchived.png`） |
| **A9 历史图片回显与全屏** | **通过** | 用带图 prompt 建会话（240×160 PNG）→ 手机时间线显示缩略图（`13-image-session.png`）→ 点缩略图弹出全屏查看器，标注 `240×160`（`14-image-viewer.png`） |
| **A11 局域网 → tailnet** | **失败（复测确认）** | 第二次复测：关 Wi-Fi 后连续采样 70 秒，主机侧 `lastSeen` 只增不减（29→94 秒），**没有走 tailnet 重连**；随后 170 秒仍无上报。待确认手机是否装了 Tailscale 并登录——若没有，属环境不具备而非缺陷 |
| A5 审批点按 | 未验 | 本机宿主审批策略是 `never`，不会弹卡（代答通道已由 `--approvals` 验证） |

## 测试方法上的坑（记下来免得重复踩）

1. **无线调试跑在 Wi-Fi 上**：`svc wifi disable` 会同时断掉 adb，`svc wifi enable` 因设备离线不会生效。
   所以 A11/A12 这类「断网」项要么放最后做，要么插 USB 线做。
2. **`adb exec-out` 重定向在 PowerShell 会把 PNG 写坏**：改用 `screencap -p /sdcard/x.png` + `adb pull`。
3. **`input text` 只能打 ASCII**：中文标题的会话搜不到，临时用 `/rename` 改成 ASCII 名字再搜。
4. **`uiautomator dump` 的文字在 `text` 或 `content-desc`**，坐标要自己从 `bounds` 算中心点（`.tmp/ui-find.mjs` 就是干这个的）。
5. 手机端把命令的回包直接显示成了「已安装的 dsh 远端 App / 版本」那几条——那是 `adb shell` 的输出串进了会话，不影响结论。

## 复跑命令

```powershell
$adb = '.toolchain\android-sdk\platform-tools\adb.exe'
& $adb connect <手机IP:端口>            # 端口以「无线调试」页显示为准
& $adb shell screencap -p /sdcard/_shot.png; & $adb pull /sdcard/_shot.png docs\evidence\x.png
& $adb shell uiautomator dump /sdcard/_ui.xml; & $adb pull /sdcard/_ui.xml .tmp/_ui.xml
node .tmp/ui-find.mjs .tmp/_ui.xml <关键词>   # 输出中心坐标，再 input tap
```

## 遗留

- 测试期间建的两个会话（`DELETE-ME a9-image-test`、`DELETE-ME a15-archive-test`）仍驻留 DSH 内存，
  重启宿主后可在手机或面板上「彻底删除」。
