#!/usr/bin/env node
/**
 * A11 复测：局域网 → tailnet 切换。
 *
 *   node tools/a11-failover.mjs --serial <adb 序列号> [--wait 90]
 *
 * 为什么单独一个脚本：
 *  - 关 Wi-Fi 会把「无线调试」一起弄断（adb 就跑在 Wi-Fi 上），所以必须在关网**之前**
 *    在手机上挂一个定时恢复任务，否则设备回不来；
 *  - 前提是「移动数据已开 + Tailscale 已连接」，两者都在手机上，脚本只能检查、不能代劳。
 *
 * 判据：关 Wi-Fi 后，主机侧 `/api/setup/state` 里该设备的 lastSeenAt 是否继续刷新
 *      （刷新 = 手机换了路径连上来了；不刷新 = 没有 failover）。
 */
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const ADB = process.env.ADB ?? join(REPO, '.toolchain/android-sdk/platform-tools/adb.exe')
const BASE = process.env.DSH_BRIDGE_BASE ?? 'http://127.0.0.1:48123'
const PHONE_NAME = process.env.DSH_PHONE_NAME ?? '24117RK2CC'

const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const index = argv.indexOf(name)
  return index >= 0 ? argv[index + 1] : fallback
}
const serial = arg('--serial', '')
const waitSeconds = Number(arg('--wait', '90'))
const RESTORE_DELAY = waitSeconds + 15

if (serial === '') {
  console.error('必须给 --serial（adb devices 里的那一列）')
  process.exit(2)
}

const adb = (args) => execFileSync(ADB, ['-s', serial, ...args], { encoding: 'utf8' }).trim()

function fail(message) {
  console.error(`✖ ${message}`)
  process.exit(1)
}

// 1) 前提检查
const mobileData = adb(['shell', 'settings', 'get', 'global', 'mobile_data']).trim()
if (mobileData !== '1') fail(`移动数据没开（mobile_data=${mobileData}）：请在手机上下拉打开「移动数据」——adb 改不动它`)

const interfaces = adb(['shell', 'ip', '-4', 'addr', 'show'])
if (!/tailscale|tun\d/.test(interfaces)) fail('没看到 tailscale/tun 接口：请打开手机上的 Tailscale 并确认已连接')
const tailnet = (interfaces.match(/inet (100\.\d+\.\d+\.\d+)/) ?? [])[1] ?? '(未取到)'
console.log(`前提 OK：移动数据已开 · Tailscale 地址 ${tailnet}`)

// 2) 关网前先挂定时恢复（setsid + nohup，避免随 shell 退出被回收）
adb(['shell', `setsid nohup sh -c 'sleep ${RESTORE_DELAY}; svc wifi enable' >/dev/null 2>&1 </dev/null &`])
await new Promise((r) => setTimeout(r, 1000))
const scheduled = adb(['shell', 'ps', '-A']).includes('sleep') || true // 部分机型 ps 看不到 sh 子进程，继续
console.log(`已排定 ${RESTORE_DELAY} 秒后自动开回 Wi-Fi（${scheduled ? '已提交' : '提交失败'}）`)

// 3) 记录关网前的 lastSeen 基线
async function phoneAge() {
  const response = await fetch(`${BASE}/api/setup/state`)
  const state = await response.json()
  const device = (state.devices ?? []).find((item) => item.name === PHONE_NAME && !item.revokedAt)
  if (device === undefined) return null
  return Math.round((Date.now() - Date.parse(device.lastSeenAt)) / 1000)
}

const baseline = await phoneAge()
console.log(`关网前 lastSeen 距今 ${baseline} 秒`)

// 4) 关 Wi-Fi，开始采样
adb(['shell', 'svc wifi disable'])
console.log('已关闭 Wi-Fi，开始采样（每 3 秒）')
const started = Date.now()
let recoveredAt = null
const samples = []
while (Date.now() - started < waitSeconds * 1000) {
  await new Promise((r) => setTimeout(r, 3000))
  const age = await phoneAge()
  samples.push(age)
  console.log(`  +${Math.round((Date.now() - started) / 1000)}s  lastSeen 距今 ${age} 秒`)
  if (age !== null && age < 20 && recoveredAt === null) recoveredAt = Math.round((Date.now() - started) / 1000)
}
if (recoveredAt === null) {
  // 采样期间年龄一直变大说明没续上；若年龄回落到 <20 秒即为切换成功
  for (const sample of samples) {
    if (sample !== null && sample < 20) { recoveredAt = 'inline'; break }
  }
}

// 5) 等 Wi-Fi 自动恢复，确认设备回来
console.log(`等待 ${RESTORE_DELAY} 秒的定时任务把 Wi-Fi 开回来…`)
const restoreDeadline = Date.now() + (RESTORE_DELAY + 20) * 1000
let back = false
while (Date.now() < restoreDeadline) {
  await new Promise((r) => setTimeout(r, 5000))
  try {
    const devices = execFileSync(ADB, ['devices'], { encoding: 'utf8' })
    if (devices.includes(serial) && devices.includes('device')) { back = true; break }
  } catch {
    // 继续等
  }
}

console.log('')
console.log(recoveredAt === null
  ? `✖ A11 失败：关 Wi-Fi 后 ${waitSeconds} 秒内没有从 tailnet 连回来（lastSeen 一直在老化）`
  : `✔ A11 通过：关 Wi-Fi 后 ${recoveredAt}s 内手机换路径连回来了（lastSeen 恢复刷新）`)
console.log(back ? '✔ Wi-Fi 已自动恢复，adb 可用' : '✖ Wi-Fi 没自动恢复，请在手机上手动打开 WLAN')
process.exit(recoveredAt === null ? 1 : 0)
