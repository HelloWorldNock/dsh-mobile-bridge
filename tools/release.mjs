#!/usr/bin/env node
/**
 * 一键发版（把十几轮手工重复的流程固化下来）。
 *
 *   node tools/release.mjs --version 0.9.15 --notes docs/RELEASE-0.9.15.md
 *   node tools/release.mjs --version 0.9.15 --dry-run      # 只打印计划，不动任何东西
 *   node tools/release.mjs --version 0.9.15 --from build   # 从某一步继续
 *
 * 步骤：preflight → bump → pack → build-apk → sums → gates → commit → tag → push → release
 *
 * 环境相关的两个坑已内置：
 *   - `git push` 需要绕过/指定本地代理并用 openssl 后端（schannel 会握手失败）；
 *   - `gh release` 反而要清空代理变量才能上传资产。
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const STEPS = ['preflight', 'bump', 'pack', 'build-apk', 'sums', 'pointers', 'gates', 'commit', 'tag', 'push', 'release']
let previousVersion = null
let previousCode = null

function parseArgs(argv) {
  const out = { version: null, notes: null, dryRun: false, from: 'preflight', skipBuild: false, allowDirty: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--version') out.version = argv[++i]
    else if (arg === '--notes') out.notes = argv[++i]
    else if (arg === '--dry-run') out.dryRun = true
    else if (arg === '--from') out.from = argv[++i]
    else if (arg === '--skip-build') out.skipBuild = true
    else if (arg === '--allow-dirty') out.allowDirty = true
    else if (arg === '--help' || arg === '-h') {
      console.log('用法: node tools/release.mjs --version <x.y.z> [--notes <md>] [--dry-run] [--from <step>] [--skip-build] [--allow-dirty]')
      console.log(`步骤: ${STEPS.join(' → ')}`)
      process.exit(0)
    } else {
      console.error(`不认识的参数：${arg}`)
      process.exit(2)
    }
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
if (args.version === null || !/^\d+\.\d+\.\d+$/.test(args.version)) {
  console.error('必须给 --version <x.y.z>')
  process.exit(2)
}
if (!STEPS.includes(args.from)) {
  console.error(`--from 必须是这些之一：${STEPS.join(', ')}`)
  process.exit(2)
}

const notes = args.notes === null ? join(REPO, 'docs', `RELEASE-${args.version}.md`) : resolve(REPO, args.notes)
const startedAt = args.from

function log(message) {
  console.log(`[release] ${message}`)
}

function fail(message) {
  console.error(`[release] ✖ ${message}`)
  process.exit(1)
}

/** 执行一条命令；dry-run 时只打印。 */
function run(command, argv, options = {}) {
  const printable = [command, ...argv].join(' ')
  if (args.dryRun) {
    log(`(dry) ${printable}`)
    return { status: 0, stdout: '', stderr: '' }
  }
  log(printable)
  // Windows 上 .bat/.cmd 不能直接 spawn，要走 cmd /c
  const isBatch = process.platform === 'win32' && /\.(bat|cmd)$/i.test(command)
  const spawnCommand = isBatch ? 'cmd.exe' : command
  const spawnArgv = isBatch ? ['/c', command, ...argv] : argv
  const result = spawnSync(spawnCommand, spawnArgv, {
    cwd: options.cwd ?? REPO,
    encoding: 'utf8',
    env: options.env ?? process.env,
    maxBuffer: 64 * 1024 * 1024
  })
  if (result.status !== 0 && !options.allowFail) {
    console.error(result.stdout ?? '')
    console.error(result.stderr ?? '')
    fail(`命令失败（退出码 ${result.status}）：${printable}`)
  }
  return result
}

function shouldRun(step) {
  return STEPS.indexOf(step) >= STEPS.indexOf(startedAt)
}

function readJson(rel) {
  return JSON.parse(readFileSync(join(REPO, rel), 'utf8'))
}

// ---------------------------------------------------------------- preflight
function preflight() {
  if (!shouldRun('preflight')) return
  log('preflight: 检查工作树、版本脚本、notes')
  if (!existsSync(notes)) fail(`找不到发布说明：${notes}（先写好再发版）`)
  if (!args.allowDirty && !args.dryRun) {
    const status = run('git', ['status', '--porcelain'], { allowFail: true })
    const dirty = (status.stdout ?? '').trim()
    // 允许 bump 之前就有的改动：这里只要求「没有未跟踪的冲突文件」这种明显问题
    if (dirty !== '') log(`注意：工作树有未提交改动（${dirty.split('\n').length} 个文件），它们会一起进发版提交`)
  }
  const current = readJson('host/package.json').version
  log(`当前版本 ${current} → 目标版本 ${args.version}`)
  if (current === args.version) fail('目标版本与当前版本相同，无需发版')
}

