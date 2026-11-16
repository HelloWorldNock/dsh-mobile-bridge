import { test } from 'node:test'
import assert from 'node:assert/strict'
import { auditSecurityDoc, classify } from '../../tools/check-security-doc.mjs'

/**
 * 凭据契约守卫（G15）。
 *
 * 判据有两半：
 *  - 代码里实现的凭据前缀必须出现在 `docs/SECURITY.md`；
 *  - 文档里提到但代码里没有的前缀，必须落在明确标注「设计 / 新增 / 落地顺序」等那一行上，
 *    否则就是「文档吹了个不存在的东西」。
 */
test('every credential prefix implemented in code is documented in docs/SECURITY.md', () => {
  const result = auditSecurityDoc()
  assert.ok(result.implemented.length > 0, '没能从代码里抓到任何凭据前缀（提取逻辑坏了？）')
  assert.deepEqual(
    result.undocumented.map((item) => item.prefix),
    [],
    `这些凭据代码里有、SECURITY.md 没写：${result.undocumented.map((item) => `${item.prefix}（${item.files.join(', ')}）`).join('；')}`
  )
  assert.deepEqual(
    result.phantom.map((item) => item.prefix),
    [],
    `这些凭据文档说是现成的、代码里没有：${result.phantom.map((item) => item.prefix).join('、')}`
  )
})

test('the classifier separates planned credentials from phantom ones', () => {
  const docText = [
    '| 设备 token | `dshm_` 前缀 | 现成 |',
    '| 组密钥 | `dshg_` 前缀 | 现成 |',
    '| 成员凭据（新增） | `dshp_` 前缀 | 计划中 |',
    '| 幽灵凭据 | `dshx_` 前缀 | 文档里写得像现成的 |'
  ].join('\n')

  const result = classify({ implementedPrefixes: ['dshm_', 'dshg_'], docText })
  assert.deepEqual(result.undocumented, [], '实现里没有未文档化的前缀')
  assert.deepEqual(result.phantom, ['dshx_'], 'dshp_ 标了「新增」应算计划中，dshx_ 没标应算幽灵')

  const missing = classify({ implementedPrefixes: ['dshm_', 'dshz_'], docText })
  assert.deepEqual(missing.undocumented, ['dshz_'], '代码新增了 dshz_ 而文档没写，应当被拦下')
})
