#!/usr/bin/env node
/**
 * 包一致性门禁（发布门禁 G01）。
 *
 * 校验三件事，任一不成立就以非零退出：
 *   1. 版本号在四处一致：host/package.json、host/lib/index.js 的 VERSION、
 *      android/app/build.gradle.kts 的 versionName 与 versionCode（且与 dist 产物名对得上）。
 *   2. tgz 里的 lib/*.js 与源码逐文件 SHA-256 相同，不漏不多。
 *   3. tgz 里带齐运行必需文件；若 dist/SHA256SUMS-<版本>.txt 已存在，tgz 的实测哈希必须与它一致。
 *
 * 不联网、不改任何文件、不安装依赖，只用 Node 内置模块解 tar.gz。
 *
 *   node tools/verify-package.mjs
 *   node tools/verify-package.mjs --tarball dist/dsh-mobile-bridge-0.8.9.tgz
 *   node tools/verify-package.mjs --json
 */

import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const PKG_DIR = join(REPO, 'host')

const REQUIRED_IN_TARBALL = [
  'package.json',
  'lib/index.js',
  'lib/client.js',
  'lib/server.js',
  'lib/state.js',
  'cordis.patch.yml',
  'icon.png',
  'locale/en.json',
  'locale/zh.json',
  'README.md',
  'LICENSE'
]

function parseArgs(argv) {
  const out = { tarball: null, source: PKG_DIR, json: false, expectVersion: null }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--json') out.json = true
    else if (arg === '--tarball') out.tarball = argv[++i] ?? null
    else if (arg === '--source') out.source = resolve(argv[++i] ?? PKG_DIR)
    else if (arg === '--expect-version') out.expectVersion = argv[++i] ?? null
    else if (arg === '--help' || arg === '-h') {
      console.log('用法：node tools/verify-package.mjs [--tarball <tgz>] [--source <host 目录>] [--expect-version <x.y.z>] [--json]')
      process.exit(0)
    } else {
      console.error(`不认识的参数：${arg}`)
      process.exit(2)
    }
  }
  return out
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

/** 读文本时去掉 UTF-8 BOM：Windows 编辑器很容易加上，JSON.parse 会直接崩。 */
function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/** 极简 tar 读取：够读 npm pack 产物（ustar + pax 路径覆盖），不处理稀疏文件与硬链接。 */
function readTar(buffer) {
  const entries = new Map()
  let offset = 0
  let paxPath = null
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) break
    const readString = (start, length) => {
      const slice = header.subarray(start, start + length)
      const end = slice.indexOf(0)
      return slice.subarray(0, end === -1 ? slice.length : end).toString('utf8')
    }
    const rawSize = readString(124, 12)
    const size = rawSize === '' ? 0 : parseInt(rawSize, 8)
    if (!Number.isFinite(size)) throw new Error(`tar 头部的 size 无法解析：${JSON.stringify(rawSize)}`)
    const typeflag = String.fromCharCode(header[156])
    const prefix = readString(345, 155)
    const name = prefix === '' ? readString(0, 100) : `${prefix}/${readString(0, 100)}`
    const dataStart = offset + 512
    const data = buffer.subarray(dataStart, dataStart + size)
    if (typeflag === 'x' || typeflag === 'X') {
      for (const record of data.toString('utf8').split('\n')) {
        const eq = record.indexOf('=')
        if (eq === -1) continue
        if (record.slice(0, eq).trim().endsWith('path')) paxPath = record.slice(eq + 1)
      }
    } else if (typeflag === '0' || typeflag === '\0') {
      entries.set(paxPath ?? name, Buffer.from(data))
      paxPath = null
    } else {
      paxPath = null
    }
    offset = dataStart + Math.ceil(size / 512) * 512
  }
  return entries
}

