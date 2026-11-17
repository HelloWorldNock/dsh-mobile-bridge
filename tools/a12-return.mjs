#!/usr/bin/env node
/**
 * A12 复测：tailnet → 局域网 回切。
 *
 *   node tools/a12-return.mjs --serial <adb 序列号> [--tailnet 45]
 *
 * 流程（因为关 Wi-Fi 会连带断掉 adb，所以全程靠「先排定时任务，再看结果」）：
 *   1. 记录基线：手机当前连的是哪条路（读 App 顶部标签）；
 *   2. 排一个 T 秒后自动开回 Wi-Fi 的任务；
 *   3. 关 Wi-Fi，采样主机侧 lastSeen 是否从 tailnet 续上（证明此刻在 tailnet）；
 *   4. Wi-Fi 回来后，重新 dump UI，读标签是否变回「局域网」。
 *
 * 判据：两步都成立才算 A12 通过。
 */
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const ADB = process.env.ADB ?? join(REPO, '.toolchain/android-sdk/platform-tools/adb.exe')
const BASE = process.env.DSH_BRIDGE_BASE ?? 'http://127.0.0.1:48123'
const PHONE_NAME = process.env.DSH_PHONE_NAME ?? '24117RK2CC'
const PKG = 'com.ts7.dshremote.debug'

const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const index = argv.indexOf(name)
  return index >= 0 ? argv[index + 1] : fallback
}
const serial = arg('--serial', '')
const tailnetSeconds = Number(arg('--tailnet', '45'))
if (serial === '') {
  console.error('必须给 --serial')
  process.exit(2)
}

const adb = (args) => execFileSync(ADB, ['-s', serial, ...args], { encoding: 'utf8' })

function labelOf() {
  adb(['shell', 'uiautomator', 'dump', '/sdcard/_ui.xml'])
  const xml = adb(['shell', 'cat', '/sdcard/_ui.xml'])
  if (xml.includes('· 局域网')) return '局域网'
  if (xml.includes('· Tailscale') || xml.includes('tailnet')) return 'Tailscale'
  return '(未识别)'
}

async function phoneAge() {
  const state = await (await fetch(`${BASE}/api/setup/state`)).json()
  const device = (state.devices ?? []).find((item) => item.name === PHONE_NAME && !item.revokedAt)
  return device === undefined ? null : Math.round((Date.now() - Date.parse(device.lastSeenAt)) / 1000)
}

adb(['shell', 'am', 'start', '-n', `${PKG}/com.ts7.dshremote.MainActivity`])
await new Promise((r) => setTimeout(r, 2500))
const baseline = labelOf()
console.log(`基线路径：${baseline}`)

const restoreDelay = tailnetSeconds + 20
adb(['shell', `setsid nohup sh -c 'sleep ${restoreDelay}; svc wifi enable' >/dev/null 2>&1 </dev/null &`])
await new Promise((r) => setTimeout(r, 1000))
console.log(`已排定 ${restoreDelay} 秒后自动开回 Wi-Fi`)

adb(['shell', 'svc wifi disable'])
console.log('已关 Wi-Fi，采样主机侧是否从 tailnet 续上')

// 判据要认「年龄回落」而不是「当前小于 20 秒」——关网前 lastSeen 本来就是新鲜的，
// 直接用阈值会把「还没老化」误判成「已经切到 tailnet」。
let onTailnet = false
let previousAge = await phoneAge()
const started = Date.now()
while (Date.now() - started < tailnetSeconds * 1000) {
  await new Promise((r) => setTimeout(r, 3000))
  const age = await phoneAge()
  console.log(`  +${Math.round((Date.now() - started) / 1000)}s  lastSeen 距今 ${age} 秒`)
  if (age !== null && previousAge !== null && age < previousAge - 5) onTailnet = true
  if (age !== null) previousAge = age
}

console.log(`等 Wi-Fi 回来（约 ${restoreDelay} 秒）…`)
await new Promise((r) => setTimeout(r, (restoreDelay + 15) * 1000))

// 重连 adb（无线调试端口会变，用 mDNS）
try {
  execFileSync(ADB, ['kill-server'])
  execFileSync(ADB, ['start-server'])
} catch {
  // ignore
}
await new Promise((r) => setTimeout(r, 4000))

let after = '(adb 未恢复)'
let devices = ''
try {
  devices = execFileSync(ADB, ['devices'], { encoding: 'utf8' })
} catch {
  devices = ''
}
if (devices.includes('device')) {
  const target = serial === '' ? '' : serial
  const resolved = devices.split('\n').map((line) => line.trim()).find((line) => line.endsWith('\tdevice'))
  const use = devices.includes(target) ? target : (resolved?.replace('\tdevice', '') ?? '')
  if (use !== '') {
    try {
      adb(['shell', 'am', 'start', '-n', `${PKG}/com.ts7.dshremote.MainActivity`])
      await new Promise((r) => setTimeout(r, 2500))
      after = labelOf()
    } catch (error) {
      after = `(读取失败：${error.message.split('\n')[0]})`
    }
  }
}

console.log('')
console.log(`关网期间在 tailnet 上续上：${onTailnet ? '是' : '否'}`)
console.log(`Wi-Fi 回来后路径标签：${after}`)
const pass = onTailnet && after === '局域网'
console.log(pass ? '✔ A12 通过：tailnet → 局域网 自动回切' : '✖ A12 未通过（或 adb 未恢复，需人工看一眼标签）')
process.exit(pass ? 0 : 1)
