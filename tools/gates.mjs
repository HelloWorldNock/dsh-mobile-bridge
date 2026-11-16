#!/usr/bin/env node
/**
 * 门禁总账：把 docs/TESTING.md 里的 12 道门禁里**能自动跑的那些**一次跑完并出表。
 *
 *   node tools/gates.mjs            # 跑自动项，打印表格；有失败则退出码 1
 *   node tools/gates.mjs --json     # 只输出机器可读结果
 *   node tools/gates.mjs --only G01,G03
 *   node tools/gates.mjs --with-build   # 额外跑 G04（较慢，约 1–2 分钟）
 *
 * 需要真机的 G06/G09/G10/G11 会如实标成 manual（不是失败）。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const argv = process.argv.slice(2)
const JSON_OUT = argv.includes('--json')
const WITH_BUILD = argv.includes('--with-build')
const onlyIndex = argv.indexOf('--only')
const ONLY = onlyIndex >= 0 ? (argv[onlyIndex + 1] ?? '').split(',').map((s) => s.trim()).filter(Boolean) : null

const results = []

function record(id, title, status, detail) {
  results.push({ id, title, status, detail })
  if (!JSON_OUT) {
    const icon = status === 'pass' ? '✔' : status === 'fail' ? '✖' : '·'
    console.log(`${icon} ${id.padEnd(5)} ${title.padEnd(28)} ${detail}`)
  }
}

function shouldRun(id) {
  return ONLY === null || ONLY.includes(id)
}

function runCommand(command, args, options = {}) {
  const isBatch = process.platform === 'win32' && /\.(bat|cmd)$/i.test(command)
  const spawnCommand = isBatch ? 'cmd.exe' : command
  const spawnArgv = isBatch ? ['/c', command, ...args] : args
  const result = spawnSync(spawnCommand, spawnArgv, {
    cwd: options.cwd ?? REPO,
    encoding: 'utf8',
    env: options.env ?? process.env,
    maxBuffer: 64 * 1024 * 1024
  })
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

function summarize(text, pattern) {
  const match = text.match(pattern)
  return match === null ? '' : match[0].trim()
}

// G01 源码与安装包一致
if (shouldRun('G01')) {
  const r = runCommand(process.execPath, [join(REPO, 'tools/verify-package.mjs')])
  record('G01', '源码与安装包一致', r.status === 0 ? 'pass' : 'fail', r.status === 0 ? summarize(r.stdout, /PASS · .+/) : summarize(r.stdout + r.stderr, /[^\n]*✖[^\n]*|[^\n]*FAIL[^\n]*/))
}

// G03 Host 语法检查
if (shouldRun('G03')) {
  const r = runCommand(process.execPath, ['scripts/check.mjs'], { cwd: join(REPO, 'host') })
  record('G03', 'Host 语法检查', r.status === 0 ? 'pass' : 'fail', r.status === 0 ? summarize(r.stdout, /checked \d+ host modules/) : '见下方输出')
}

// G02 / G07 / G08 Host 测试（一个套件里覆盖鉴权矩阵与兼容性探针）
if (shouldRun('G02')) {
  const r = runCommand(process.execPath, ['--test'], { cwd: join(REPO, 'host') })
  const counts = r.stdout.match(/ℹ pass (\d+)[\s\S]*?ℹ fail (\d+)[\s\S]*?ℹ skipped (\d+)/)
  const detail = counts === null ? '拿不到统计' : `${counts[1]} 过 / ${counts[2]} 失败 / ${counts[3]} 跳过`
  record('G02', 'Host 测试（含 G07/G08）', r.status === 0 ? 'pass' : 'fail', detail)
  if (r.status !== 0 && !JSON_OUT) {
    console.log(r.stdout.split('\n').filter((line) => line.includes('✖')).slice(0, 5).join('\n'))
  }
}

