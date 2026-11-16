# v0.9.3 — 面板叶子组件拆到独立片段

小版本，只动面板源码组织：`PhoneIcon` / `Status` / `ErrorPanel` 从 `PanelBody` 里拆到
`host/client-src/components.mjs`，生成器 `tools/build-client.mjs` 支持多片段（helpers + components）。

## 变更

- `host/client-src/components.mjs`（新增）：三个只依赖 `h` 与 props 的叶子组件。
- `tools/build-client.mjs`：按占位符内联 `helpers.mjs` 与 `components.mjs`；`--check` 仍然拦「改了片段忘生成」。
- `host/lib/client.js` 由生成器重建：与 0.9.2 的 bundle 相比只有块位移（约 22 行），没有逻辑改动。
- `host/test/client-bundle.test.js` +3 例：
  - 组件元素树（给一个假 `h` 直接调用 `PhoneIcon` / `Status` / `ErrorPanel`，断言 svg/状态点/关闭回调）；
  - bundle 仍含 8 个入口函数（防止搬迁时误删）；
  - bundle 未过期（`build-client --check`）。

## 验证

```
cd host && node scripts/check.mjs   → checked 27 host modules
cd host && node --test              → tests 167 / pass 166 / skip 1
node tools/verify-package.mjs       → PASS（38 个文件 / 26 个 lib/** 同哈希）
tools/test-android.ps1              → 45 个用例，失败 0（本版未改 Android）
gradlew :app:assembleDebug          → BUILD SUCCESSFUL（0.9.3 / versionCode 24，按 ABI 三包）
```

行为与 0.9.2 一致；真机矩阵仍未跑（R09）。

## 附件

- `TS7-DSH-Remote-0.9.3-arm64-v8a-debug.apk` / `-x86_64-debug.apk` / `-debug.apk`（universal）
- `dsh-mobile-bridge-0.9.3.tgz`
- `tsnode-windows-amd64.exe`
- `SHA256SUMS-0.9.3.txt`
