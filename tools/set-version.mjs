import { readFileSync, writeFileSync } from 'node:fs'

/** 一次性脚本：把三处版本号升到给定版本（避免 PowerShell 引号地狱）。 */
const [, , from, to, codeFrom, codeTo] = process.argv
if (!from || !to) {
  console.error('用法: node tools/set-version.mjs <旧版本> <新版本> [旧versionCode] [新versionCode]')
  process.exit(1)
}

const edits = [
  ['host/package.json', `"version": "${from}"`, `"version": "${to}"`],
  ['host/lib/index.js', `const VERSION = '${from}'`, `const VERSION = '${to}'`],
  ['android/app/build.gradle.kts', `versionName = "${from}"`, `versionName = "${to}"`]
]
if (codeFrom && codeTo) edits.push(['android/app/build.gradle.kts', `versionCode = ${codeFrom}`, `versionCode = ${codeTo}`])

for (const [file, a, b] of edits) {
  const text = readFileSync(file, 'utf8')
  if (!text.includes(a)) throw new Error(`${file} 里找不到 ${a}`)
  writeFileSync(file, text.split(a).join(b), 'utf8')
  console.log(`${file}: ${a} → ${b}`)
}
