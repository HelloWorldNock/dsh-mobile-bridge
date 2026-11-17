#!/usr/bin/env node
/**
 * 契约漂移检查（G13）：`host/lib/routes/*.js` 里读到的 `body.<字段>` 必须能在 `docs/API.md` 里找到。
 *
 *   node tools/check-api-doc.mjs           # 打印缺失项，有缺失退出码 1
 *   node tools/check-api-doc.mjs --json
 *
 * 只做「字段级」检查：不追求每个字段挂在正确的路由下（那要解析路由表），
 * 但足以拦住「代码新增了 body 字段、文档没写」这类最常见的漂移。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const routesDir = join(REPO, 'host/lib/routes')
const docPath = join(REPO, 'docs/API.md')

/** 代码里实际读的字段 → 出现在哪些文件。 */
export function collectBodyFields() {
  const map = new Map()
  for (const file of readdirSync(routesDir).filter((name) => name.endsWith('.js'))) {
    const text = readFileSync(join(routesDir, file), 'utf8')
    for (const match of text.matchAll(/body\.([A-Za-z][A-Za-z0-9]*)/g)) {
      const field = match[1]
      if (!map.has(field)) map.set(field, new Set())
      map.get(field).add(file)
    }
  }
  return map
}

/** 文档里出现过的字段名（按单词边界匹配，避免 hello 命中 elsewhere）。 */
export function documentedFields() {
  const doc = readFileSync(docPath, 'utf8')
  const fields = new Set()
  for (const match of doc.matchAll(/[A-Za-z][A-Za-z0-9]*/g)) fields.add(match[0])
  return fields
}

/**
 * 代码里比较过的 `action` / `preset` 取值。
 *
 * 只扫 `routes/*.js`：这些是 HTTP 契约的枚举值。`tool.js` 里的取值属于 Agent 工具参数，
 * 记在 host/README，不该由 API.md 兜。
 *
 * 为什么需要这条：0.9.19 之前 API.md 写着 `allow-always`，而 `approvals.js` 只认
 * `allow-once` / `reject` —— 字段级检查（只比字段名）抓不到这种「枚举值撒谎」。
 */
export function collectRouteEnums() {
  const routesDir = join(REPO, 'host/lib/routes')
  const map = new Map()
  for (const file of readdirSync(routesDir).filter((name) => name.endsWith('.js'))) {
    const text = readFileSync(join(routesDir, file), 'utf8')
    for (const match of text.matchAll(/(?:action|preset)\s*===\s*'([A-Za-z][A-Za-z0-9_-]*)'/g)) {
      const value = match[1]
      if (!map.has(value)) map.set(value, new Set())
      map.get(value).add(file)
    }
  }
  return map
}

/** 枚举值审计：路由里比较过的取值必须出现在 API.md。 */
export function auditRouteEnums() {
  const code = collectRouteEnums()
  const doc = readFileSync(docPath, 'utf8')
  const missing = [...code.entries()]
    .filter(([value]) => !doc.includes(value))
    .map(([value, files]) => ({ value, files: [...files].sort() }))
    .sort((a, b) => a.value.localeCompare(b.value))
  return { total: code.size, missing }
}

export function auditApiDoc() {
  const code = collectBodyFields()
  const doc = documentedFields()
  const missing = [...code.entries()]
    .filter(([field]) => !doc.has(field))
    .map(([field, files]) => ({ field, files: [...files].sort() }))
    .sort((a, b) => a.field.localeCompare(b.field))
  return { total: code.size, missing }
}

const isMain = process.argv[1] !== undefined && process.argv[1].endsWith('check-api-doc.mjs')
if (isMain) {
  const { total, missing } = auditApiDoc()
  const enums = auditRouteEnums()
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ total, missing, enums: { total: enums.total, missing: enums.missing } }, null, 2))
  } else {
    if (missing.length === 0) {
      console.log(`字段一致：${total} 个 body 字段都能在 docs/API.md 里找到`)
    } else {
      console.log(`✖ ${missing.length} / ${total} 个 body 字段在 docs/API.md 里没有出现：`)
      for (const item of missing) console.log(`  ${item.field}  ← ${item.files.join(', ')}`)
    }
    if (enums.missing.length === 0) {
      console.log(`枚举一致：${enums.total} 个 action/preset 取值都能在 docs/API.md 里找到`)
    } else {
      console.log(`✖ ${enums.missing.length} / ${enums.total} 个 action/preset 取值在 docs/API.md 里没有出现：`)
      for (const item of enums.missing) console.log(`  ${item.value}  ← ${item.files.join(', ')}`)
    }
  }
  process.exit(missing.length === 0 && enums.missing.length === 0 ? 0 : 1)
}
