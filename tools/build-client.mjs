#!/usr/bin/env node
/**
 * 把 `client-src/` 里的片段拼成浏览器 bundle `lib/client.js`（R22）。
 *
 * DSH 的 client 插件是**单个** `lib/client.js`（`window.__ModuleLoader__.load` 包装），
 * 加载器只认 npm 包名、不认相对路径，所以不能像 Node 那样拆成多个运行时文件。
 * 折中做法：源码放在 `client-src/` 片段里，构建时内联成一个 bundle，
 * 纯函数片段另外用 ESM 导出给单测直接用。
 *
 *   node tools/build-client.mjs          # 生成
 *   node tools/build-client.mjs --check  # 只校验 bundle 是否过期（CI 用）
 *
 * 片段约定：
 * - `client-src/panel.mjs`：整个 bundle 的骨架，里面用 `/* __CLIENT_HELPERS__ *\/` 占位。
 * - `client-src/helpers.mjs`：纯函数，`export` 会被去掉后内联进占位处。
 */
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const HOST = join(HERE, '..', 'host')
const SRC = join(HOST, 'client-src')
const OUT = join(HOST, 'lib', 'client.js')
const PLACEHOLDER = '/* __CLIENT_HELPERS__ */'

/**
 * 内联 helpers 片段：
 * - 去掉文件头的说明性注释（那是给源码读者看的，bundle 里不需要）；
 * - 去掉 `export`，让函数成为 factory 作用域里的普通声明；
 * - 每行补 4 空格缩进，和 factory 内部层级一致。
 */
function inlineHelpers(source) {
  const body = source.slice(source.indexOf('export function'))
  return body
    .replace(/^export\s+function\s+/gm, 'function ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => (line.trim() === '' ? '' : `    ${line}`))
    .join('\n')
    .trimEnd()
}

export async function build({ check = false } = {}) {
  const [panel, helpers] = await Promise.all([
    readFile(join(SRC, 'panel.mjs'), 'utf8'),
    readFile(join(SRC, 'helpers.mjs'), 'utf8')
  ])
  if (!panel.includes(PLACEHOLDER)) {
    throw new Error(`client-src/panel.mjs 里找不到占位符 ${PLACEHOLDER}`)
  }
  const bundle = panel.replace(PLACEHOLDER, inlineHelpers(helpers))
  if (check) {
    const current = await readFile(OUT, 'utf8').catch(() => '')
    if (current !== bundle) {
      throw new Error('lib/client.js 已过期：跑 `node tools/build-client.mjs` 重新生成')
    }
    return { changed: false, bytes: bundle.length }
  }
  const current = await readFile(OUT, 'utf8').catch(() => '')
  await writeFile(OUT, bundle, 'utf8')
  return { changed: current !== bundle, bytes: bundle.length }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check')
  build({ check })
    .then((result) => {
      if (check) {
        process.stdout.write(`client bundle 是最新的（${result.bytes} 字节）\n`)
      } else {
        process.stdout.write(`client bundle 已生成（${result.bytes} 字节${result.changed ? '，内容有变化' : '，无变化'}）\n`)
      }
    })
    .catch((error) => {
      process.stderr.write(`${error.message}\n`)
      process.exit(1)
    })
}
