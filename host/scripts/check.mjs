import { readdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../lib/', import.meta.url))

/** 递归收 lib 下的 .js：适配层之类的子目录也要过语法检查。 */
async function collect(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await collect(full)))
    else if (entry.name.endsWith('.js')) out.push(full)
  }
  return out.sort()
}

const files = await collect(root)
let failed = 0

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' })
  if (result.status !== 0) {
    failed += 1
    process.stderr.write(`${file.slice(root.length)}: ${result.stderr ?? result.stdout}\n`)
  }
}

if (failed > 0) {
  process.stderr.write(`${failed} file(s) failed syntax check\n`)
  process.exit(1)
}
process.stdout.write(`checked ${files.length} host modules\n`)
