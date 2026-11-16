#!/usr/bin/env node
/**
 * 路由级契约漂移检查（G14）：与 G13（字段级）互补。
 *
 *   node tools/check-api-routes.mjs            # 双向比对
 *   node tools/check-api-routes.mjs --json
 *
 * 做法：
 *  1. 代码侧收集三种路由声明——字面量 `path === '/api/x'`、前缀 `path.startsWith('/api/x')`、
 *     以及正则字面量 `/^\/api\/…$/`（会话/审批这类「前缀 + 一段 action」的路由都是正则）；
 *  2. 文档侧取出 API.md 表格里所有 `/api/…` 路径；
 *  3. 双向判定：
 *     - 文档里的路径必须能被某条代码路由接住（正则能匹配，或落在字面量/前缀下）；
 *     - 代码里的字面量/前缀路由必须出现在文档里。
 *
 * 目的就是拦住「新加一条路由忘了写文档」和「删了路由文档还留着」两类漂移。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const SOURCES = [join(REPO, 'host/lib/server.js'), ...readdirSync(join(REPO, 'host/lib/routes')).filter((n) => n.endsWith('.js')).map((n) => join(REPO, 'host/lib/routes', n))]
const DOC = join(REPO, 'docs/API.md')

/** 归一化：去掉查询串，`${…}` / `([^/]+)` / `:param` 统一成 `:id`，去掉尾斜杠。 */
export function normalizePath(raw) {
  let path = String(raw).trim().split('?')[0]
  path = path.replace(/\$\{[^}]+\}/g, ':id')
  path = path.replace(/\/:[A-Za-z][A-Za-z0-9_]*/g, '/:id')
  path = path.replace(/\/+$/, '')
  return path
}

/** 把文档里的 `:id` 换成一个样例段，便于拿去试代码里的正则。 */
function concreteSample(path) {
  return path.replace(/:id/g, 'sample-id')
}

/** 有的路由把段位当数字解析（如 /images/:seq/:index），再试一遍纯数字样例。 */
function concreteNumericSample(path) {
  return path.replace(/:id/g, '7')
}

export function collectCodeRoutes() {
  const literals = new Map()
  const prefixes = new Map()
  const regexes = []

  for (const file of SOURCES) {
    const text = readFileSync(file, 'utf8')
    const name = file.split(/[\\/]/).pop()

    for (const match of text.matchAll(/path\s*===\s*'(\/api\/[^']*)'/g)) {
      const path = normalizePath(match[1])
      if (!literals.has(path)) literals.set(path, new Set())
      literals.get(path).add(name)
    }
    for (const match of text.matchAll(/path\s*===\s*`(\/api\/[^`]*)`/g)) {
      const path = normalizePath(match[1])
      if (!literals.has(path)) literals.set(path, new Set())
      literals.get(path).add(name)
    }
    for (const match of text.matchAll(/path\.startsWith\(\s*['`](\/api\/[^'`]*)['`]/g)) {
      const path = normalizePath(match[1])
      if (!prefixes.has(path)) prefixes.set(path, new Set())
      prefixes.get(path).add(name)
    }
    // 正则字面量路由：/^\/api\/sessions\/([^/]+)(?:\/([a-z]+))?$/
    for (const match of text.matchAll(/\/\^\\\/api[\s\S]*?\$\/[a-z]*/g)) {
      const source = match[0]
      if (!source.startsWith('/^')) continue
      try {
        const body = source.slice(1, source.lastIndexOf('/'))
        const flags = source.slice(source.lastIndexOf('/') + 1)
        regexes.push({ regex: new RegExp(body, flags), file: name, text: source })
      } catch {
        // 解析不了就跳过：宁可漏报也不误报
      }
    }
  }

  return { literals, prefixes, regexes }
}

export function collectDocumentedRoutes() {
  const doc = readFileSync(DOC, 'utf8')
  const found = new Map()
  for (const line of doc.split(/\r?\n/)) {
    if (!line.startsWith('|')) continue
    for (const match of line.matchAll(/`(\/api\/[^`\s]*)`/g)) {
      const path = normalizePath(match[1])
      if (!found.has(path)) found.set(path, true)
    }
  }
  return found
}

export function auditApiRoutes() {
  const { literals, prefixes, regexes } = collectCodeRoutes()
  const doc = collectDocumentedRoutes()

  const coveredByCode = (path) => {
    if (literals.has(path)) return true
    for (const prefix of prefixes.keys()) if (path === prefix || path.startsWith(`${prefix}/`)) return true
    const sample = concreteSample(path)
    const numeric = concreteNumericSample(path)
    return regexes.some(({ regex }) => regex.test(sample) || (numeric !== sample && regex.test(numeric)))
  }

  const undocumented = [...literals.keys()]
    .filter((path) => !doc.has(path) && path !== '/api')
    .map((path) => ({ path, files: [...literals.get(path)].sort() }))
    .sort((a, b) => a.path.localeCompare(b.path))

  const unmatchedDoc = [...doc.keys()]
    .filter((path) => !coveredByCode(path))
    .sort()

  return {
    code: { literals: literals.size, prefixes: prefixes.size, regexes: regexes.length },
    doc: doc.size,
    undocumented,
    unmatchedDoc
  }
}

const isMain = process.argv[1] !== undefined && process.argv[1].endsWith('check-api-routes.mjs')
if (isMain) {
  const result = auditApiRoutes()
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    console.log(
      `代码侧：字面量路由 ${result.code.literals} · 前缀 ${result.code.prefixes} · 正则 ${result.code.regexes}；文档登记 ${result.doc} 条`
    )
    if (result.undocumented.length > 0) {
      console.log(`✖ ${result.undocumented.length} 条路由代码里有、文档没登记：`)
      for (const item of result.undocumented) console.log(`  ${item.path}  ← ${item.files.join(', ')}`)
    }
    if (result.unmatchedDoc.length > 0) {
      console.log(`✖ ${result.unmatchedDoc.length} 条文档登记了、代码里接不住：`)
      for (const path of result.unmatchedDoc) console.log(`  ${path}`)
    }
    if (result.undocumented.length === 0 && result.unmatchedDoc.length === 0) {
      console.log('✔ 路由级契约双向一致')
    }
  }
  process.exit(result.undocumented.length === 0 && result.unmatchedDoc.length === 0 ? 0 : 1)
}
