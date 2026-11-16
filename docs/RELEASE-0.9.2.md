# v0.9.2 — Android 数据层再拆一层（选路决策 / 会话折叠）

这一版只动 Android 内部结构：把「该切哪条线路」和「列表/时间线怎么折叠」从
1,650 行的 `BridgeRepository` 里抽成两个纯模块，并补上 JVM 测试。功能面与 0.9.1 完全一致。

## 一、ConnectionRouter（选路决策）

`data/ConnectionRouter.kt`：

| 函数 | 规则 |
|---|---|
| `probeTimeoutMs(kind)` | 局域网 1.8 s、tailnet 3.5 s，未知类型按局域网 |
| `shouldSwitch(current, candidate, connected)` | 只在**地址变了**或**当前没连上**时切；地址相同就不动，避免网络抖动把 SSE 打断 |
| `shouldPromoteLan(candidate, current)` | 只有「不同的**局域网**地址」值得提到最前并持久化；tailnet 不参与 |
| `deviceMatches(expected, reported)` | 任一侧没报 deviceId 就不拦；两侧都报且不等 → 拒绝该地址（换机/重装后不会把任务发到另一台 DSH） |
| `probeOrder(endpoints, preferLan)` | 有偏好时局域网优先，否则用存储顺序（那是配对时定下的意图） |

`BridgeRepository` 里五处对应逻辑（`probeTimeout`、`matches`、`reevaluateRoute` 的切换判定、
`pickReachable` 的遍历顺序、探局域网的两个延时）全部改走它，仓库只剩副作用。

## 二、SessionSyncManager（列表与时间线折叠）

`data/SessionSyncManager.kt`：

- `sortSessions`：最近更新在前，同刻按 id 倒序（刷新前后顺序稳定）。
- `upsertSession` / `upsertApproval` / `upsertQuestion`：同 id 覆盖、不同 id 追加。
- `timelineContains` / `appendTimeline`：按 `seq` 去重；`seq <= 0` 的老帧不算重复，
  否则重连快照会吞掉所有无序号帧。
- `runningAfterEvent`：只有 `turn` 的 `start`/`end` 能改 `running`，助手消息不能。
- `assistantTextFor`：只缓存助手正文，截到 4,000 字（锁屏通知用）。

事件处理里的内联判断改走这些函数，行为不变但边界可测。

## 变更清单

- `android/app/src/main/java/com/ts7/dshremote/data/ConnectionRouter.kt`（新增）
- `.../data/SessionSyncManager.kt`（新增）
- `.../data/BridgeRepository.kt`：删掉搬走的私有 helper，调用点改走两个新模块
- `android/app/src/test/java/.../ConnectionRouterTest.kt`（5 例）、`SessionSyncManagerTest.kt`（6 例）
- `android/app/build.gradle.kts`：0.9.2 (versionCode 23)
- `host/package.json` / `lib/index.js`：0.9.2（保持三处版本一致）

## 验证

```
tools/test-android.ps1                → 45 个用例，失败 0（原 34 + 新增 11）
cd host && node scripts/check.mjs     → checked 27 host modules
cd host && node --test                → tests 164 / pass 163 / skip 1
node tools/verify-package.mjs         → PASS（38 个文件 / 26 个 lib/** 同哈希）
gradlew :app:assembleDebug            → BUILD SUCCESSFUL（0.9.2 / versionCode 23，按 ABI 三包）
```

仍然是 L2（单测）+ 可构建；**真机矩阵（R09）未跑**，`BridgeRepository` 的
协程调度、SSE 重连、切网这些副作用路径依旧只能靠设备验。

## 升级注意

- 与 0.9.1 行为一致，可平滑覆盖安装（debug 包名不变，token 在 Keystore 里，不需要重新配对）。
- 三种 APK 按架构选择：arm64-v8a（多数手机）/ x86_64（模拟器）/ universal（不确定时）。

## 附件

- `TS7-DSH-Remote-0.9.2-arm64-v8a-debug.apk`
- `TS7-DSH-Remote-0.9.2-x86_64-debug.apk`
- `TS7-DSH-Remote-0.9.2-debug.apk`（universal）
- `dsh-mobile-bridge-0.9.2.tgz`
- `tsnode-windows-amd64.exe`
- `SHA256SUMS-0.9.2.txt`
