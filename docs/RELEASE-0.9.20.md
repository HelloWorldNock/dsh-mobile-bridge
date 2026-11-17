# v0.9.20 — R26 收尾：发布签名真正落地（并顺带三处契约加固）

这一版把「Release 签名」从"链路就绪、缺私钥"推到**可验证的已签名产物**，另外收口了三个
契约/安全缺口。

## 一、R26：签名落地

- 生成发布密钥（`dsh-remote`，RSA 2048，有效期 10000 天），`android/keystore.properties`
  指向它；两者都在 `.gitignore` 里。
- `assembleRelease` 现在产出**已签名**包并通过校验：
  ```
  DN     : CN=TS7 DSH Remote, OU=Personal, O=TS7, L=Local, ST=Local, C=CN
  方案   : v1 / v2 / v3 / v3.1 / v4 全部通过
  ```
- 体积（已签名 release，ABI 拆分）：arm64 **33.1 MB**、x86_64 **34.6 MB**、universal **55.4 MB**
  —— 相比 debug 三包（39.2 / 40.6 / 61.5 MB）更小，因为不带调试符号。
- `tools/release.mjs` 升级：检测到 `android/keystore.properties` 时，**额外构建并附带已签名
  release 包**，并计入 `SHA256SUMS-<版本>.txt`。

### 踩过的坑：中文路径把 properties 写坏

`make-keystore.ps1` 用 `Set-Content -Encoding ASCII` 写 properties，而仓库路径含中文
（`TS7 DSH手机远控`），于是 `storeFile` 里的中文被写成 `????`，Gradle 报
`Keystore file '...\TS7 DSH????\...' not found`。

修法：properties 必须保持纯 ASCII —— 路径含非 ASCII 时改用 **ASCII junction**
（`C:\dshroot` → 仓库根）作为访问路径；脚本已内置这一步，会自动创建 junction。

## 二、三处契约/安全加固

1. `docs/API.md`：`/api/approvals/:id` 改为只列 `allow-once`\|`reject`，并注明
   **`allow-always` 未实现**（传它 400 `BAD_ACTION`，属 R27 范围）。
   顺带补齐 `/api/setup/tailscale`、`/api/setup/group` 的 `action` 取值（含此前漏写的 `refresh`）。
2. `host/test/approvals.test.js` 新增两条断言：
   - `allow-always` 必须被拒**且不结算卡片**；
   - 审批**超时必须 fail-closed** 返回 `unavailable`，且不产生 `allowed*` 结局。
3. G13 从「字段级」扩到**枚举级**：路由里比较过的每个 `action`/`preset` 取值都必须出现在
   `API.md`（`tools/check-api-doc.mjs` + `host/test/api-doc.test.js`）。

## 三、仓库卫生

- `.gitignore` 补上 `*.p12` 与「私钥/密钥笔记」类 txt；
- `host/test/repo-hygiene.test.js` 新增断言：**git 不得跟踪任何密钥类文件**
  （`.jks/.keystore/.p12/.pfx`、`keystore.properties`、名字含私钥/密钥的笔记）。
  起因是 `release.mjs` 会 `git add -A`，一次发版就能把私钥推进历史。

## 验证

```
node tools/gates.mjs          → 8 通过 / 0 失败 / 6 需人工
cd host && node --test        → 190 例（189 过 + 1 集成用例跳过）
tools/verify-apk-signature.ps1 -Apk <release.apk> -ExpectCommonName "CN=TS7 DSH Remote"
                              → PASS（v1–v4）
```

## 附件

- **已签名 release**：`TS7-DSH-Remote-0.9.20-arm64-v8a-release.apk` / `-x86_64-release.apk` / `-release.apk`
- debug（联调用）：`TS7-DSH-Remote-0.9.20-arm64-v8a-debug.apk` / `-x86_64-debug.apk` / `-debug.apk`
- `dsh-mobile-bridge-0.9.20.tgz`
- `tsnode-windows-amd64.exe`
- `SHA256SUMS-0.9.20.txt`

## 重要提醒

- `release` 包与 `debug` 包**签名不同**（前者用发布私钥，后者用 Android Debug 证书），
  两者不能互相覆盖安装；从 debug 换到 release 需要先卸载。
- 私钥与口令请离线备份：丢了就再也发不出「同签名」的升级包。
