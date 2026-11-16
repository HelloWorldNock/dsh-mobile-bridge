#!/usr/bin/env node
/**
 * 把「分发元数据 / 文档里的版本引用」从旧版本改到新版本。
 *
 *   node tools/pointers.mjs <旧版本> <新版本> [旧versionCode] [新versionCode]
 *
 * 覆盖：README 里的 tgz/APK/SHA256SUMS/RELEASE-note 引用、contrib 两份分发元数据、
 * ROADMAP-STATUS 的「最新 vX」「最近更新」「versionCode」。release.mjs 会自动调用它，
 * 手动补跑也不会重复改（找不到的项会跳过并标注）。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')

export function updatePointers({ from, to, codeFrom, codeTo, quiet = false }) {
  const say = (message) => {
    if (!quiet) console.log(message)
  }

  const swaps = (version) => [
    [`dsh-mobile-bridge-${version}.tgz`, `dsh-mobile-bridge-${to}.tgz`],
    [`TS7-DSH-Remote-${version}-`, `TS7-DSH-Remote-${to}-`],
    [`SHA256SUMS-${version}.txt`, `SHA256SUMS-${to}.txt`],
    [`docs/RELEASE-${version}.md`, `docs/RELEASE-${to}.md`],
    [`"version": "${version}"`, `"version": "${to}"`],
    [`最新 v${version}`, `最新 v${to}`],
    [`最近更新：${version}`, `最近更新：${to}`]
  ]

  const files = [
    'README.md',
    'contrib/dshmarket/plugins.json',
    'contrib/awesome-dsh-plugin/dsh-mobile-bridge.yml',
    'docs/ROADMAP-STATUS.md'
  ]

  const changed = []
  for (const rel of files) {
    const path = join(REPO, rel)
    if (!existsSync(path)) continue
    let text = readFileSync(path, 'utf8')
    const before = text
    for (const [a, b] of swaps(from)) text = text.split(a).join(b)
    if (codeFrom && codeTo) {
      // ROADMAP 里的 versionCode 只在「构建」一行出现，替换是安全的
      text = text.split(`versionCode ${codeFrom}`).join(`versionCode ${codeTo}`)
    }
    if (text !== before) {
      writeFileSync(path, text, 'utf8')
      changed.push(rel)
    }
  }

  say(changed.length > 0 ? `指针已更新：${changed.join('、')}` : '指针无需更新（已经指向新版本）')
  return changed
}

// 直接执行时当作命令行工具
if (process.argv[1] !== undefined && process.argv[1].endsWith('pointers.mjs')) {
  const [, , from, to, codeFrom, codeTo] = process.argv
  if (!from || !to) {
    console.error('用法: node tools/pointers.mjs <旧版本> <新版本> [旧versionCode] [新versionCode]')
    process.exit(2)
  }
  updatePointers({ from, to, codeFrom, codeTo })
}
