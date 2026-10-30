# v0.4.0 — 内嵌 Tailscale 节点 / Embedded Tailscale node

电脑端插件现在自带一个 tailnet 节点（`tailscale.com/tsnet` userspace），这台机器不需要再装 Tailscale 客户端。

## 新增

- 面板「内置 Tailscale 节点」卡片：开关、节点名、授权密钥、状态目录、登录链接、健康告警与日志。
- 两种入网方式：填 `tskey-auth-…` 授权密钥自动登录，或点面板里的 `login.tailscale.com` 一次性链接在浏览器里确认。
- 节点名默认 `dsh-<设备 ID 前段>`，可改；改完自动重启节点并在 tailnet 里生效。
- 内嵌节点地址会出现在 `/api/setup/state`、`/api/discovery`、`/api/info` 的端点列表里，标记 `source: "embedded"`，手机端按普通 tailnet 地址连接即可。
- 状态目录默认 `$DSH_HOME/storages/mobile-bridge/tsnet`。被安全软件拦截写文件时自动回退到插件目录 `.tsnet-state`，成功后记住可用目录，面板里也能手动指定。
- 断线按 2/5/10/20/40/60 秒退避重连；节点与宿主进程同生共死（stdin 关闭即下线，不留孤儿进程）。
- 与系统 Tailscale 并存：两者都作为端点上报，互不干扰；面板会过滤掉 tsnet 固有的健康告警（没有 OS DNS、不能自更新）。

## 附件

- `dsh-mobile-bridge-0.4.0.tgz` — 插件包，已含 `bin/tsnode-windows-amd64.exe`
- `tsnode-windows-amd64.exe` — 内嵌节点程序，从源码安装或需要单独替换时用
- `SHA256SUMS-0.4.0.txt`

## 安装

```
dsh plugin --profile desktop add file:.<下载目录>\dsh-mobile-bridge-0.4.0.tgz
```

从源码安装需要先重建节点程序（离线可跑，依赖已在 `.toolchain/go-home`）：

```
powershell -NoProfile -ExecutionPolicy Bypass -File tools\build-tsnode.ps1 -Goos windows -Arch amd64
```

## 说明

- 内嵌节点只有用户态网络栈，没有系统 TUN/DNS，所以不能让其他程序走它的网络；它只负责把 tailnet 上的 TCP 流量转发到本机 127.0.0.1 的 bridge 端口。
- ACL 需要放行 48123/tcp；默认 tailnet 策略已允许同 tailnet 内互访。
- 手机与电脑的内嵌节点都要在线；手机端内嵌节点由 App 自己管理。
