import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  IMAGE_MEDIA_TYPES,
  MAX_IMAGE_BYTES,
  MAX_IMAGES,
  cleanTitle,
  promptContent,
  validTimeZone
} from '../lib/services/prompt.js'
import { clampLogLines, cleanFolderName, fileStamp, samePath, toEpochMillis } from '../lib/services/format.js'

/**
 * 从 server.js 搬出来的纯规则（R21 第一刀）。这些校验以前只能靠整条 HTTP 请求间接覆盖，
 * 现在可以逐条钉边界：图片数量/类型/base64/大小、标题、时区、路径与文件名。
 */

const PNG_B64 = Buffer.from('fake-png-bytes').toString('base64')

test('promptContent keeps text and images in order', () => {
  const content = promptContent('看这张图', [{ mediaType: 'image/png', data: PNG_B64, name: '  截图  ' }])
  assert.equal(content.length, 2)
  assert.deepEqual(content[0], { type: 'text', text: '看这张图' })
  assert.equal(content[1].type, 'image')
  assert.equal(content[1].mediaType, 'image/png')
  assert.equal(content[1].name, '截图')

  // 纯图片：没有文本项
  assert.equal(promptContent('', [{ mediaType: 'image/jpeg', data: PNG_B64 }]).length, 1)
  // 没有 images 字段
  assert.deepEqual(promptContent('hi', undefined), [{ type: 'text', text: 'hi' }])
})

test('promptContent rejects bad image payloads with stable codes', () => {
  const cases = [
    [{ notAnArray: true }, 'prompt/image-invalid'],
    [[null], 'prompt/image-invalid'],
    [[{ mediaType: 'image/tiff', data: PNG_B64 }], 'prompt/image-invalid'],
    [[{ mediaType: 'image/png', data: 'not base64!' }], 'prompt/image-invalid'],
    [[{ mediaType: 'image/png', data: '' }], 'prompt/image-invalid'],
    [new Array(MAX_IMAGES + 1).fill({ mediaType: 'image/png', data: PNG_B64 }), 'prompt/too-many-images']
  ]
  for (const [images, code] of cases) {
    assert.throws(() => promptContent('x', images), (error) => error.code === code, `期望 ${code}`)
  }
})

test('promptContent enforces the per-image byte limit', () => {
  const oversized = Buffer.alloc(MAX_IMAGE_BYTES + 3, 1).toString('base64')
  assert.throws(
    () => promptContent('x', [{ mediaType: 'image/png', data: oversized }]),
    (error) => error.code === 'prompt/image-too-large' && error.status === 413
  )
})

test('every advertised media type is accepted', () => {
  for (const mediaType of IMAGE_MEDIA_TYPES) {
    const content = promptContent('', [{ mediaType, data: PNG_B64 }])
    assert.equal(content.length, 1)
  }
})

test('cleanTitle trims, strips control characters and bounds the length', () => {
  assert.equal(cleanTitle('  开会记录  '), '开会记录')
  assert.equal(cleanTitle('a\u0000b\u001fc'), 'a b c')
  assert.throws(() => cleanTitle('   '), (error) => error.code === 'session/bad-title')
  assert.throws(() => cleanTitle(42), (error) => error.code === 'session/bad-title')
  assert.throws(() => cleanTitle('x'.repeat(201)), (error) => error.code === 'session/bad-title')
  assert.equal(cleanTitle('x'.repeat(200)).length, 200)
})

test('validTimeZone accepts real zones and drops junk', () => {
  assert.equal(validTimeZone('Asia/Shanghai'), 'Asia/Shanghai')
  assert.equal(validTimeZone('UTC'), 'UTC')
  assert.equal(validTimeZone('Not/AZone'), undefined)
  assert.equal(validTimeZone(''), undefined)
  assert.equal(validTimeZone('x'.repeat(65)), undefined)
  assert.equal(validTimeZone(12), undefined)
})

test('fileStamp formats a fixed date', () => {
  assert.equal(fileStamp(new Date(2026, 10, 17, 0, 12, 34)), '20261117-001234')
})

test('clampLogLines keeps the window between 20 and 1500', () => {
  assert.equal(clampLogLines('5'), 20)
  assert.equal(clampLogLines('5000'), 1500)
  assert.equal(clampLogLines('abc'), 400)
  assert.equal(clampLogLines(undefined, 250), 250)
  assert.equal(clampLogLines(42.6), 43)
})

test('toEpochMillis normalizes numbers, dates and strings', () => {
  assert.equal(toEpochMillis(1_700_000_000_000), 1_700_000_000_000)
  assert.equal(toEpochMillis(new Date(1_700_000_000_000)), 1_700_000_000_000)
  assert.equal(toEpochMillis('2023-11-14T22:13:20.000Z'), 1_700_000_000_000)
  assert.equal(toEpochMillis('not a date'), undefined)
  assert.equal(toEpochMillis(null), undefined)
  assert.equal(toEpochMillis(new Date('nope')), undefined)
})

test('samePath compares resolved paths, case-insensitively on Windows', () => {
  assert.equal(samePath('a/../b', 'b'), true)
  assert.equal(samePath('b', 'c'), false)
  if (process.platform === 'win32') {
    assert.equal(samePath('F:\\Work\\A', 'f:\\work\\a'), true)
  }
})

test('cleanFolderName sanitizes what the phone may create', () => {
  assert.equal(cleanFolderName('  周报 2026  '), '周报 2026')
  assert.equal(cleanFolderName('a<b>c:d'), 'abcd')
  assert.equal(cleanFolderName('名字\u0000带控制符'), '名字带控制符')
  assert.equal(cleanFolderName(''), null)
  assert.equal(cleanFolderName('   '), null)
  assert.equal(cleanFolderName('..'), null)
  assert.equal(cleanFolderName('.'), null)
  assert.equal(cleanFolderName(123), null)
  assert.equal(cleanFolderName('长'.repeat(80)).length, 60)
})
