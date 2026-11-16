import { test } from 'node:test'
import assert from 'node:assert/strict'
import { auditApiRoutes } from '../../tools/check-api-routes.mjs'

/**
 * 路由级契约守卫（G14）：与 G13（字段级）互补。
 *
 * - 代码里声明的路由（字面量 / 前缀 / 正则）必须在 `docs/API.md` 的表格里登记；
 * - 文档里登记的每条路径必须能被某条代码路由接住（否则就是删了路由忘了改文档）。
 *
 * 本轮就是靠它发现 `/api/group/hello`（组握手，只认组密钥）一直没写进契约。
 */
test('route table in docs/API.md and the code agree in both directions', () => {
  const result = auditApiRoutes()

  assert.deepEqual(
    result.undocumented,
    [],
    `这些路由代码里有、文档没登记：${result.undocumented.map((item) => `${item.path}（${item.files.join(', ')}）`).join('；')}`
  )
  assert.deepEqual(result.unmatchedDoc, [], `这些文档登记的路由代码里接不住：${result.unmatchedDoc.join('；')}`)
  assert.ok(result.code.literals > 0 && result.doc > 0, '两侧都没抓到路由，检查提取逻辑')
})