async function readVersionSources() {
  const manifestPath = join(PKG_DIR, 'package.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const indexPath = join(PKG_DIR, 'lib', 'index.js')
  const indexText = await readFile(indexPath, 'utf8')
  const gradlePath = join(REPO, 'android', 'app', 'build.gradle.kts')
  const gradleText = existsSync(gradlePath) ? await readFile(gradlePath, 'utf8') : ''
  const versionMatch = gradleText.match(/versionName\s*=\s*"([^"]+)"/)
  const codeMatch = gradleText.match(/versionCode\s*=\s*(\d+)/)
  const indexMatch = indexText.match(/const VERSION = '([^']+)'/)
  return {
    manifestPath,
    manifest: manifest.version ?? null,
    indexPath,
    index: indexMatch === null ? null : indexMatch[1],
    gradlePath,
    gradle: versionMatch === null ? null : versionMatch[1],
    versionCode: codeMatch === null ? null : codeMatch[1]
  }
}

async function listSourceLib(dir, prefix = 'lib') {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    const rel = `${prefix}/${entry.name}`
    if (entry.isDirectory()) {
      // 适配层之类的子目录也要比：`lib/adapters/dsh/*.js`
      out.push(...(await listSourceLib(full, rel)))
      continue
    }
    if (!entry.isFile() || !entry.name.endsWith('.js')) continue
    out.push({ rel, full })
  }
  out.sort((a, b) => a.rel.localeCompare(b.rel))
  return out
}

async function findSourceSums(version) {
  const file = join(REPO, 'dist', `SHA256SUMS-${version}.txt`)
  if (!existsSync(file)) return null
  const text = await readFile(file, 'utf8')
  const rows = []
  for (const line of text.split(/\r?\n/)) {
    const match = line.trim().match(/^([0-9a-f]{64})\s+\*?(.+)$/i)
    if (match !== null) rows.push({ hash: match[1].toLowerCase(), name: match[2].trim() })
  }
  return { file, rows }
}

function short(hash) {
  return hash === null ? '—' : hash.slice(0, 12)
}

/**
 * 读 APK 的 versionCode / versionName（用 SDK 的 aapt2）。
 * 没有工具链或没有 APK 时返回 null——由调用方决定是提示还是报错。
 */