// G05 签名验证
if (shouldRun('G05')) {
  const r = runCommand('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(REPO, 'tools/verify-apk-signature.ps1')])
  record('G05', 'APK 签名验证', r.status === 0 ? 'pass' : 'fail', r.status === 0 ? summarize(r.stdout, /PASS：.+|✔ [^\n]+/) : '未签名或校验失败')
}

// G04 Android 构建（慢，默认跳过）
if (shouldRun('G04')) {
  if (!WITH_BUILD) {
    record('G04', 'Android 构建', 'manual', '加 --with-build 才跑（约 1–2 分钟）')
  } else {
    const gradle = process.platform === 'win32' ? 'gradlew.bat' : './gradlew'
    const projectDir = existsSync('C:\\dshproj\\android') ? 'C:\\dshproj\\android' : join(REPO, 'android')
    const env = {
      ...process.env,
      JAVA_HOME: join(REPO, '.toolchain/jdk-17'),
      ANDROID_HOME: join(REPO, '.toolchain/android-sdk'),
      GRADLE_USER_HOME: process.env.GRADLE_USER_HOME ?? 'C:\\dshgh'
    }
    const r = runCommand(gradle, [':app:assembleDebug', '--console=plain', '--no-daemon'], { cwd: projectDir, env })
    record('G04', 'Android 构建', r.status === 0 ? 'pass' : 'fail', r.status === 0 ? 'assembleDebug 成功' : '构建失败')
  }
}

// G13 契约漂移
if (shouldRun('G13')) {
  const r = runCommand(process.execPath, [join(REPO, 'tools/check-api-doc.mjs')])
  record(
    'G13',
    'API 契约漂移',
    r.status === 0 ? 'pass' : 'fail',
    r.status === 0 ? summarize(r.stdout, /契约一致：\d+ 个 body 字段.*/) : '有 body 字段没写进 docs/API.md'
  )
}

// G12 发布信息一致性（版本三处 + Note 存在 + contrib 指向当前版本）
if (shouldRun('G12')) {
  try {
    const manifest = JSON.parse(readFileSync(join(REPO, 'host/package.json'), 'utf8')).version
    const indexJs = readFileSync(join(REPO, 'host/lib/index.js'), 'utf8')
    const gradle = readFileSync(join(REPO, 'android/app/build.gradle.kts'), 'utf8')
    const noteExists = existsSync(join(REPO, 'docs', `RELEASE-${manifest}.md`))
    const market = readFileSync(join(REPO, 'contrib/dshmarket/plugins.json'), 'utf8')
    const problems = []
    if (!indexJs.includes(`'${manifest}'`)) problems.push('lib/index.js 的 VERSION 不一致')
    if (!gradle.includes(`versionName = "${manifest}"`)) problems.push('build.gradle.kts 的 versionName 不一致')
    if (!noteExists) problems.push(`缺 docs/RELEASE-${manifest}.md`)
    if (!market.includes(manifest)) problems.push('contrib 没指向当前版本')
    record('G12', '发布信息一致', problems.length === 0 ? 'pass' : 'fail', problems.length === 0 ? `v${manifest} · 三处一致 · Note 在 · contrib 已指` : problems.join('；'))
  } catch (error) {
    record('G12', '发布信息一致', 'fail', String(error?.message ?? error))
  }
}

// 需要真机的门禁：如实标注
for (const [id, title] of [
  ['G06', '真机凭据保护'],
  ['G09', '真机主链路'],
  ['G10', '网络切换'],
  ['G11', '后台运行']
]) {
  if (!shouldRun(id)) continue
  record(id, title, 'manual', '需要真机（见 ACCEPTANCE-0.8.9.md 的矩阵）')
}

if (shouldRun('G04b')) {
  record('G04b', 'Release 构建', existsSync(join(REPO, 'android/keystore.properties')) ? 'manual' : 'manual', existsSync(join(REPO, 'android/keystore.properties')) ? '有密钥：可跑 :app:assembleRelease' : '缺 android/keystore.properties：先跑 tools/make-keystore.ps1')
}

const passed = results.filter((item) => item.status === 'pass').length
const failed = results.filter((item) => item.status === 'fail').length
const manual = results.filter((item) => item.status === 'manual').length

if (JSON_OUT) {
  console.log(JSON.stringify({ passed, failed, manual, results }, null, 2))
} else {
  console.log('')
  console.log(`门禁总账：${passed} 通过 / ${failed} 失败 / ${manual} 需人工`)
}
process.exit(failed > 0 ? 1 : 0)