// ---------------------------------------------------------------- bump
function bump() {
  if (!shouldRun('bump')) return
  const manifest = readJson('host/package.json')
  const current = manifest.version
  previousVersion = current
  const gradle = readFileSync(join(REPO, 'android/app/build.gradle.kts'), 'utf8')
  const codeMatch = gradle.match(/versionCode\s*=\s*(\d+)/)
  if (codeMatch === null) fail('build.gradle.kts 里找不到 versionCode')
  previousCode = codeMatch[1]
  const nextCode = String(Number(codeMatch[1]) + 1)
  run(process.execPath, [join(REPO, 'tools/set-version.mjs'), current, args.version, codeMatch[1], nextCode])
}

// ---------------------------------------------------------------- pointers
async function pointers() {
  if (!shouldRun('pointers')) return
  // --from pointers 续跑时，previousVersion 还没被赋过值：从 git 里取上一个版本
  if (previousVersion === null) {
    const tag = run('git', ['describe', '--tags', '--abbrev=0', 'HEAD'], { allowFail: true })
    const fromTag = (tag.stdout ?? '').trim().replace(/^v/, '')
    if (/^\d+\.\d+\.\d+$/.test(fromTag) && fromTag !== args.version) previousVersion = fromTag
  }
  if (previousVersion === null) {
    log('跳过 pointers：拿不到上一个版本号（手动跑 tools/pointers.mjs <旧> <新> 即可）')
    return
  }
  const { updatePointers } = await import('./pointers.mjs')
  if (args.dryRun) {
    log(`(dry) 把 README/contrib/ROADMAP 里的 ${previousVersion} 引用改成 ${args.version}`)
    return
  }
  updatePointers({ from: previousVersion, to: args.version, codeFrom: previousCode, codeTo: null, quiet: false })
}

// ---------------------------------------------------------------- pack
function pack() {
  if (!shouldRun('pack')) return
  run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(REPO, 'tools/pack-plugin.ps1')])
}

// ---------------------------------------------------------------- build-apk
function buildApk() {
  if (!shouldRun('build-apk') || args.skipBuild) return
  const gradle = process.platform === 'win32' ? 'gradlew.bat' : './gradlew'
  const env = {
    ...process.env,
    JAVA_HOME: join(REPO, '.toolchain/jdk-17'),
    ANDROID_HOME: join(REPO, '.toolchain/android-sdk'),
    GRADLE_USER_HOME: process.env.GRADLE_USER_HOME ?? 'C:\\dshgh'
  }
  // 仓库路径含中文时 Gradle 的 test worker 会取不到 @argfile classpath，
  // 所以构建也尽量走 ASCII junction（存在就用）。
  const projectDir = existsSync('C:\\dshproj\\android') ? 'C:\\dshproj\\android' : join(REPO, 'android')
  run(gradle, [':app:clean', '--console=plain', '--no-daemon'], { cwd: projectDir, env })
  run(gradle, [':app:assembleDebug', '--console=plain', '--no-daemon'], { cwd: projectDir, env })

  const outDir = join(REPO, 'android/app/build/outputs/apk/debug')
  const targets = [
    ['app-arm64-v8a-debug.apk', `TS7-DSH-Remote-${args.version}-arm64-v8a-debug.apk`],
    ['app-x86_64-debug.apk', `TS7-DSH-Remote-${args.version}-x86_64-debug.apk`],
    ['app-universal-debug.apk', `TS7-DSH-Remote-${args.version}-debug.apk`]
  ]
  for (const [source, target] of targets) {
    const from = join(outDir, source)
    if (!existsSync(from)) fail(`构建产物缺失：${from}`)
    if (args.dryRun) log(`(dry) 复制 ${source} → dist/${target}`)
    else copyFileSync(from, join(REPO, 'dist', target))
    log(`APK → dist/${target}`)
  }

  // 有发布私钥（android/keystore.properties）时，额外产出**已签名**的 release 包。
  // 这是 R26 的收尾：debug 包只给自用/联调，对外发的是签名 release 包。
  if (!existsSync(join(REPO, 'android/keystore.properties'))) {
    log('跳过 release 包：没有 android/keystore.properties（未配置发布私钥）')
    return
  }
  run(gradle, [':app:assembleRelease', '--console=plain', '--no-daemon'], { cwd: projectDir, env })
  const releaseDir = join(REPO, 'android/app/build/outputs/apk/release')
  const releaseTargets = [
    ['app-arm64-v8a-release.apk', `TS7-DSH-Remote-${args.version}-arm64-v8a-release.apk`],
    ['app-x86_64-release.apk', `TS7-DSH-Remote-${args.version}-x86_64-release.apk`],
    ['app-universal-release.apk', `TS7-DSH-Remote-${args.version}-release.apk`]
  ]
  for (const [source, target] of releaseTargets) {
    const from = join(releaseDir, source)
    if (!existsSync(from)) fail(`release 产物缺失：${from}（签名配置没生效？）`)
    if (args.dryRun) log(`(dry) 复制 ${source} → dist/${target}`)
    else copyFileSync(from, join(REPO, 'dist', target))
    log(`已签名 APK → dist/${target}`)
  }
}

