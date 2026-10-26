# v0.1.0 — 手机远控 / Mobile Remote

用 Android 手机在同一局域网内操作 DeepSeek Harness：6 位配对码建立 token 鉴权的长连接，然后在手机上浏览任务、发 prompt、审批工具调用、审阅计划、收通知。全部流量留在本地，不经过公网。

## 包含

| 资产 | 说明 |
| --- | --- |
| `dsh-mobile-bridge-0.1.0.tgz` | DSH 插件包（host bundle + client 面板 + 图标 + 中英卡片文案） |
| `TS7-DSH-Remote-0.1.0-debug.apk` | Android 客户端（minSdk 26，debug 签名） |
| `SHA256SUMS-0.1.0.txt` | 上面两个资产的校验和 |

源码即本仓库：`host/` 是插件，`android/` 是客户端。

## 安装插件

```powershell
dsh plugin --profile desktop add file:.\dsh-mobile-bridge-0.1.0.tgz
```

装完重启 DSH（托盘退出，不能只关窗口）。`dsh plugin add` 会同时把 `dsh-mobile-bridge` 写进该 profile 的 `dsh.profile.bundles`；桥接随宿主启动，监听 `0.0.0.0:48123`，UDP `48124` 做设备发现。

## 连接手机

1. 安装 `TS7-DSH-Remote-0.1.0-debug.apk`。
2. 手机与电脑连同一个 Wi-Fi，App 会广播发现，也可以手输 `电脑IP:48123`（MuMu 模拟器用 `10.0.2.2:48123`）。
3. 在 DSH 侧栏「手机远控」面板或 设置 → 插件 → 手机远控 读取 6 位配对码（120 秒有效），输入手机。
4. 配对后手机持有长期 token，断线自动重连。

## 配置

`cordis.patch.yml` 的默认值都能在 profile 的 patch 层覆盖：`port`、`discoveryPort`、`bindHost`、`discovery`、`phoneFirst`、`approvalTimeoutMs`、`questionTimeoutMs`、`planReviewTimeoutMs`、`hostName`。详见 `host/README.md`。

## 安全边界

- 只监听局域网，不连公网、不上报。
- 所有 HTTP/SSE 请求要求 `Authorization: Bearer <token>`；token 与设置存在 `$DSH_HOME/mobile-bridge/state.json`。
- 配对码 120 秒有效，一次性；手机不在线或超时时，审批与计划审阅自动回落到桌面客户端。

## 验证

`node --test`（22 个测试）、`node scripts/check.mjs`（10 个模块）在 0.2.1-rc.2 上通过；打包产物用一次性 profile 装过并通过 `--dump-config` 确认 `id: mobile-bridge` 与端口配置。插件卡片标题/描述/图标经 DSH 自身的 `readPluginMeta` 校验为中文「手机远控」、英文「Mobile Remote」。

## 已知限制

- APK 是 debug 签名，仅供自用与内测；上架或长期使用需自行换 release 签名。
- 仅 Android；客户端需要 API 26 及以上。
- Android 13+ 的通知权限需要在系统设置里手动授予。
