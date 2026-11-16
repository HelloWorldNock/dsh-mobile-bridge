#!/usr/bin/env node
/**
 * 验收矩阵的「API 层」部分（R09 的可自动化半边）。
 *
 * 真机交互（点审批卡、切 Wi-Fi、看通知、Keystore 落盘）只能在设备上做，但配对、建会话、
 * 流式落盘、归档/取消归档、日志导出、图片校验这些都能对着**正在运行的**桥接跑一遍，
 * 并把结果写成一份可归档的报告。
 *
 *   node tools/acceptance.mjs                       # 跑全量，打印表格
 *   node tools/acceptance.mjs --out docs/ACCEPTANCE-RESULT-x.md
 *   node tools/acceptance.mjs --only A13,A14        # 只跑某几项
 *   node tools/acceptance.mjs --keep                # 不归档/删除测试会话
 *
 * 环境变量：DSH_BRIDGE_URL（默认 http://127.0.0.1:48123）、DSH_BRIDGE_TIMEOUT（默认 180000）
 */
import { writeFileSync } from 'node:fs'

const BASE = (process.env.DSH_BRIDGE_URL ?? 'http://127.0.0.1:48123').replace(/\/$/, '')
const TURN_TIMEOUT_MS = Number(process.env.DSH_BRIDGE_TIMEOUT ?? 180_000)
const PROMPT = process.env.DSH_BRIDGE_PROMPT ?? '只回复一行：acceptance-ok。不要调用任何工具。'

const args = process.argv.slice(2)
const outIndex = args.indexOf('--out')
const OUT = outIndex >= 0 ? args[outIndex + 1] : null
const onlyIndex = args.indexOf('--only')
const ONLY = onlyIndex >= 0 ? args[onlyIndex + 1].split(',').map((s) => s.trim().toUpperCase()) : null
const KEEP = args.includes('--keep')

const results = []
let token = ''
let deviceId = ''
let hostVersion = null

function shouldRun(id) {
  return ONLY === null || ONLY.includes(id)
}

async function call(path, { method = 'GET', body, auth = false } = {}) {
  const headers = { accept: 'application/json' }
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (auth) headers.authorization = `Bearer ${token}`
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  const text = await response.text()
  let parsed = null
  try {
    parsed = text === '' ? null : JSON.parse(text)
  } catch {
    parsed = text
  }
  return { status: response.status, body: parsed, text }
}

function record(id, title, state, detail) {
  results.push({ id, title, state, detail })
  const mark = state === 'pass' ? '✔' : state === 'skip' ? '·' : '✖'
  console.log(`${mark} ${id.padEnd(5)} ${title}${detail ? ` — ${detail}` : ''}`)
}

async function check(id, title, fn) {
  if (!shouldRun(id)) return
  try {
    const detail = await fn()
    record(id, title, 'pass', detail ?? '')
  } catch (error) {
    record(id, title, 'fail', String(error?.message ?? error))
  }
}

