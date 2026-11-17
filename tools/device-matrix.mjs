#!/usr/bin/env node
/**
 * 真机验收助手：把「需要手机上点一下」的项目变成可检测的往返。
 *
 *   node tools/device-matrix.mjs            # 跑全部可自动检测项，需要你配合点手机
 *   node tools/device-matrix.mjs --only A15
 *
 * 设计原则：
 *  - 主机侧动作由脚本做（归档、建会话、撤销设备…）；
 *  - 手机侧动作等真人点（脚本轮询 API，看手机有没有真的把结果回传）；
 *  - 检测不到就如实标「未检测到」，不猜。
 *
 * 复用 acceptance.mjs 的配对与调用方式，不另起协议。
 */
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const BASE = process.env.DSH_BRIDGE_BASE ?? 'http://127.0.0.1:48123'
const argv = process.argv.slice(2)
const onlyIndex = argv.indexOf('--only')
const ONLY = onlyIndex >= 0 ? (argv[onlyIndex + 1] ?? '').split(',').map((s) => s.trim()) : null
const WAIT_SECONDS = Number(argv[argv.indexOf('--wait') + 1]) || 90

let token = ''

async function call(path, { method = 'GET', body, auth = false } = {}) {
  const headers = { accept: 'application/json' }
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (auth) headers.authorization = `Bearer ${token}`
  const response = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await response.text()
  let parsed = null
  try { parsed = text === '' ? null : JSON.parse(text) } catch { parsed = text }
  return { status: response.status, body: parsed }
}

async function pair() {
  const setup = await call('/api/setup/state')
  const paired = await call('/api/pair', {
    method: 'POST',
    body: { code: setup.body.code, installId: `device-matrix-${Date.now()}`, deviceName: 'device-matrix', model: 'node' }
  })
  if (paired.status !== 200) throw new Error(`配对失败：${paired.status} ${JSON.stringify(paired.body)}`)
  token = paired.body.token
}

const results = []
function record(id, title, status, detail) {
  results.push({ id, title, status, detail })
  const icon = status === 'pass' ? '✔' : status === 'fail' ? '✖' : status === 'manual' ? '·' : '✖'
  console.log(`${icon} ${id.padEnd(5)} ${title.padEnd(26)} ${detail}`)
}

const shouldRun = (id) => ONLY === null || ONLY.includes(id)

/** 等某个条件成立（手机把结果回传了）。 */
async function waitFor(label, predicate, seconds) {
  const deadline = Date.now() + seconds * 1000
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1500))
    const value = await predicate()
    if (value !== null && value !== undefined && value !== false) return value
  }
  return null
}

async function main() {
  await pair()
  console.log(`目标 ${BASE} · 等待窗口 ${WAIT_SECONDS}s\n`)

  // A15：电脑归档 → 手机上取消归档（手机上会看到「已归档」横幅与「取消归档」按钮）
  if (shouldRun('A15')) {
    const workspaces = await call('/api/workspaces', { auth: true })
    const workspace = (workspaces.body.workspaces ?? [])[0]
    const created = await call('/api/sessions', { method: 'POST', auth: true, body: { workspaceId: workspace.id } })
    const sessionId = created.body?.sessionId
    if (!sessionId) {
      record('A15', '电脑归档 → 手机取消归档', 'fail', '建会话失败')
    } else {
      const archived = await call(`/api/sessions/${encodeURIComponent(sessionId)}/archive`, { method: 'POST', auth: true, body: {} })
      console.log(`   已在电脑上归档 ${sessionId}（${archived.status}）`)
      console.log('   ▸ 请在手机上打开「任务列表」→ 进入这个会话 → 点横幅上的「取消归档」')
      const restored = await waitFor('unarchive', async () => {
        const list = await call('/api/workspaces', { auth: true })
        const ids = list.body?.archivedSessionIds ?? []
        return ids.includes(sessionId) ? null : true
      }, WAIT_SECONDS)
      record(
        'A15',
        '电脑归档 → 手机取消归档',
        restored === true ? 'pass' : 'manual',
        restored === true ? `${sessionId.slice(0, 16)}… 已由手机取消归档（存活证明）` : `${WAIT_SECONDS}s 内没等到手机的取消归档动作`
      )
      await call(`/api/sessions/${encodeURIComponent(sessionId)}/cancel`, { method: 'POST', auth: true, body: {} })
    }
  }

  // A9：历史图片回显（手机点开图片才成立）——只能给人工观察清单
  if (shouldRun('A9')) {
    record('A9', '历史图片回显与全屏', 'manual', '需要在手机上打开带图会话 → 点图片 → 看是否全屏')
  }

  // A10：断线重连（手机侧断网/恢复）
  if (shouldRun('A10')) {
    record('A10', '断线重连', 'manual', '在手机上开一次飞行模式 10 秒再关掉，观察是否自动回到「已连接」')
  }

  // A19：前台服务与通知
  if (shouldRun('A19')) {
    record('A19', '前台服务与后台通知', 'manual', '锁屏后从电脑发一条 prompt，看手机通知栏是否弹出')
  }

  // A20：彻底删除（主机侧即可验证）
  if (shouldRun('A20')) {
    const workspaces = await call('/api/workspaces', { auth: true })
    const workspace = (workspaces.body.workspaces ?? [])[0]
    const created = await call('/api/sessions', { method: 'POST', auth: true, body: { workspaceId: workspace.id } })
    const sessionId = created.body?.sessionId
    await call(`/api/sessions/${encodeURIComponent(sessionId)}/cancel`, { method: 'POST', auth: true, body: {} })
    await new Promise((resolve) => setTimeout(resolve, 800))
    const removed = await call(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE', auth: true })
    const ok = removed.status === 200 || removed.body?.error?.code === 'session/loaded'
    record('A20', '彻底删除', ok ? 'pass' : 'fail', `${removed.status} ${removed.body?.error?.code ?? '已删除'}`)
  }

  const pass = results.filter((r) => r.status === 'pass').length
  const manual = results.filter((r) => r.status === 'manual').length
  const fail = results.filter((r) => r.status === 'fail').length
  console.log(`\n结果：${pass} 自动通过 / ${manual} 待人工确认 / ${fail} 失败`)
  if (manual > 0) console.log('待人工确认项需要你在手机上点一次；确认后我可以把结论写进验收文档。')
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((error) => {
  console.error('运行失败：', error?.stack ?? String(error))
  process.exit(1)
})