// ---------------------------------------------------------------- sums
function sums() {
  if (!shouldRun('sums')) return
  const files = [
    `TS7-DSH-Remote-${args.version}-debug.apk`,
    `TS7-DSH-Remote-${args.version}-arm64-v8a-debug.apk`,
    `TS7-DSH-Remote-${args.version}-x86_64-debug.apk`,
    `dsh-mobile-bridge-${args.version}.tgz`,
    'tsnode-windows-amd64.exe'
  ]
  // 已配置发布私钥时，release 包也在 dist 里，一并计入 SHA256SUMS
  if (existsSync(join(REPO, 'android/keystore.properties'))) {
    files.push(
      `TS7-DSH-Remote-${args.version}-arm64-v8a-release.apk`,
      `TS7-DSH-Remote-${args.version}-x86_64-release.apk`,
      `TS7-DSH-Remote-${args.version}-release.apk`
    )
  }
  const lines = []
  for (const name of files) {
    const path = join(REPO, 'dist', name)
    if (!existsSync(path)) {
      // dry-run 不会真的复制 APK，这里只提示不报错
      if (args.dryRun) {
        log(`(dry) 尚未生成 ${name}`)
        continue
      }
      if (name.endsWith('.apk') && args.skipBuild) {
        log(`跳过缺失的 ${name}（--skip-build）`)
        continue
      }
      fail(`dist 里缺少 ${name}`)
    }
    if (args.dryRun) {
      log(`(dry) 记入 SHA256SUMS-${args.version}.txt：${name}`)
      continue
    }
    const hash = createHash('sha256').update(readFileSync(path)).digest('hex')
    lines.push(`${hash}  ${name}`)
  }
  if (args.dryRun) return
  writeFileSync(join(REPO, 'dist', `SHA256SUMS-${args.version}.txt`), `${lines.join('\n')}\n`, 'ascii')
  log(`dist/SHA256SUMS-${args.version}.txt（${lines.length} 行）`)
}

// ---------------------------------------------------------------- gates
function gates() {
  if (!shouldRun('gates')) return
  run(process.execPath, [join(REPO, 'tools/verify-package.mjs')])
  run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(REPO, 'tools/verify-apk-signature.ps1'), '-Apk', join(REPO, `dist/TS7-DSH-Remote-${args.version}-arm64-v8a-debug.apk`)])
  run(process.execPath, ['scripts/check.mjs'], { cwd: join(REPO, 'host') })
  run(process.execPath, ['--test'], { cwd: join(REPO, 'host') })
}

// ---------------------------------------------------------------- git
function commitAndTag() {
  if (shouldRun('commit')) {
    run('git', ['add', '-A'])
    run('git', ['-c', 'user.name=TS7', '-c', 'user.email=ts7@local', 'commit', '-m', `release: v${args.version}`])
  }
  if (shouldRun('tag')) {
    run('git', ['-c', 'user.name=TS7', '-c', 'user.email=ts7@local', 'tag', '-a', `v${args.version}`, '-m', `v${args.version}`])
  }
}

function push() {
  if (!shouldRun('push')) return
  const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy ?? ''
  const gitArgs = ['-c', 'http.sslBackend=openssl']
  if (proxy !== '') gitArgs.push('-c', `http.proxy=${proxy}`)
  run('git', [...gitArgs, 'push', 'origin', 'main'])
  run('git', [...gitArgs, 'push', 'origin', `v${args.version}`])
}

function ghRelease() {
  if (!shouldRun('release')) return
  const env = { ...process.env }
  delete env.HTTP_PROXY
  delete env.HTTPS_PROXY
  delete env.ALL_PROXY
  delete env.http_proxy
  delete env.https_proxy
  delete env.all_proxy
  const assets = readdirSync(join(REPO, 'dist'))
    .filter((name) => name.includes(args.version) || name === 'tsnode-windows-amd64.exe')
    .filter((name) => name.endsWith('.apk') || name.endsWith('.tgz') || name.endsWith('.txt') || name.endsWith('.exe'))
    .sort()
    .map((name) => join(REPO, 'dist', name))
  if (assets.length === 0) fail('dist 里没有可上传的资产')
  run('gh', ['release', 'create', `v${args.version}`, '--repo', 'HelloWorldNock/dsh-mobile-bridge', '--title', `v${args.version}`, '--notes-file', notes, ...assets], { env })
}

// ---------------------------------------------------------------- main
log(`目标版本 v${args.version}${args.dryRun ? '（dry-run）' : ''}，从 ${startedAt} 开始`)
preflight()
bump()
pack()
buildApk()
sums()
await pointers()
gates()
commitAndTag()
push()
ghRelease()
log(`完成：v${args.version}`)
