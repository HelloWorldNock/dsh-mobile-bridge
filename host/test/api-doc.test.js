import { test } from 'node:test'
import assert from 'node:assert/strict'
import { auditApiDoc } from '../../tools/check-api-doc.mjs'

/**
 * 契约漂移守卫（G13 / R24 的自动化兜底）：
 * `host/lib/routes/*.js` 里读到的每一个 `body.<字段>` 都必须在 `docs/API.md` 里出现。
 *
 * 这轮就是靠它发现 `force` / `peerBaseUrl` / `selfBaseUrl` 三个字段没写进契约，
 * 以及更早两处「`plan` 要 `{active}`、`permission` 要 `{preset}`」的字段名错误。
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
