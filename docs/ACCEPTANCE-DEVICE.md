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
| **A5 审批·允许** | **通过** | `node tools/acceptance.mjs --only A5 --approvals`：模型要做「工作区外写文件」→ 审批卡 `ap_…` 进 `/api/pending` → 脚本代答 `allow-once` → 目标文件**已创建**（内容 `bridge-approval-test`），跑完自动清理 |
| **A5b 审批·拒绝** | **通过** | 同流程把代答改成 `reject` → 目标文件**未被创建**，证明「不批准则不执行」 |
| ~~A18 NAT 虚拟机自动发现~~ | **弃置** | 需要宿主机 discovery-relay 与虚拟机环境，本轮不验 |

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

## A5 到底需要什么

DSH 的审批由**两个插件**配合，缺一不可（读的是安装目录里的 README，版本 0.2.2-rc.3）：

- `@deepseek-ai/dsh-permission-presets`：把「沙箱模式 + 审批策略」打包成**权限预设**。
  本机的预设表在 `~/.dsh/profiles/desktop/cordis.patch.yml`：

  ```yaml
  presets:
    read-only:        { sandbox: read-only,        approval: ask }
    workspace-write:  { sandbox: workspace-write,  approval: ask }
    danger-full-access:{ sandbox: danger-full-access, approval: never }
  defaultPreset: danger-full-access      # ← 默认就是「从不询问」
  ```

- `@deepseek-ai/dsh-user-approval`：`ask` 会把每次敏感操作交给「回答者」（answerer）；
  `never` 直接拒绝不询问；**没有回答者时 `ask` 会 fail-closed 变成 `unavailable`**，操作直接失败。

所以 A5 要成立，需要同时满足三条：

1. **会话的审批策略是 `ask`** —— 也就是预设得是 `read-only` 或 `workspace-write`。
   注意预设表提供的是「新会话的默认值」，当前会话改预设要看 Session projection 是否跟着变；
   本机默认预设是 `danger-full-access`（`never`），这是 A5 一直不弹卡的根本原因。
2. **有回答者在线** —— DSH 桌面端审批 UI，或者我们桥接的手机端（`lib/approvals.js` 挂在 `user-approvals/request` 上）。
3. **触发的是敏感操作** —— 写文件、联网这类；只读命令（`echo`）即使 `ask` 也不会问。

我实测过：工作区内新建文件、`echo` 这类动作**都在沙箱允许范围内**，即使预设是 `workspace-write` 也不会问。
真正会触发 `ask` 的是**越界动作**——例如把文件写到工作区之外，此时 reason 会是
`escalate sandbox to danger-full-access`。

### 已经验过的做法（2026-11-18 00:25，A5 / A5b 均通过）

1. 备份并把 `~/.dsh/profiles/desktop/cordis.patch.yml` 的 `defaultPreset` 改成 `workspace-write`
   （DSH 的 HMR 会立刻重载，`/api/permission-presets` 马上返回新默认值）；
2. 跑 `node tools/acceptance.mjs --approvals`：
   - **A5**：卡片 `ap_…` 出现 → 代答 `allow-once` → `%USERPROFILE%\a5-approval-test.txt` 被创建（内容对得上）→ 自动清理；
   - **A5b**：同样的越界动作 → 代答 `reject` → 目标文件**不存在**；
3. 验完从备份恢复 `defaultPreset: danger-full-access`，并确认新会话的 `permission` 回到 `danger-full-access`。

全量矩阵（含审批）：**15 通过 / 0 失败 / 8 跳过**，报告见
[`ACCEPTANCE-RESULT-2026-11-18.md`](ACCEPTANCE-RESULT-2026-11-18.md)。