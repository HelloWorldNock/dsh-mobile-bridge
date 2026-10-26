import { readdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../lib/', import.meta.url))
const files = (await readdir(root)).filter((name) => name.endsWith('.js')).sort()
let failed = 0

for (const name of files) {
  const result = spawnSync(process.execPath, ['--check', join(root, name)], {
    encoding: 'utf8'
  })
  if (result.status !== 0) {
    failed += 1
    process.stderr.write(`${name}: ${result.stderr ?? result.stdout}\n`)
  }
}

if (failed > 0) {
  process.stderr.write(`${failed} file(s) failed syntax check\n`)
  process.exit(1)
}
process.stdout.write(`checked ${files.length} host modules\n`)
