# 真机验收（R09 · 设备侧）

> API 层 13 项由 `tools/acceptance.mjs` 自动化（最近：**13 通过 / 0 失败 / 9 跳过**）。这里只记「必须有真机」的部分。
> 最近更新：2026-11-18 00:05（宿主 0.9.19 + 手机端 0.9.18-debug，adb 无线调试驱动）。

## 设备与环境

| 项 | 值 |
|---|---|
| 手机 | REDMI K80（`24117RK2CC`，代号 `zorn`），Android **16 / SDK 36 / arm64-v8a** |
| 手机端版本 | **0.9.18-debug**（`adb install -r`）；宿主已升到 0.9.19（Android 侧无代码变化） |
| tailnet | **App 内嵌 tsnet**（`EmbeddedTailscale.kt` + gobridge，用户态实现，不占系统 VPN）：logcat 显示 `netmap: self: 100.72.230.94 auth=machine-authorized`，peer 含主机 `100.121.110.95` |
| 驱动 | 无线调试 `adb pair` → mDNS 传输；界面用 `uiautomator dump` 取文字/坐标再 `input tap`（`tools/ui-find.mjs`） |
| 证据 | `docs/evidence/`（编号见下） |

## 结果

| 项 | 结论 | 证据 |
|---|---|---|
| 安装与启动 | **通过** | `dumpsys package` → `versionName=0.9.18-debug`；启动进入任务列表（`02-app.png`） |
| 配对与识别 | **通过** | 主机 `/api/setup/state` 里 `lastSeenAt` 持续刷新 |
| 任务列表与工作区 | **通过** | 「53 个会话 · DESKTOP-Q3LRK9H · 局域网」+ 13 工作区，计数与主机一致 |
| **A10 断线重连** | **通过** | 飞行模式 10 秒 → 关闭后自动「已连接」（`04-after-airplane.png`） |
| **A19 前台服务与通知** | **通过** | `dumpsys notification`：`channel=dsh_connection` + `FOREGROUND_SERVICE` 常驻通知；另有「任务完成 · 仅回复收到」通知（`06-notification.png`） |
| **A15 归档 → 手机就地取消归档** | **通过** | 电脑端归档 → 手机出现归档横幅（`10-archived-banner.png`）→ 右上菜单「取消归档」→ 确认（`11-menu.png`）→ 主机 `archivedSessionIds` 已移除（`12-unarchived.png`） |
| **A9 历史图片回显与全屏** | **通过** | 240×160 PNG 会话 → 缩略图（`13-image-session.png`）→ 全屏查看器标注 `240×160`（`14-image-viewer.png`） |
| **A11 局域网 → tailnet** | **通过** | `tools/a11-failover.mjs --wait 90`：关 Wi-Fi（保留移动数据）后 **+42 秒** `lastSeen` 从 58 秒回落到 1 秒 → 从 tailnet 续连成功；脚本的定时任务把 Wi-Fi 自动开回 |
| **A12 tailnet → 局域网** | **通过（两段证据）** | ① A11 测试期间 Wi-Fi 关闭时连接确实续在 tailnet 上；② Wi-Fi 恢复后读界面：`53 个会话 · DESKTOP-Q3LRK9H · 局域网` → 已自动回切局域网。未做成单次连续采样，因为**关 Wi-Fi 会同时断掉无线调试**（adb 跑在 Wi-Fi 上），脚本 `tools/a12-return.mjs` 已就绪但需要人工把无线调试重新打开才能跑完整闭环 |
| A5 审批点按 | 未验 | 本机宿主审批策略是 `never`，不会弹卡（代答通道已由 `--approvals` 验证） |

## 测试方法上的坑（记下来免得重复踩）

1. **无线调试跑在 Wi-Fi 上**：`svc wifi disable` 会同时断掉 adb；而且这台 ROM 在 Wi-Fi 断开后会**关掉无线调试**，网络测试后需要人工重新打开。
   所以断网项要「先排定时恢复任务再关网」（`setsid nohup`，普通 `&` 会被回收），并且接受「一次只能验一半」。
2. **`adb exec-out` 重定向在 PowerShell 会把 PNG 写坏**：改用 `screencap -p /sdcard/x.png` + `adb pull`。
3. **`input text` 只能打 ASCII**：中文标题搜不到，先用 `/rename` 改成 ASCII 再搜。
4. **`uiautomator dump` 的文字在 `text` 或 `content-desc`**，坐标要从 `bounds` 算中心（`tools/ui-find.mjs`）。
5. **飞行模式会同时关掉移动数据**：A11 前两次失败就是这个原因，tsnet 没有承载网络自然切不过去。

## 复跑命令

```powershell
$adb = '.toolchain\android-sdk\platform-tools\adb.exe'
& $adb connect <手机IP:端口>                       # 端口以「无线调试」页为准
& $adb shell screencap -p /sdcard/_shot.png; & $adb pull /sdcard/_shot.png docs\evidence\x.png
& $adb shell uiautomator dump /sdcard/_ui.xml; & $adb pull /sdcard/_ui.xml .tmp/_ui.xml
node tools/ui-find.mjs .tmp/_ui.xml <关键词>
node tools/a11-failover.mjs --serial <serial> --wait 90   # LAN → tailnet
node tools/a12-return.mjs  --serial <serial> --tailnet 45 # tailnet → LAN（跑完需重开无线调试）
```

## 遗留

- 测试期间建的两个会话（`DELETE-ME a9-image-test`、`DELETE-ME a15-archive-test`）仍驻留 DSH 内存，重启宿主后可彻底删除。
- A5（审批点按）需要一台「会问审批」的宿主；A18（NAT 虚拟机自动发现）需要宿主机 discovery-relay 与虚拟机环境。
