/**
 * 真实宿主集成用例（R13）。
 *
 * 这不是 mock：它对着**正在运行的** DSH 桥接发请求——读本机配对码、配对、建会话、
 * 派一次真实 prompt、等它跑完、再从历史里确认这一轮确实落盘了。用来证明
 * `sessionController.prompt` 这条契约在真实宿主上成立，而不是只在单元测试的桩上成立。
 *
 * 默认跳过（CI 与普通 `node --test` 不应去动用户的 DSH）。要跑：
 *
 *   cd host
 *   $env:DSH_BRIDGE_INTEGRATION = '1'
 *   node --test test/integration/
 *
 * 可选环境变量：
 *   DSH_BRIDGE_URL      默认 http://127.0.0.1:48123
 *   DSH_BRIDGE_PROMPT   默认「只回复一行：integration-ok。不要调用任何工具。」
 *   DSH_BRIDGE_TIMEOUT  等这一轮跑完的上限毫秒，默认 180000
 *
 * 副作用：会在第一个工作区里建一个会话，跑完后**归档**它（不删除，方便回看），
 * 并在控制台打出 sessionId。它不会改动其它会话。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

const ENABLED = process.env.DSH_BRIDGE_INTEGRATION === '1'
const BASE = (process.env.DSH_BRIDGE_URL ?? 'http://127.0.0.1:48123').replace(/\/$/, '')
const PROMPT = process.env.DSH_BRIDGE_PROMPT ?? '只回复一行：integration-ok。不要调用任何工具。'
const TIMEOUT_MS = Number(process.env.DSH_BRIDGE_TIMEOUT ?? 180_000)

const skip = ENABLED ? false : '设置 DSH_BRIDGE_INTEGRATION=1 才会对着真实宿主跑'

async function json(path, options = {}) {
  const response = await fetch(`${BASE}${path}`, options)
  const text = await response.text()
  let body = null
  try {
    body = text === '' ? null : JSON.parse(text)
  } catch {
    body = text
  }
  return { status: response.status, body }
}

function authed(token, extra = {}) {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...extra }
}

test('真实宿主：配对 → 建会话 → prompt → 历史落盘 → 归档', { skip, timeout: TIMEOUT_MS + 60_000 }, async (t) => {
  // 1) 本机面板接口读配对码（loopback only）
  const setup = await json('/api/setup/state')
  assert.equal(setup.status, 200, '本机面板接口必须可读（/api/setup/state 仅 loopback）')
  assert.match(String(setup.body.code), /^\d{6}$/, '面板应当给出 6 位配对码')
  assert.equal(typeof setup.body.deviceId, 'string')

  // 2) 用配对码换设备 token
  const paired = await json('/api/pair', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      code: setup.body.code,
      installId: `integration-${Date.now()}`,
      deviceName: 'integration-test',
      model: 'node'
    })
  })
  assert.equal(paired.status, 200, `配对应当成功：${JSON.stringify(paired.body)}`)
  const token = paired.body.token
  assert.match(token, /^dshm_/, '设备 token 形如 dshm_...')

  const info = await json('/api/info', { headers: authed(token) })
  assert.equal(info.status, 200)
  assert.equal(info.body.device.id, paired.body.deviceId ?? info.body.device.id)
  t.diagnostic(`bridge ${info.body.bridge.version} · ${info.body.bridge.hostName} · ${BASE}`)

  // 3) 选一个工作区
  const spaces = await json('/api/workspaces', { headers: authed(token) })
  assert.equal(spaces.status, 200)
  const workspace = (spaces.body.workspaces ?? [])[0]
  assert.ok(workspace !== undefined, '至少需要一个已登记工作区（先跑一次带 workspaceId 的创建）')
  t.diagnostic(`workspace ${workspace.title} ${workspace.path}`)

  // 4) 建会话 + 派 prompt（真实 sessionController.prompt）
  const started = Date.now()
  const created = await json('/api/sessions', {
    method: 'POST',
    headers: authed(token),
    body: JSON.stringify({ workspaceId: workspace.id, prompt: PROMPT, permission: 'read-only' })
  })
  assert.equal(created.status, 200, `建会话失败：${JSON.stringify(created.body)}`)
  const sessionId = created.body.sessionId
  assert.equal(typeof sessionId, 'string')
  t.diagnostic(`session ${sessionId}${created.body.warnings?.length ? ` (warnings: ${created.body.warnings.join('; ')})` : ''}`)

  try {
    // 5) 等这一轮结束：轮询列表里的 running 标记
    //    注意 `/api/sessions?q=` 只匹配标题与 cwd，不匹配 id，所以这里拉全表自己找。
    let running = true
    let waited = 0
    while (running && waited < TIMEOUT_MS) {
      await new Promise((resolve) => setTimeout(resolve, 2_000))
      waited = Date.now() - started
      const listed = await json('/api/sessions', { headers: authed(token) })
      assert.equal(listed.status, 200)
      const row = (listed.body.sessions ?? []).find((item) => item.id === sessionId)
      if (row === undefined) continue
      running = row.running === true
    }
    assert.equal(running, false, `等 ${TIMEOUT_MS} ms 后这一轮仍未结束`)
    t.diagnostic(`一轮耗时 ${Date.now() - started} ms`)

    // 6) 历史里必须能读到这一轮：至少有一条用户消息，通常还有助手回复
    const history = await json(`/api/sessions/${encodeURIComponent(sessionId)}/history`, { headers: authed(token) })
    assert.equal(history.status, 200)
    const records = history.body.records ?? []
    assert.ok(records.length > 0, '历史不能为空')
    const plain = JSON.stringify(records)
    assert.ok(plain.includes('integration-ok') || plain.includes('只回复'), '历史里要能读到这次 prompt 的痕迹')

    // 7) 会话详情可读，pending 结构完整（手机端依赖这两个接口）
    const detail = await json(`/api/sessions/${encodeURIComponent(sessionId)}`, { headers: authed(token) })
    assert.equal(detail.status, 200)
    assert.equal(detail.body.session.id, sessionId)
    assert.ok(Array.isArray(detail.body.records))
    assert.ok(Array.isArray(detail.body.pending.approvals) && Array.isArray(detail.body.pending.questions))
  } finally {
    // 8) 收尾：先停掉这一轮，再归档这个会话（不删除，方便事后回看）。
    await json(`/api/sessions/${encodeURIComponent(sessionId)}/cancel`, {
      method: 'POST',
      headers: authed(token),
      body: '{}'
    }).catch(() => undefined)

    let archived = { status: 0, body: null }
    for (let attempt = 0; attempt < 6; attempt += 1) {
      archived = await json(`/api/sessions/${encodeURIComponent(sessionId)}/archive`, {
        method: 'POST',
        headers: authed(token)
      })
      if (archived.status === 200) break
      // 运行中会 409，等它停稳再来。
      await new Promise((resolve) => setTimeout(resolve, 1_500))
    }
    t.diagnostic(`archive ${archived.status}${archived.status === 200 ? '' : ` ${JSON.stringify(archived.body)}`}`)
  }
})
