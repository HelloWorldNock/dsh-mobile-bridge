# v0.9.17 — 修好面板「Cannot read properties of undefined (reading 'trim')」

打开侧栏「手机远控」面板直接报错、整个面板渲染不出来。

## 根因

`TailscaleCard` 把一个业务字段命名成了 **`key`**：

```js
h(TailscaleCard, { ts, busy, ..., key: tsKey, ... })
```

`key` 是 React 的**保留属性**，`React.createElement` 会把它从 props 里剥掉。于是在组件内部
`authKey`（当时的 `key`）恒为 `undefined`，渲染时执行 `key.trim() === ""` 就抛
`Cannot read properties of undefined (reading 'trim')`——整块面板被错误边界接住，只剩一句报错。

这个 bug 之前一直藏着：宿主没启用 tailnet 时 `snap.tailscale` 为 null，这张卡片根本不渲染。
换到 DSH 0.2.2 后 tailscale 状态有了内容，卡片开始渲染，问题才暴露。

## 变更

- `components.mjs`：`TailscaleCard` 的 prop `key` → **`authKey`**（连同 `value` 与 `disabled` 的用法）。
- `panel.mjs`：调用点同步改名；`snap.settings.hasTailscaleAuthKey` 改成可选链（顺带防一手宿主状态缺字段）。
- 测试侧补上根源：假 React 的 `h()` 现在**像 React 一样剥掉 `key`/`ref`**，
  之前没剥，所以「把业务字段命名成保留字」这类 bug 测试抓不到。
  `client-tailscale.test.js` 里的 prop 也改成 `authKey`。

## 验证

```
node tools/build-client.mjs          → 生成 52,849 字节；--check 通过
cd host && node --test               → 185 例（184 过 + 1 集成用例跳过）
node tools/verify-package.mjs        → PASS（38 文件 / 26 个 lib/** 同哈希）
node tools/gates.mjs                 → 8 通过 / 0 失败 / 6 需人工
```

顺带证明过：用剥掉 `key` 的假 React 传旧写法 `{ key: '' }`，得到的报错正是
`Cannot read properties of undefined (reading 'trim')`——与截图一致。

## 升级注意

面板是客户端 bundle，**刷新一下 DSH 窗口**（Ctrl+R）即可加载新代码，不用重启宿主。

## 附件

- `TS7-DSH-Remote-0.9.17-arm64-v8a-debug.apk` / `-x86_64-debug.apk` / `-debug.apk`（universal）
- `dsh-mobile-bridge-0.9.17.tgz`
- `tsnode-windows-amd64.exe`
- `SHA256SUMS-0.9.17.txt`
