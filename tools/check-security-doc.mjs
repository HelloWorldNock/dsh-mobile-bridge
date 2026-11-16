#!/usr/bin/env node
/**
 * 凭据契约漂移检查（G15）：`docs/SECURITY.md` 与实际代码里的凭据前缀必须对得上。
 *
 *   node tools/check-security-doc.mjs
 *   node tools/check-security-doc.mjs --json
 *
 * 规则：
 *  1. 代码里出现的每个凭据前缀（`dshm_` / `dshg_` / …）必须在 SECURITY.md 里出现——
 *     新加一种凭据却忘了写进安全文档，会被这条拦下；
 *  2. 文档里提到、代码里没有的前缀，必须落在明确标注「设计/规划/新增/落地顺序/未实现」
 *     的那一行上——用来区分「计划中的凭据」和「文档吹了个不存在的东西」。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const LIB = join(REPO, 'host/lib')
const DOC = join(REPO, 'docs/SECURITY.md')

const PREFIX = /dsh[a-z]_/g
const PLANNED_MARKERS = ['新增', '设计', '规划', '落地顺序', '未实现', '计划', '未落地', '建议']

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (entry.endsWith('.js')) out.push(full)
  }
  return out
}

export function collectImplementedPrefixes() {
  const found = new Map()
  for (const file of walk(LIB)) {
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(PREFIX)) {
      const prefix = match[0]
      if (!found.has(prefix)) found.set(prefix, new Set())
      found.get(prefix).add(file.replace(`${LIB}/`, '').replace(`${LIB}\\`, ''))
    }
  }
  return found
}

export function collectDocumentedPrefixes(docText = readFileSync(DOC, 'utf8')) {
  const lines = docText.split(/\r?\n/)
  const mentioned = new Map()
  for (const line of lines) {
    for (const match of line.matchAll(PREFIX)) {
      const prefix = match[0]
      const planned = PLANNED_MARKERS.some((marker) => line.includes(marker))
      if (!mentioned.has(prefix)) mentioned.set(prefix, { planned: false, lines: [] })
      const entry = mentioned.get(prefix)
      entry.planned = entry.planned || planned
      entry.lines.push(line.trim().slice(0, 80))
    }
  }
  return mentioned
}

/** 给测试用：把「代码侧前缀集合 + 文档文本」直接判一遍，不读磁盘。 */
export function classify({ implementedPrefixes, docText }) {
  const documented = collectDocumentedPrefixes(docText)
  const undocumented = [...implementedPrefixes].filter((prefix) => !documented.has(prefix)).sort()
  const phantom = [...documented.entries()]
    .filter(([prefix, entry]) => !implementedPrefixes.includes(prefix) && !entry.planned)
    .map(([prefix]) => prefix)
    .sort()
  return { undocumented, phantom }
}

export function auditSecurityDoc() {
  const implemented = collectImplementedPrefixes()
  const documented = collectDocumentedPrefixes()

  const undocumented = [...implemented.keys()]
    .filter((prefix) => !documented.has(prefix))
    .sort()
    .map((prefix) => ({ prefix, files: [...implemented.get(prefix)].sort() }))

  const phantom = [...documented.entries()]
    .filter(([prefix, entry]) => !implemented.has(prefix) && !entry.planned)
    .sort()
    .map(([prefix, entry]) => ({ prefix, lines: entry.lines }))

  return {
    implemented: [...implemented.keys()].sort(),
    documented: [...documented.entries()].map(([prefix, entry]) => ({ prefix, planned: entry.planned })),
    undocumented,
    phantom
  }
}

const isMain = process.argv[1] !== undefined && process.argv[1].endsWith('check-security-doc.mjs')
if (isMain) {
  const result = auditSecurityDoc()
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    console.log(`代码里实现了 ${result.implemented.join(' / ')}；SECURITY.md 提到 ${result.documented.length} 种前缀`)
    if (result.undocumented.length > 0) {
      console.log(`✖ ${result.undocumented.length} 种凭据代码里有、SECURITY.md 没写：`)
      for (const item of result.undocumented) console.log(`  ${item.prefix}  ← ${item.files.join(', ')}`)
    }
    if (result.phantom.length > 0) {
      console.log(`✖ ${result.phantom.length} 种凭据文档里说是现成的、代码里没有（也没标「设计/新增」）：`)
      for (const item of result.phantom) console.log(`  ${item.prefix}  ← ${item.lines[0]}`)
    }
    if (result.undocumented.length === 0 && result.phantom.length === 0) {
      console.log('✔ 凭据契约一致（计划的凭据已明确标注）')
    }
  }
  process.exit(result.undocumented.length === 0 && result.phantom.length === 0 ? 0 : 1)
}
