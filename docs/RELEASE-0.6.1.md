# v0.6.1 — 多主机、远程与工作区层级 / Multi-host, Remote & Workspaces

Android 手机远程操作 DeepSeek Harness（DSH）。局域网内自动直连；离开局域网后，可走电脑的系统 Tailscale，或直接用 App 内置的 userspace Tailscale 节点。支持多台主机、图片 prompt、虚拟机发现中继和桌面同款工作区层级。

## 包含

| 资产 | 说明 |
| --- | --- |
| `TS7-DSH-Remote-0.6.1-debug.apk` | Android 客户端（minSdk 26，debug 签名） |
| `dsh-mobile-bridge-0.3.1.tgz` | DSH host 插件（图片 prompt、发现 API、工作区 `sessionIds`、LAN/Tailscale 端点上报） |
| `SHA256SUMS-0.6.1.txt` | 上面两个资产的 SHA-256 |

## 本版重点

- **工作区层级**：任务按桌面的工作区分组，点标题折叠/展开；搜索同时匹配工作区、任务标题和目录。
- **修复全部落入「未归类」**：工作区列表为空、旧桥接没有 `sessionIds`、ID 格式不同或路径大小写/尾斜杠不一致时，自动退回按会话 `cwd` 归组；仍无目录的会话才进「未归类」。
- **多主机**：同时保持多台 DSH 的 SSE 连接，顶部主机胶囊切换，任务/审批/通知互不串台。
- **局域网与 Tailscale 自动切换**：插件同时广播 LAN 和 tailnet 地址；手机按当前网络自动选择，回到 Wi-Fi 自动切回直连。
- **内嵌 Tailscale（实验）**：App 内 userspace tsnet，不占用系统 VPN；设置里一键随 App 启停，只代理本 App 的 DSH 流量。首次使用需要在网页完成一次 tailnet 登录。
- **图片 prompt**：新建或继续任务最多 4 张 PNG/JPEG/WebP/GIF，App 压到长边 1600、单张 ≤ 3.5 MB；模型是否理解图片取决于当前 DSH 模型。
- **虚拟机自动发现**：宿主机跑 `tools/discovery-relay.mjs`，把手机的 UDP 发现转发进 NAT 虚拟机；App 同时扫描 `48124` 和 `48126`。
- **通知与审批**：审批/提问/任务完成通知，多主机时标注主机名，通知动作可直接允许/拒绝。

## 升级

1. 安装 `TS7-DSH-Remote-0.6.1-debug.apk`。
2. 把 `dsh-mobile-bridge-0.3.1.tgz` 装进 desktop profile：

   ```powershell
   dsh plugin --profile desktop add file:.\dsh-mobile-bridge-0.3.1.tgz
   ```

3. **完整退出并重启 DSH**（托盘退出，不能只关窗口）。host bundle 只在启动时加载；不重启时 `/api/workspaces` 仍可能没有 `sessionIds`，App 会走 `cwd` 回退分组。
4. 手机与电脑在同一 Wi-Fi，或都登录同一 tailnet；在 DSH「手机远控」面板读取 6 位配对码，在 App 里配对。

## 验证

- host `node --test`：26/26 通过；`node scripts/check.mjs`：11 个模块通过。
- Android `:app:assembleDebug` 构建通过；MuMu 上验证了工作区分组、折叠状态、多主机切换、局域网/Tailscale 回退、图片附件和虚拟机发现。
- 无工作区数据时的 `cwd` 回退分组已在代理注入空 `/api/workspaces` 的条件下验证。

## 已知限制

- debug 签名，仅供自用与内测。
- 内嵌 Tailscale 只支持 arm64-v8a / x86_64，且只代理本 App 流量；需要系统级代理时仍用系统 Tailscale。
- 图片理解取决于模型；不支持视觉的模型会忽略图片内容。
- 虚拟机自动发现需要宿主机常驻中继；只做 TCP 转发时仍可手动填 `宿主机IP:48125`。
- Android 13+ 首次安装需授予通知权限。
