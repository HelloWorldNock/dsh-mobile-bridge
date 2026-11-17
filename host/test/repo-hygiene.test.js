import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 仓库卫生检查。
 *
 * 起因：用 Windows 编辑器 / PowerShell 重定向改文件时很容易带上 UTF-8 BOM，
 * 而 `JSON.parse`、Kotlin DSL、Node 的 `--check` 都会因此失败（本项目已经踩过两次）。
 * 这里把「哪些文件不能带 BOM」变成一条断言。
 *
 * `.ps1` 例外：PowerShell 5.1 需要 BOM 才能正确解码中文。
 */

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SKIP_DIRS = new Set(['.git', 'node_modules', '.toolchain', 'dist', '.tmp', 'build', '.gradle', '.kotlin'])
const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.json', '.md', '.kt', '.kts', '.yml', '.yaml', '.xml', '.txt', '.gradle', '.properties', '.go', '.mod', '.html', '.css'])

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.github') {
      if (SKIP_DIRS.has(entry.name)) continue
    }
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      walk(full, out)
      continue
    }
    if (TEXT_EXT.has(extname(entry.name))) out.push(full)
  }
  return out
}

test('no tracked text file carries a UTF-8 BOM', () => {
  const offenders = []
  for (const file of walk(REPO)) {
    if (statSync(file).size < 3) continue
    const head = readFileSync(file).subarray(0, 3)
    if (head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) offenders.push(file.slice(REPO.length + 1))
  }
  assert.deepEqual(offenders, [], `这些文件带了 BOM（会导致 JSON.parse / node --check 失败）：\n${offenders.join('\n')}`)
})

test('build-client generated bundle matches its sources', async () => {
  // 与 client-bundle.test.js 的 --check 互为补充：这里只在源码被改动时给出明确提示。
  const { build } = await import('../../tools/build-client.mjs')
  const result = await build({ check: true })
  assert.equal(result.changed, false)
})

test('no key material or password note is tracked by git', async () => {
  // 起因：`release.mjs` 发版时会 `git add -A`。有一次仓库根出现了 keytool 生成后
  // 手抄的口令笔记（`安装包私钥.txt`）和密钥副本，若不拦住，一次发版就把私钥推进历史。
  // .gitignore 是第一道闸，这条断言是第二道（防止有人 `git add -f`）。
  const { execFileSync } = await import('node:child_process')
  const tracked = execFileSync('git', ['ls-files'], { cwd: REPO, encoding: 'utf8' }).split('\n').filter(Boolean)
  const offenders = tracked.filter((file) =>
    /\.(jks|keystore|p12|pfx)$/i.test(file) ||
    /keystore\.properties$/i.test(file) ||
    /私钥|密钥|password|secret/i.test(file) ||
    /(^|\/)id_rsa/.test(file)
  )
  assert.deepEqual(offenders, [], `这些密钥类文件被 git 跟踪了，必须从索引里移除：\n${offenders.join('\n')}`)
})
