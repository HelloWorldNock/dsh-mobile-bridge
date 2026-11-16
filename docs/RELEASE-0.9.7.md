# v0.9.7 — 面板样式搬进源码片段（R22 第三刀）

小版本，只动面板源码组织：`ensureStyle()` 与那一大段 CSS 从 `panel.mjs` 搬到
`host/client-src/styles.mjs`，生成器现在支持三片段（styles / helpers / components）。

## 变更

- `host/client-src/styles.mjs`（新增，90 行）：`STYLE_ID` + `ensureStyle()`，**原样搬出**；
- `host/client-src/panel.mjs`：1,160 → 1,079 行，样式位置只留 `/* __CLIENT_STYLES__ */` 占位；
- `tools/build-client.mjs`：`inlineFragment()` 统一处理函数与常量（去掉 `export`、加 4 空格缩进），
  并且改用「行首 export」定位起点——上一版用 `indexOf('export ')` 会被注释里
  「生成时会去掉 `export ` 关键字」这句话骗到，把 docblock 切一半；
- `host/lib/client.js` 重新生成：与 0.9.6 的 bundle **逐行内容一致**（1185 行非空行完全不差，仅位置移动）。

## 验证

```
node tools/build-client.mjs     → 生成 55,273 字节；--check 通过
node --check host/lib/client.js → 语法通过
新老 bundle 逐行对比（排序后）  → 原 1185 / 新 1185，缺失 0 行、多出 0 行
cd host && node --test          → tests 170 / pass 169 / skip 1
tools/test-android.ps1          → 55 个用例，失败 0（本版未改 Android 代码）
node tools/verify-package.mjs   → PASS（38 文件 / 26 个 lib/** 同哈希）
gradlew :app:assembleDebug      → BUILD SUCCESSFUL（0.9.7 / versionCode 28，ABI 三包）
```

顺带记一笔环境坑：`app:packageDebug` 的 `IncrementalSplitterRunnable` 会偶发失败（连续两次都撞上），
`gradlew :app:clean` 后重建即恢复；已在 Windows 上反复出现，排下次先 clean。

## 升级注意

行为与 0.9.6 完全一致；覆盖安装即可。

## 附件

- `TS7-DSH-Remote-0.9.7-arm64-v8a-debug.apk` / `-x86_64-debug.apk` / `-debug.apk`（universal）
- `dsh-mobile-bridge-0.9.7.tgz`
- `tsnode-windows-amd64.exe`
- `SHA256SUMS-0.9.7.txt`
