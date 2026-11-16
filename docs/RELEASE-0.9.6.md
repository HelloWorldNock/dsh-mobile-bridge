# v0.9.6 — 会话页拆成三个文件（R20 第二刀）

只动 Android UI 组织：`SessionScreen.kt` 从 1,054 行降到 **585 行**，时间线渲染与四个对话框
各自成文件，函数体一行未改写（由编译验证，55 例单测全过）。

| 文件 | 行数 | 内容 |
|---|---|---|
| `ui/screens/SessionScreen.kt` | 585 | 页面骨架、菜单、输入区、卡片编排 |
| `ui/screens/SessionTimeline.kt` | 392 | `ToolGroupRow`、`TimelineRow`、`MessageImages`、`MessageImageThumb`、`loadMessageBitmap` |
| `ui/screens/SessionDialogs.kt` | 284 | `ImageViewerDialog`、`RenameDialog`、`PermissionDialog`、`PlanDialog` |

搬迁规则：这些声明都是顶格 composable，边界就是「下一条顶格声明」；搬出的函数改 `private` → `internal`
（同包内互相调用）。**不要用花括号配平找边界**——Kotlin 字符串模板 `"${items.size} 步"` 里的花括号
会把边界算穿（本轮前两次尝试就是这样把 `TimelineRow` 切成两半、还丢了 `@Composable` 注解）。

## 验证

```
gradlew :app:compileDebugKotlin    → BUILD SUCCESSFUL（三次迭代后）
gradlew :app:testDebugUnitTest     → 55 例，失败 0
gradlew :app:assembleDebug         → BUILD SUCCESSFUL（0.9.6 / versionCode 27，ABI 三包）
cd host && node --test             → 170 例（169 过 + 1 集成用例跳过，本版未改 host）
node tools/verify-package.mjs      → PASS（38 文件 / 26 个 lib/** 同哈希）
```

## 升级注意

行为与 0.9.5 完全一致；覆盖安装即可。Compose 渲染本身仍只能靠真机验（R09 的设备侧项）。

## 附件

- `TS7-DSH-Remote-0.9.6-arm64-v8a-debug.apk` / `-x86_64-debug.apk` / `-debug.apk`（universal）
- `dsh-mobile-bridge-0.9.6.tgz`
- `tsnode-windows-amd64.exe`
- `SHA256SUMS-0.9.6.txt`
