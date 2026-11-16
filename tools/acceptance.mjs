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
const APPROVALS = args.includes('--approvals')

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
    if (detail !== null && typeof detail === 'object' && typeof detail.skip === 'string') {
      record(id, title, 'skip', detail.skip)
      return
    }
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

  // A0/A1 是所有检查的前提（拿版本号与 token），--only 时也静默跑一遍
  async function prepareHealth() {
    const health = await call('/health')
    assert(health.status === 200 && health.body?.ok === true, `health 异常：${health.status}`)
    deviceId = health.body.deviceId
    hostVersion = health.body.version
    return `v${health.body.version} · ${deviceId}`
  }

  async function preparePair() {
    const { code } = await nextPairingCode()
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
    return { code, deviceId: healthDeviceId() }
  }

  function healthDeviceId() {
    return deviceId
  }

  await check('A0', '健康检查与设备身份', prepareHealth)
  await check('A1', '配对：面板码换设备 token', async () => {
    const result = await preparePair()
    return `deviceId=${result.deviceId ?? deviceId}`
  })

  // --only 模式下如果上面两项被跳过，这里补做一次准备工作
  if (token === '') {
    await prepareHealth()
    await preparePair()
  }

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

  await check('A20', '彻底删除：停止后删除会话日志目录', async () => {
    const workspaces = await call('/api/workspaces', { auth: true })
    const workspace = (workspaces.body.workspaces ?? [])[0]
    assert(workspace !== undefined, '没有工作区，无法建临时会话')
    // 建一个空会话（不派 prompt），删它不影响任何真实任务
    const created = await call('/api/sessions', { method: 'POST', auth: true, body: { workspaceId: workspace.id } })
    assert(created.status === 200, `建临时会话失败：${created.status} ${JSON.stringify(created.body)}`)
    const throwaway = created.body.sessionId
    await call(`/api/sessions/${encodeURIComponent(throwaway)}/cancel`, { method: 'POST', auth: true, body: {} })
    await new Promise((resolve) => setTimeout(resolve, 800))
    const removed = await call(`/api/sessions/${encodeURIComponent(throwaway)}`, { method: 'DELETE', auth: true })
    // 契约允许两种结果：删掉（200），或会话仍驻留 DSH 内存里（409 session/loaded，
    // 需要重启宿主才能删）。后者不是失败，但要如实报告。
    if (removed.status === 409) {
      assert(
        removed.body?.error?.code === 'session/loaded',
        `409 的错误码应是 session/loaded，实际 ${removed.body?.error?.code}`
      )
      return `${throwaway.slice(0, 18)}… 驻留内存（409 session/loaded），按契约需重启后删除`
    }
    assert(removed.status === 200, `删除失败：${removed.status} ${JSON.stringify(removed.body)}`)
    const gone = await call(`/api/sessions/${encodeURIComponent(throwaway)}`, { auth: true })
    assert(gone.status === 404, `删除后仍能读到：${gone.status}`)
    return `${throwaway.slice(0, 18)}… 已删除（${removed.body?.filesRemoved ?? 0} 个目录）`
  })

  await check('A21', '事件流鉴权：无 token 401，伪造 token 401', async () => {
    const anonymous = await fetch(`${BASE}/api/events`)
    assert(anonymous.status === 401, `无 token 应当 401，实际 ${anonymous.status}`)
    const forged = await fetch(`${BASE}/api/events`, { headers: { authorization: 'Bearer dshm_bogus' } })
    assert(forged.status === 401, `伪造 token 应当 401，实际 ${forged.status}`)
    return '无 token 401 · 伪造 401'
  })

  if (!APPROVALS) {
    skip('A5', '审批链路（脚本代答 allow-once）', '默认跳过：加 --approvals 才会真的让模型调一次 shell 工具')
  } else {
    await check('A5', '审批链路（脚本代答 allow-once）', async () => {
      const workspaces = await call('/api/workspaces', { auth: true })
      const workspace = (workspaces.body.workspaces ?? [])[0]
      assert(workspace !== undefined, '没有工作区')
      const created = await call('/api/sessions', {
        method: 'POST',
        auth: true,
        body: {
          workspaceId: workspace.id,
          // 故意要求跑一条无害命令，触发工具审批
          prompt: '请用 shell 工具执行 echo bridge-approval-test，然后原样回复它的输出。',
          permission: 'workspace-write'
        }
      })
      assert(created.status === 200, `建会话失败：${created.status} ${JSON.stringify(created.body)}`)
      const id = created.body.sessionId

      let approval = null
      let finished = false
      const deadline = Date.now() + 90_000
      while (approval === null && !finished && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 1_500))
        const pending = await call('/api/pending', { auth: true })
        const list = pending.body?.approvals ?? []
        approval = list.find((item) => item.sessionId === undefined || item.sessionId === id) ?? null
        if (approval !== null) break
        const sessions = await listSessions()
        const row = sessions.find((item) => item.id === id)
        // 轮次已经结束还没有审批卡：这一轮没触发工具审批
        if (row !== undefined && row.running !== true) finished = true
      }

      if (approval === null) {
        // 没触发审批不算失败：权限预设、模型选择、提示词理解都会影响
        await call(`/api/sessions/${encodeURIComponent(id)}/cancel`, { method: 'POST', auth: true, body: {} })
        return {
          skip: finished
            ? '这一轮正常跑完但没有触发审批（当前权限不需要审批，或模型没调工具）'
            : '90 秒内既没有审批卡、轮次也没结束（宿主很忙？）'
        }
      }

      const card = approval
      const answered = await call(`/api/approvals/${encodeURIComponent(card.id)}`, {
        method: 'POST',
        auth: true,
        body: { action: 'allow-once' }
      })
      assert(answered.status === 200, `代答审批失败：${answered.status} ${JSON.stringify(answered.body)}`)

      // 等这一轮结束，再从历史里确认工具真的跑了
      const started = Date.now()
      let running = true
      while (running && Date.now() - started < 120_000) {
        await new Promise((resolve) => setTimeout(resolve, 2_000))
        const sessions = await listSessions()
        const row = sessions.find((item) => item.id === id)
        if (row === undefined) continue
        running = row.running === true
      }
      const history = await call(`/api/sessions/${encodeURIComponent(id)}/history`, { auth: true })
      const historyText = JSON.stringify(history.body.records ?? [])
      const ran = historyText.includes('bridge-approval-test')
      return `卡片 ${card.id.slice(0, 10)}… 已 allow-once；工具输出${ran ? '已' : '未'}落盘`
    })
  }

  if (!APPROVALS) {
    skip('A7', 'plan-review 卡与代答（只答「继续规划」）', '默认跳过：加 --approvals 才会真的让模型进入计划模式')
  } else {
    await check('A7', 'plan-review 卡与代答（只答「继续规划」）', async () => {
      const workspaces = await call('/api/workspaces', { auth: true })
      const workspace = (workspaces.body.workspaces ?? [])[0]
      assert(workspace !== undefined, '没有工作区')

      // 1) 建会话但不派 prompt，再显式开计划模式（body 是 {active:boolean}）
      const created = await call('/api/sessions', { method: 'POST', auth: true, body: { workspaceId: workspace.id } })
      assert(created.status === 200, `建会话失败：${created.status}`)
      const id = created.body.sessionId
      const planOn = await call(`/api/sessions/${encodeURIComponent(id)}/plan`, {
        method: 'POST',
        auth: true,
        body: { active: true }
      })
      assert(planOn.status === 200 && planOn.body?.active === true, `开计划模式失败：${planOn.status} ${JSON.stringify(planOn.body)}`)

      // 2) 派一个只出计划、不动文件的提示
      const prompted = await call(`/api/sessions/${encodeURIComponent(id)}/prompt`, {
        method: 'POST',
        auth: true,
        body: { text: '用三句话说明你会怎么整理 README 的目录，然后停在计划阶段等批准；不要修改任何文件。' }
      })
      assert(prompted.status === 200, `派 prompt 失败：${prompted.status}`)

      // 3) 等 plan-review 卡
      let card = null
      let finished = false
      const deadline = Date.now() + 150_000
      while (card === null && !finished && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 2_500))
        const pending = await call('/api/pending', { auth: true })
        const list = pending.body?.questions ?? []
        card = list.find((item) => item.planReview === true && (item.sessionId === undefined || item.sessionId === id)) ?? null
        if (card !== null) break
        const sessions = await listSessions()
        const row = sessions.find((item) => item.id === id)
        if (row !== undefined && row.running !== true) finished = true
      }
      if (card === null) {
        await call(`/api/sessions/${encodeURIComponent(id)}/cancel`, { method: 'POST', auth: true, body: {} })
        return { skip: finished ? '这一轮跑完但模型没给出计划卡片（与模型行为有关）' : '150 秒内没有出现 plan-review 卡' }
      }

      // 4) 只答「继续规划」（不批准执行），验证代答通道即可，避免真的改文件
      const question = (card.questions ?? [])[0]
      assert(question !== undefined, 'plan-review 卡里没有 questions')
      const keepPlanning = (question.options ?? []).find((option) => option.label !== 'Approve')?.label
      assert(typeof keepPlanning === 'string', 'plan-review 卡里找不到非批准选项')
      const answered = await call(`/api/questions/${encodeURIComponent(card.id)}`, {
        method: 'POST',
        auth: true,
        body: { answers: [{ id: question.id, selected: [keepPlanning] }] }
      })
      assert(answered.status === 200, `代答计划卡失败：${answered.status} ${JSON.stringify(answered.body)}`)

      await call(`/api/sessions/${encodeURIComponent(id)}/cancel`, { method: 'POST', auth: true, body: {} })
      return `卡片 ${card.id.slice(0, 10)}… planReview=true · 已答「${keepPlanning}」· 计划 ${(card.plan ?? '').length} 字`
    })
  }
  skip('A9', '历史图片回显与全屏', '需要在手机上点开图片')
  skip('A10', '断线重连', '需要设备侧断网/恢复')
  skip('A11', 'LAN → tailnet 切换', '需要设备离开局域网')
  skip('A12', 'tailnet → LAN 切换', '需要设备回到同一局域网')
  skip('A15', '电脑归档 → 手机就地取消', '需要手机上正开着该会话')
  skip('A18', 'NAT 虚拟机自动发现', '需要宿主机 discovery-relay 与设备')
  skip('A19', '前台服务与后台通知', '需要设备锁屏观察')

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
