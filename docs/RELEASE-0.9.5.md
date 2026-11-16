# v0.9.5 — 时间线折叠抽成纯函数（R20 第一刀）

小版本，只动 Android 内部结构：`SessionScreen` 里那段「把时间线折叠成行 + 铺成可复制纯文本」
的纯逻辑抽到 `data/TimelineFormat.kt`，并补 10 条 JVM 测试。行为与 0.9.4 一致。

## 变更

- `data/TimelineFormat.kt`（新增）：
  - `TimelineRowModel`（`Single` / `Tools`）从 `ui/screens/SessionScreen.kt` 移到 data 层；
  - `buildTimelineRows(timeline, showDetails)`：详细模式一条一行；简洁模式只在**连续**的
    `tool-call`/`tool-result` 上合并，中间夹一条用户消息就断开；
  - `timelineToPlainText(timeline, streamText)`：用户/助手整段保留、工具压成一行、
    工具结果优先取 `reason`、`turn` 起止分别标「运行中 / 完成」、流式缓冲附在末尾；
  - `TOOL_BODY_LIMIT = 600` 从魔法数字提成常量。
- `ui/screens/SessionScreen.kt`：删掉本地副本，改用 data 层函数（`SessionScreen` 从 1,084 行降到 ~960 行）。

## 测试

`android/app/src/test/.../TimelineFormatTest.kt`（10 例）：详细/简洁两种折叠、连续工具分组合并、
尾部工具组、空时间线、纯文本分段（`[我]`/`[DSH]`/`· 工具`）、`preview` 兜底、
流式缓冲追加、工具正文截断、turn 起止标签、空输出。

**Android 单测 45 → 55 例，全过。**

## 验证

```
tools/test-android.ps1              → 55 个用例，失败 0
cd host && node --test              → tests 170 / pass 169 / skip 1（本版未改 host）
node tools/verify-package.mjs       → PASS（38 个文件 / 26 个 lib/** 同哈希）
gradlew :app:assembleDebug          → BUILD SUCCESSFUL（0.9.5 / versionCode 26，按 ABI 三包）
```

## 升级注意

- 与 0.9.4 行为一致；覆盖安装即可（debug 包名不变，token 在 Keystore 里）。
- 仍未做真机矩阵（R09 的设备侧项），`SessionScreen` 的 Compose 渲染本身依旧只能靠设备验。

## 附件

- `TS7-DSH-Remote-0.9.5-arm64-v8a-debug.apk` / `-x86_64-debug.apk` / `-debug.apk`（universal）
- `dsh-mobile-bridge-0.9.5.tgz`
- `tsnode-windows-amd64.exe`
- `SHA256SUMS-0.9.5.txt`