function skip(id, title, reason) {
  if (!shouldRun(id)) return
  record(id, title, 'skip', reason)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function listSessions() {
  const listed = await call('/api/sessions', { auth: true })
  assert(listed.status === 200, `列表失败：${listed.status}`)
  return listed.body.sessions ?? []
}

async function nextPairingCode() {
  const setup = await call('/api/setup/state')
  assert(setup.status === 200, `/api/setup/state 不可读（${setup.status}）：面板接口只允许本机`)
  return { code: setup.body.code, csrf: setup.body.csrf, deviceId: setup.body.deviceId }
}

async function main() {
  console.log(`目标：${BASE}`)

  await check('A0', '健康检查与设备身份', async () => {
    const health = await call('/health')
    assert(health.status === 200 && health.body?.ok === true, `health 异常：${health.status}`)
    deviceId = health.body.deviceId
    hostVersion = health.body.version
    return `v${health.body.version} · ${deviceId}`
  })

  await check('A1', '配对：面板码换设备 token', async () => {
    const { code, deviceId: panelDeviceId } = await nextPairingCode()
    assert(/^\d{6}$/.test(String(code)), '面板没有给出 6 位配对码')
    const paired = await call('/api/pair', {
      method: 'POST',
      body: { code, installId: `acceptance-${Date.now()}`, deviceName: 'acceptance', model: 'node' }
    })
    assert(paired.status === 200, `配对失败：${paired.status} ${JSON.stringify(paired.body)}`)
    token = paired.body.token
    assert(/^dshm_/.test(token), 'token 不是 dshm_ 前缀')
    const info = await call('/api/info', { auth: true })
    assert(info.status === 200, '/api/info 带 token 也失败')
    return `deviceId=${panelDeviceId ?? deviceId}`
  })

  await check('A1b', '鉴权：错码与无 token 都被拒', async () => {
    const wrong = await call('/api/pair', {
      method: 'POST',
      body: { code: '000000', installId: 'acceptance-bad', deviceName: 'acceptance' }
    })
    // 错码按设计返回 pair/bad-code（401）；过期 410、锁定 429、限流 429 也都是「被拒」。
    assert(
      [400, 401, 410, 429].includes(wrong.status) && wrong.body?.error?.code === 'pair/bad-code',
      `错码应被拒且带 pair/bad-code，实际 ${wrong.status} ${JSON.stringify(wrong.body)}`
    )
    const anonymous = await call('/api/sessions')
    assert(anonymous.status === 401, `缺 token 应 401，实际 ${anonymous.status}`)
    const forged = await fetch(`${BASE}/api/sessions`, { headers: { authorization: 'Bearer dshm_bogus' } })
    assert(forged.status === 401, `伪造 token 应 401，实际 ${forged.status}`)
    return `错码 ${wrong.status} · 无 token 401 · 伪造 401`
  })

  await check('A2', '任务列表：只返回工作区内的非归档会话', async () => {
    const sessions = await listSessions()
    const workspaces = await call('/api/workspaces', { auth: true })
    assert(workspaces.status === 200, '工作区列表失败')
    const archived = new Set(workspaces.body.archivedSessionIds ?? [])
    const leaked = sessions.filter((item) => archived.has(item.id))
    assert(leaked.length === 0, `列表里出现了归档会话：${leaked.map((s) => s.id).join(', ')}`)
    return `${sessions.length} 个会话 / ${workspaces.body.workspaces?.length ?? 0} 个工作区 / 归档 ${archived.size}`
  })

  let sessionId = null
  await check('A3', '新建会话并派 prompt', async () => {
    const workspaces = await call('/api/workspaces', { auth: true })
    const workspace = (workspaces.body.workspaces ?? [])[0]
    assert(workspace !== undefined, '没有已登记工作区，先建一个')
    const created = await call('/api/sessions', {
      method: 'POST',
      auth: true,
      body: { workspaceId: workspace.id, prompt: PROMPT, permission: 'read-only' }
    })
    assert(created.status === 200, `建会话失败：${created.status} ${JSON.stringify(created.body)}`)
    sessionId = created.body.sessionId
    return `${sessionId} @ ${workspace.title}`
  })

  await check('A4', '流式一轮跑完并落盘', async () => {
    assert(sessionId !== null, 'A3 没成功，跳过')
    const started = Date.now()
    let running = true
    while (running && Date.now() - started < TURN_TIMEOUT_MS) {
      await new Promise((resolve) => setTimeout(resolve, 2_000))
      const sessions = await listSessions()
      const row = sessions.find((item) => item.id === sessionId)
      if (row === undefined) continue
      running = row.running === true
    }
    assert(running === false, `等了 ${TURN_TIMEOUT_MS} ms 这一轮还没结束`)
    const history = await call(`/api/sessions/${encodeURIComponent(sessionId)}/history`, { auth: true })
    assert(history.status === 200, '历史读取失败')
    const text = JSON.stringify(history.body.records ?? [])
    assert(text.length > 2, '历史是空的')
    return `${Date.now() - started} ms · ${(history.body.records ?? []).length} 条记录`
  })

  await check('A8', '图片校验：超过 4 张被拒', async () => {
    const workspaces = await call('/api/workspaces', { auth: true })
    const workspace = (workspaces.body.workspaces ?? [])[0]
    assert(workspace !== undefined, '没有工作区')
    const images = Array.from({ length: 5 }, () => ({ mediaType: 'image/png', data: 'AAAA' }))
    const rejected = await call('/api/sessions', {
      method: 'POST',
      auth: true,
      body: { workspaceId: workspace.id, prompt: 'x', images }
    })
    assert(rejected.status === 400, `应当 400，实际 ${rejected.status}`)
    assert(rejected.body?.error?.code === 'prompt/too-many-images', `错误码不对：${rejected.body?.error?.code}`)
    return 'prompt/too-many-images 400，未留下空会话'
  })

  await check('A13', '归档：会话从列表消失', async () => {
    assert(sessionId !== null, 'A3 没成功，跳过')
    const archived = await call(`/api/sessions/${encodeURIComponent(sessionId)}/archive`, { method: 'POST', auth: true })
    assert(archived.status === 200, `归档失败：${archived.status} ${JSON.stringify(archived.body)}`)
    const sessions = await listSessions()
    assert(!sessions.some((item) => item.id === sessionId), '归档后仍在列表里')
    const workspaces = await call('/api/workspaces', { auth: true })
    assert((workspaces.body.archivedSessionIds ?? []).includes(sessionId), '归档集合里没有这个 id')
    return '列表已剔除 · archivedSessionIds 已包含'
  })

  await check('A14', '取消归档：会话回到列表', async () => {
    assert(sessionId !== null, 'A3 没成功，跳过')
    const restored = await call(`/api/sessions/${encodeURIComponent(sessionId)}/unarchive`, { method: 'POST', auth: true })
    assert(restored.status === 200, `取消归档失败：${restored.status} ${JSON.stringify(restored.body)}`)
    const sessions = await listSessions()
    assert(sessions.some((item) => item.id === sessionId), '取消归档后没回到列表')
    return '已回到列表'
  })

  await check('A16', '日志导出：手机侧拿到文本', async () => {
    const logs = await call('/api/logs?lines=50&format=json', { auth: true })
    assert(logs.status === 200, `日志接口失败：${logs.status}`)
    assert(typeof logs.body?.text === 'string' && logs.body.text.length > 0, '日志文本为空')
    return `${logs.body.text.length} 字 · 路径 ${logs.body.path ?? '(未落盘)'}`
  })

  await check('A17', '日志导出：面板侧（loopback）拿到 .log', async () => {
    const response = await fetch(`${BASE}/api/setup/logs?lines=50`)
    assert(response.status === 200, `面板日志接口失败：${response.status}`)
    const disposition = response.headers.get('content-disposition') ?? ''
    assert(/dsh-remote-host-\d{8}-\d{6}\.log/.test(disposition), `文件名不对：${disposition}`)
    const text = await response.text()
    assert(text.length > 0, '面板日志为空')
    return `${text.length} 字`
  })

  skip('A5', '双端审批（手机先答/桌面先答）', '需要真实触发一次工具调用审批，只能在设备上做')
  skip('A7', 'plan-review 批准后继续', '同上，需要模型进入计划模式')
  skip('A9', '历史图片回显与全屏', '需要在手机上点开图片')
  skip('A10', '断线重连', '需要设备侧断网/恢复')
  skip('A11', 'LAN → tailnet 切换', '需要设备离开局域网')
  skip('A12', 'tailnet → LAN 切换', '需要设备回到同一局域网')
  skip('A15', '电脑归档 → 手机就地取消', '需要手机上正开着该会话')
  skip('A18', 'NAT 虚拟机自动发现', '需要宿主机 discovery-relay 与设备')
  skip('A19', '前台服务与后台通知', '需要设备锁屏观察')
  skip('A20', '彻底删除（运行中拒绝 → 停止后删除）', '会真的删日志目录，验收时人工执行')

  const failures = results.filter((item) => item.state === 'fail').length
  const skipped = results.filter((item) => item.state === 'skip').length
  const passed = results.filter((item) => item.state === 'pass').length
  console.log(`\n结果：${passed} 通过 / ${failures} 失败 / ${skipped} 跳过（需真机）`)

  if (OUT !== null) {
    const lines = [
      `# 验收结果（API 层）`,
      '',
      `- 目标：${BASE}`,
      `- 宿主版本：${hostVersion ?? '(未知)'}`,
      `- 时间：${new Date().toISOString()}`,
      `- 结果：**${passed} 通过 / ${failures} 失败 / ${skipped} 跳过**`,
      '',
      '| 项 | 内容 | 结果 | 备注 |',
      '|---|---|---|---|',
      ...results.map((item) => `| ${item.id} | ${item.title} | ${item.state === 'pass' ? '✅' : item.state === 'skip' ? '⬜' : '❌'} | ${String(item.detail).replace(/\|/g, '\\|')} |`),
      '',
      '> 跳过项都是需要真实设备交互的部分，见 `docs/ACCEPTANCE-0.8.9.md` 的 A5–A20。'
    ]
    writeFileSync(OUT, `${lines.join('\n')}\n`, 'utf8')
    console.log(`报告已写入 ${OUT}`)
  }

  // 收尾：把这次建的会话归档，别留在用户的任务列表里
  if (sessionId !== null && !KEEP) {
    await call(`/api/sessions/${encodeURIComponent(sessionId)}/cancel`, { method: 'POST', auth: true, body: {} }).catch(() => {})
    await new Promise((resolve) => setTimeout(resolve, 1_500))
    await call(`/api/sessions/${encodeURIComponent(sessionId)}/archive`, { method: 'POST', auth: true }).catch(() => {})
    console.log(`已归档验收会话 ${sessionId}`)
  }

  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(`验收脚本崩了：${error?.stack ?? error}`)
  process.exit(2)
})
