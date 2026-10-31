# v0.8.1 — 手动添加主机可走 Tailscale

手机端「添加新主机」多了一个「通过 Tailscale 连接」开关：关闭时按填写的地址直连局域网；打开时先经 App 内嵌 tsnet 节点把流量送进 tailnet，再发起 `/api/pair`。插件这一版没有功能改动，只按版本号规则与 App 一起升到 0.8.1。

## 修复

手动填 tailnet 地址（例如 `100.84.106.53:48123`）配对必定失败。原因是配对走的是 OkHttp 直连，而内嵌节点是 userspace 实现、不装 TUN，手机没有系统 VPN 时包从 Wi-Fi 网卡发出，源地址是 `192.168.x.x`；`100.64.0.0/10` 在公网无路由，于是 8 秒 connect timeout：

```
failed to connect to /100.84.106.53 (port 48123) from /192.168.1.108 (port 59892) after 8000ms
```

已经配对的 tailnet 地址一直是通过内嵌节点的回环代理走的（`clientFor`），只有配对这一步漏掉了同样的转换。

## 变更

- `BridgeRepository.pair()` 增加 `useTailscale` 参数：为真时先用内嵌节点把 `host:port` 解析成 `127.0.0.1:<临时端口>` 再配对，提示语分开处理「未启用 / 正在连接 / 需要登录 / 启动失败」四种状态。
- 配对成功后保存的仍是用户填的真实地址；该地址在端点列表里固定为 `tailscale` 类型（`Endpoints.withKind`），并排到探测顺序最前，避免每次重连都先试一台 NAT 虚拟机里不可达的局域网地址。
- 这个顺序现在是持久的：`Endpoints.merge` 增加 `sort` 参数，`candidates()`、连接成功后的端点回写、手动追加地址都按已存顺序处理（`sort = false`），只有配对本身会重新建立「局域网优先」的规范顺序。在发现列表里点某个地址进入主机，也会把那个地址提到最前。
- 直连失败时，如果地址本身落在 `100.64.0.0/10`，错误信息会追加「这是 tailnet 地址：打开『通过 Tailscale 连接』再试」。
- 填 `100.x` 地址且内嵌 Tailscale 已启用时开关自动打开；用户手动改过之后不再自动调整。
- 插件侧只有版本号：`host/package.json` 与 `/api/info` 的 `version` 从 0.8.0 升到 0.8.1。用 0.8.0 的插件配这个 App 也能配对，不必为了功能重装。

## 附件

- `dsh-mobile-bridge-0.8.1.tgz` — 插件包，已含 `bin/tsnode-windows-amd64.exe`
- `TS7-DSH-Remote-0.8.1-debug.apk` — Android 客户端
- `tsnode-windows-amd64.exe` — 内嵌节点程序，与 0.8.0 相同，从源码安装或需要单独替换时用
- `SHA256SUMS-0.8.1.txt`

## 安装

```
dsh plugin --profile desktop add file:.<下载目录>\dsh-mobile-bridge-0.8.1.tgz
```

## 说明

- 这套路径对内嵌节点和系统 Tailscale 都成立：开关打开要求内嵌节点已连接；只想用系统 VPN 的可以保持开关关闭，直连照旧。
- 已在真机验证：NAT 虚拟机那台（只有 `192.168.16.x` 虚拟网段地址）打开开关后可以正常配对并进入会话。
