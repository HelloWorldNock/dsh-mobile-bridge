# v0.8.5 — 回到同一个局域网就切回直连

手机和电脑明明在同一个 Wi-Fi 下，状态栏却一直写着 `· Tailscale`，走的还是 tailnet（绕一圈中继或直连打洞），不是 192.168.x.x 直连。这一版修的就是这件事：客户端自己选路时一律先看局域网。

## 为什么会一直走 Tailscale

不是防火墙，也不是监听地址的问题。实测这台主机：`DeepSeek Harness.exe` 监听在 `0.0.0.0:48123`，防火墙里已有 `DeepSeek Harness` 的入站允许规则（Private + Public），`/api/info` 也确实把 `http://192.168.1.103:48123` 作为局域网端点下发给了手机。也就是说局域网这条路一直是通的，只是客户端没选它。

原因在客户端的地址顺序：

- 配对时勾了「通过 Tailscale 连接」，`Endpoints.withKind(..., first = true)` 会把 tailnet 地址顶到已存端点的最前面；
- 之后每次连上（`connectOnce`）都用 `merge(..., sort = false)` 合并，顺序原样保留，于是 tailnet 永远排第一；
- 选路函数 `pickReachable()` 就是「按顺序取第一个能连上的」，谁在前就一直用谁；
- 回前台/换网络触发的 `reevaluateRoute()` 也用同一个顺序，它只会换「当前这个不能用了」的情形，不会因为局域网也能用而切回去。

0.8.3 把「点地址提到最前、顺序持久」做成显式设计，本意是别让每次重连先去试一台 NAT 虚拟机里不可达的局域网地址。代价就是这一条：一旦 tailnet 排到前面，就再也回不到直连。

## 现在的行为

- **局域网优先选路**：`Endpoints.preferLan()` 把局域网地址排在前面（组内保持原顺序），选路时用它。顺序只影响「先拨谁」，不再决定「永远用谁」。
- **连上 tailnet 后再给局域网一次机会**：`probeLanUpgrade()` 在非局域网端点连上 1.5 秒后，后台探一次局域网地址；通了就把局域网地址提到已存顺序的最前面（`promoteLan()`，持久化），然后重连切过去；不通就当没发生——不发起重连，所以手机在外用蜂窝网、或主机是 NAT 虚拟机时，只多一次 1.8 秒的探测，不会再看到反复闪烁的连接状态。
- **换网/回前台**：`reevaluateRoute()` 也改成局域网优先，切过去时同样把顺序修正过来。
- 成功切到局域网后，下次冷启动的第一顺位就是局域网，不再每次都先绕 tailnet。

## 变更清单

- `android/.../data/Endpoints.kt`：新增 `preferLan(endpoints)`；`candidates()` 的注释改成说明「已存顺序只是探测起点，选路由 `preferLan` 决定」。
- `android/.../data/BridgeRepository.kt`：`pickReachable(runtime, preferLan = false)`；`reevaluateRoute()` 用局域网优先并在命中局域网时 `promoteLan()`；新增 `probeLanUpgrade()` / `promoteLan()`；`Runtime.lanProbeJob` 随 `restart()` 一并取消；`connectOnce()` 在非局域网端点连上后启动后台探测；新增常量 `LAN_PROBE_DELAY_MS = 1_500`。
- 版本：`android/app/build.gradle.kts` → 0.8.5 (versionCode 16)；`host/package.json` → 0.8.5。桌面端代码没有任何改动，插件包重建只是为了对齐版本号。
- 测试：`host` 的 `npm test` 80 个用例通过（主机端未改）。

## 升级注意

- 只需要换手机上的 APK；桌面插件不装也能用，除非你想让两边版本号一致。
- 装好后重新进一次 App：正常会在 1～3 秒内把状态栏从 `· Tailscale` 变成 `· 局域网`。
- 如果一直没变，说明局域网这条路对这台手机确实不通（不在同一网段、路由器开了 AP 隔离、或电脑网络被划成「公用」）。用手机浏览器打开 `http://<电脑局域网IP>:48123/api/info`，能出 401 说明通；超时说明不通，那就不是客户端的问题了，需要从路由器/网段上查。

## 附件

- `TS7-DSH-Remote-0.8.5-debug.apk` — Android 客户端（本次唯一有实际改动的产物）
- `dsh-mobile-bridge-0.8.5.tgz` — 插件包，代码与 0.8.4 相同，仅版本号
- `SHA256SUMS-0.8.5.txt`