async function readApkBadging(apkPath) {
  const buildTools = join(REPO, '.toolchain', 'android-sdk', 'build-tools')
  if (!existsSync(buildTools)) return null
  const dirs = (await readdir(buildTools, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse()
  const aapt2 = dirs
    .map((name) => join(buildTools, name, process.platform === 'win32' ? 'aapt2.exe' : 'aapt2'))
    .find((candidate) => existsSync(candidate))
  if (aapt2 === undefined) return null
  const { spawnSync } = await import('node:child_process')
  const result = spawnSync(aapt2, ['dump', 'badging', apkPath], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
  if (result.status !== 0) return null
  const match = (result.stdout ?? '').match(/versionCode='(\d+)' versionName='([^']+)'/)
  if (match === null) return null
  return { versionCode: match[1], versionName: match[2] }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const problems = []
  const notes = []
  const versions = await readVersionSources()

  // 1) 版本号四处一致
  const seen = [
    ['host/package.json', versions.manifest],
    ['host/lib/index.js', versions.index],
    ['android/app/build.gradle.kts versionName', versions.gradle]
  ]
  const distinct = [...new Set(seen.map(([, value]) => value).filter((value) => typeof value === 'string'))]
  if (distinct.length !== 1) {
    problems.push(`版本号不一致：${seen.map(([where, value]) => `${where}=${value ?? '缺失'}`).join(' · ')}`)
  }
  const version = distinct.length === 1 ? distinct[0] : (args.expectVersion ?? versions.manifest)
  if (args.expectVersion !== null && version !== args.expectVersion) {
    problems.push(`期望版本 ${args.expectVersion}，源码版本为 ${version}`)
  }
  if (versions.versionCode === null) {
    problems.push('android/app/build.gradle.kts 里找不到 versionCode')
  }

  // 2) 定位 tgz（默认按源码版本取名）
  const tarball = resolve(REPO, args.tarball ?? join('dist', `dsh-mobile-bridge-${version}.tgz`))
  if (!existsSync(tarball)) {
    problems.push(`找不到 tgz：${tarball}（先跑 tools/pack-plugin.ps1 重新打包）`)
    return finish({ problems, notes, version, versions, tarball, rows: [] })
  }

  const tarballBytes = await readFile(tarball)
  const tarballHash = sha256(tarballBytes)
  const tarballSize = (await stat(tarball)).size
  let entries = new Map()
  try {
    entries = readTar(gunzipSync(tarballBytes))
  } catch (error) {
    problems.push(`解包失败：${error?.message ?? String(error)}`)
    return finish({ problems, notes, version, versions, tarball, tarballHash, tarballSize, rows: [] })
  }

  // npm pack 会加一层 package/ 前缀
  const inner = new Map()
  for (const [name, data] of entries) {
    const rel = name.replace(/^[^/]+\//, '')
    inner.set(rel, data)
  }

  const packedManifest = inner.get('package.json')
  if (packedManifest === undefined) {
    problems.push('tgz 里没有 package.json')
  } else {
    try {
      const parsed = JSON.parse(packedManifest.toString('utf8'))
      if (parsed.version !== version) problems.push(`tgz 内 package.json 版本 ${parsed.version} ≠ 源码 ${version}`)
      if (parsed.name !== 'dsh-mobile-bridge') problems.push(`tgz 内包名 ${parsed.name} ≠ dsh-mobile-bridge`)
    } catch (error) {
      problems.push(`tgz 内 package.json 无法解析：${error?.message ?? String(error)}`)
    }
  }

  // 3) lib/*.js 逐文件哈希
  const sourceLib = await listSourceLib(join(PKG_DIR, 'lib'))
  const rows = []
  for (const file of sourceLib) {
    const sourceBytes = await readFile(file.full)
    const sourceHash = sha256(sourceBytes)
    const packed = inner.get(file.rel)
    if (packed === undefined) {
      rows.push({ file: file.rel, status: '缺失', sourceSize: sourceBytes.length, packedSize: null, sourceHash, packedHash: null })
      problems.push(`tgz 缺少 ${file.rel}`)
      continue
    }
    const packedHash = sha256(packed)
    const same = packedHash === sourceHash
    rows.push({
      file: file.rel,
      status: same ? '一致' : '不一致',
      sourceSize: sourceBytes.length,
      packedSize: packed.length,
      sourceHash,
      packedHash
    })
    if (!same) {
      problems.push(`${file.rel} 哈希不一致：源码 ${short(sourceHash)} (${sourceBytes.length} B) / tgz ${short(packedHash)} (${packed.length} B)`)
    }
  }
  const extraLib = [...inner.keys()].filter((name) => name.startsWith('lib/') && !sourceLib.some((file) => file.rel === name))
  for (const name of extraLib) problems.push(`tgz 里多出源码没有的文件：${name}`)

  // 4) 运行必需文件
  for (const required of REQUIRED_IN_TARBALL) {
    if (!inner.has(required)) problems.push(`tgz 缺少 ${required}`)
  }
  if (!inner.has('bin/tsnode-windows-amd64.exe')) {
    notes.push('tgz 未包含 bin/tsnode-windows-amd64.exe：面板会显示「缺少节点程序」，内嵌 Tailscale 不可用（源码安装可用 tools/build-tsnode.ps1 现编）')
  }

  // 5) SHA256SUMS 对账
  const sums = await findSourceSums(version)
  if (sums === null) {
    notes.push(`dist/SHA256SUMS-${version}.txt 尚不存在：发版时需要生成`)
  } else {
    const row = sums.rows.find((item) => item.name === basename(tarball))
    if (row === undefined) problems.push(`SHA256SUMS-${version}.txt 里没有 ${basename(tarball)} 的记录`)
    else if (row.hash !== tarballHash) problems.push(`tgz 实测哈希 ${short(tarballHash)} ≠ SHA256SUMS 记录 ${short(row.hash)}`)
  }

  // 6) APK 的版本号必须和源码一致（防止「升了版号但没重打 APK」）
  const apkDir = join(REPO, 'dist')
  const apkCandidates = existsSync(apkDir)
    ? (await readdir(apkDir))
        .filter((name) => name.startsWith(`TS7-DSH-Remote-${version}`) && name.endsWith('.apk'))
        .sort()
    : []
  let apk = null
  if (apkCandidates.length === 0) {
    notes.push(`dist 里没有 ${version} 的 APK：只校了 host 包（发版前要补 APK）`)
  } else {
    const preferred = apkCandidates.find((name) => name.includes('arm64-v8a')) ?? apkCandidates[0]
    const badging = await readApkBadging(join(apkDir, preferred))
    if (badging === null) {
      notes.push(`读不到 ${preferred} 的 badging（缺 build-tools 里的 aapt2？）`)
    } else {
      apk = { file: preferred, ...badging }
      if (!badging.versionName.startsWith(version)) {
        problems.push(`APK 版本名 ${badging.versionName} 与源码 ${version} 不一致（升版后忘了重打 APK？）`)
      }
      if (versions.versionCode !== null && badging.versionCode !== String(versions.versionCode)) {
        problems.push(`APK versionCode ${badging.versionCode} ≠ build.gradle.kts 的 ${versions.versionCode}`)
      }
    }
  }

  return finish({ problems, notes, version, versions, tarball, tarballHash, tarballSize, rows, extraLib, inner, apk })
}

function finish({ problems, notes, version, versions, tarball, tarballHash = null, tarballSize = null, rows = [], extraLib = [], inner = new Map(), apk = null }) {
  const result = {
    ok: problems.length === 0,
    version,
    sources: {
      manifest: versions?.manifest ?? null,
      index: versions?.index ?? null,
      gradle: versions?.gradle ?? null,
      versionCode: versions?.versionCode ?? null
    },
    tarball,
    tarballHash,
    tarballSize,
    filesInTarball: inner.size,
    rows,
    extraLib,
    apk,
    problems,
    notes
  }
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    const pad = (text, width) => String(text).padEnd(width)
    console.log(`包一致性门禁 · v${version}`)
    console.log(`  源码 package.json      ${versions?.manifest ?? '缺失'}`)
    console.log(`  源码 lib/index.js      ${versions?.index ?? '缺失'}`)
    console.log(`  Android versionName    ${versions?.gradle ?? '缺失'} (versionCode ${versions?.versionCode ?? '缺失'})`)
    console.log(`  tarball                ${tarball}`)
    if (tarballHash !== null) console.log(`  tarball sha256         ${tarballHash}  ${tarballSize} B / ${inner.size} 个文件`)
    if (apk !== null) console.log(`  APK 版本               ${apk.file} → ${apk.versionName} (versionCode ${apk.versionCode})`)
    if (rows.length > 0) {
      console.log('')
      console.log(`  ${pad('文件', 20)}${pad('结果', 8)}${pad('源码', 22)}${pad('tgz', 22)}`)
      for (const row of rows) {
        console.log(
          `  ${pad(row.file, 20)}${pad(row.status, 8)}${pad(`${short(row.sourceHash)} ${row.sourceSize}B`, 22)}${pad(
            row.packedHash === null ? '缺失' : `${short(row.packedHash)} ${row.packedSize}B`,
            22
          )}`
        )
      }
    }
    for (const name of extraLib) console.log(`  额外文件：${name}`)
    if (notes.length > 0) {
      console.log('')
      for (const note of notes) console.log(`  提示：${note}`)
    }
    if (problems.length > 0) {
      console.log('')
      for (const problem of problems) console.log(`  ✗ ${problem}`)
      console.log('')
      console.log(`FAIL · ${problems.length} 项不一致`)
    } else {
      console.log('')
      console.log('PASS · 源码、tgz、版本号三者一致')
    }
  }
  process.exit(problems.length === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(`verify-package 崩了：${error?.stack ?? String(error)}`)
  process.exit(2)
})
