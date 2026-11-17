import { test } from 'node:test'
import assert from 'node:assert/strict'
import { auditApiDoc, auditRouteEnums } from '../../tools/check-api-doc.mjs'

/**
 * 契约漂移守卫（G13 / R24 的自动化兜底），两个层次：
 *  1. 字段级：`host/lib/routes/*.js` 里读到的每个 `body.<字段>` 都要在 `docs/API.md` 出现；
 *  2. 枚举级：路由里比较过的 `action` / `preset` 取值也要在文档里出现。
 *
 * 第 1 条抓到过 `force` / `peerBaseUrl` / `selfBaseUrl` 漏写，以及
 * 「`plan` 要 `{active}`、`permission` 要 `{preset}`」的字段名错误。
 * 第 2 条是因为 API.md 曾承诺 `allow-always`、而 `approvals.js` 只认 `allow-once` / `reject`
 * —— 那种「枚举值撒谎」字段级检查抓不到。
 */
test('every request body field read by the routes is documented in docs/API.md', () => {
  const { total, missing } = auditApiDoc()
  assert.ok(total > 0, '没能从路由里读到任何 body 字段（路径或正则坏了？）')
  assert.deepEqual(
    missing,
    [],
    `这些 body 字段在 docs/API.md 里没有出现：${missing.map((item) => `${item.field}（${item.files.join(', ')}）`).join('；')}`
  )
})

test('every action/preset value compared in the routes is documented in docs/API.md', () => {
  const { total, missing } = auditRouteEnums()
  assert.ok(total > 0, '没能从路由里读到任何 action/preset 取值（正则坏了？）')
  assert.deepEqual(
    missing,
    [],
    `这些枚举值在 docs/API.md 里没有出现：${missing.map((item) => `${item.value}（${item.files.join(', ')}）`).join('；')}`
  )
})
