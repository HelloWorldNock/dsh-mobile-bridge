import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createCollab } from '../lib/collab.js'
import { createCollabTool } from '../lib/tool.js'

const PEER = { deviceId: 'HOSTB', name: 'B 渲染机', baseUrl: 'http://10.0.0.2:48123', status: 'online' }

function harness(fetchImpl, { withGroup = true } = {}) {
  const group = {
    group: withGroup ? { id: 'grp_1', name: 'g', secret: 'dshg_secret' } : null,
    snapshot: () => ({ group: withGroup ? { id: 'grp_1' } : null, peers: withGroup ? [PEER] : [], invite: null }),
    peerOf: (reference) => (reference === 'HOSTB' || reference === 'B 渲染机' || reference === 'B' ? PEER : null)
  }
  const logs = []
  const collab = createCollab({
    group,
    logger: { info: (text) => logs.push(text), warn: (text) => logs.push(text) },
    fetchImpl,
    now: () => Date.now()
  })
  return { collab, logs }
}

test('delegates a task to a peer and collects the reply plus artifacts', async () => {
  const calls = []
  let polls = 0
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    assert.equal(init.headers.authorization, 'Bearer dshg_secret')
    if (url === 'http://10.0.0.2:48123/api/sessions') {
      assert.equal(init.method, 'POST')
      assert.deepEqual(JSON.parse(init.body), {
        prompt: '画一张机器人概念图',
        workspaceId: 'w7',
        permission: 'workspace-write'
      })
      return { ok: true, status: 200, json: async () => ({ sessionId: 'sess-1', warnings: [] }) }
    }
    if (url.startsWith('http://10.0.0.2:48123/api/sessions/sess-1')) {
      polls += 1
      return {
        ok: true,
        status: 200,
        json: async () => ({
          session: { id: 'sess-1', running: polls < 2, title: '机器人概念图' },
          records: [
            { seq: 1, type: 'user', text: '画一张机器人概念图' },
            { seq: 2, type: 'assistant', text: polls < 2 ? '正在生成…' : '已生成 design/robot.png' }
          ]
        })
      }
    }
    if (url.startsWith('http://10.0.0.2:48123/api/collab/files')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ files: [{ rel: 'design/robot.png', name: 'robot.png', size: 2048, mtime: Date.now() }] })
      }
    }
    if (url === 'http://10.0.0.2:48123/api/workspaces') {
      // 对端把这个目录登记成了工作区：派工时应该用 workspaceId 而不是裸 cwd
      return { ok: true, status: 200, json: async () => ({ workspaces: [{ id: 'w7', path: resolve('/work/design'), title: 'design' }] }) }
    }
    throw new Error(`unexpected ${url}`)
  }

  const { collab } = harness(fetchImpl)
  const result = await collab.delegate({ peer: 'B 渲染机', workspace: '/work/design', prompt: '画一张机器人概念图', pollMs: 100 })
  assert.equal(result.status, 'done')
  assert.equal(result.sessionId, 'sess-1')
  assert.equal(result.peer, 'B 渲染机')
  assert.equal(result.reply, '已生成 design/robot.png')
  assert.equal(result.files.length, 1)
  assert.equal(result.files[0].rel, 'design/robot.png')
  assert.equal(result.workspace, resolve('/work/design'))
  assert.equal(result.workspaceId, 'w7')
  assert.equal(result.resumed, false)
  assert.equal(polls, 2)
  assert.ok(calls.some((call) => call.url.includes(`/api/collab/files?cwd=${encodeURIComponent(resolve('/work/design'))}`)))
})

test('resumes an existing peer session instead of creating a new one', async () => {
  const bodies = []
  const fetchImpl = async (url, init) => {
    if (url === 'http://10.0.0.2:48123/api/sessions') {
      bodies.push(JSON.parse(init.body))
      return { ok: true, status: 200, json: async () => ({ sessionId: 'sess-old', resumed: true }) }
    }
    if (url.includes('/api/sessions/sess-old')) {
      return { ok: true, status: 200, json: async () => ({ session: { running: false }, records: [{ type: 'assistant', text: '接着做完了' }] }) }
    }
    return { ok: true, status: 200, json: async () => ({ files: [] }) }
  }
  const { collab } = harness(fetchImpl)
  const result = await collab.delegate({
    peer: 'HOSTB',
    workspace: '/work/design',
    sessionId: 'sess-old',
    prompt: '继续',
    waitMs: 2_000,
    pollMs: 100
  })
  assert.deepEqual(bodies[0], { prompt: '继续', sessionId: 'sess-old', permission: 'workspace-write' })
  assert.equal(result.sessionId, 'sess-old')
  assert.equal(result.resumed, true)
  assert.equal(result.status, 'done')
  assert.equal(result.reply, '接着做完了')
})

test('falls back to a bare cwd when the peer has no workspace registry', async () => {
  const bodies = []
  const fetchImpl = async (url, init) => {
    if (url === 'http://10.0.0.2:48123/api/workspaces') {
      return { ok: false, status: 404, json: async () => ({ error: { code: 'not/found', message: '老版本' } }) }
    }
    if (url === 'http://10.0.0.2:48123/api/sessions') {
      bodies.push(JSON.parse(init.body))
      return { ok: true, status: 200, json: async () => ({ sessionId: 'sess-cwd' }) }
    }
    if (url.includes('/api/sessions/sess-cwd')) {
      return { ok: true, status: 200, json: async () => ({ session: { running: false }, records: [] }) }
    }
    return { ok: true, status: 200, json: async () => ({ files: [] }) }
  }
  const { collab } = harness(fetchImpl)
  const result = await collab.delegate({ peer: 'HOSTB', workspace: '/work/design', prompt: 'x', waitMs: 2_000, pollMs: 100 })
  assert.deepEqual(bodies[0], { prompt: 'x', cwd: resolve('/work/design'), permission: 'workspace-write' })
  assert.equal(result.workspaceId, null)
  assert.equal(result.status, 'done')
})

test('reports a timeout while the peer session is still running', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('/api/sessions') && !url.includes('sess-9')) {
      return { ok: true, status: 200, json: async () => ({ sessionId: 'sess-9' }) }
    }
    if (url.includes('/api/sessions/sess-9')) {
      return { ok: true, status: 200, json: async () => ({ session: { running: true }, records: [] }) }
    }
    return { ok: true, status: 200, json: async () => ({ files: [] }) }
  }
  const { collab } = harness(fetchImpl)
  const result = await collab.delegate({ peer: 'HOSTB', workspace: '/work/out', prompt: '跑一遍渲染', waitMs: 1_000, pollMs: 100 })
  assert.equal(result.status, 'timeout')
  assert.equal(result.running, true)
  assert.deepEqual(result.files, [])
})

test('surfaces peer errors and rejects unknown peers or missing prompts', async () => {
  const fetchImpl = async () => ({ ok: false, status: 409, json: async () => ({ error: { code: 'session/not-live', message: '会话没有可交互的 Agent' } }) })
  const { collab } = harness(fetchImpl)
  await assert.rejects(
    () => collab.delegate({ peer: 'HOSTB', workspace: '/work/a', prompt: 'x' }),
    (error) => error.code === 'collab/peer-error' && /Agent/.test(error.message)
  )
  await assert.rejects(
    () => collab.delegate({ peer: '没有这台', workspace: '/work/a', prompt: 'x' }),
    (error) => error.code === 'collab/unknown-peer'
  )
  await assert.rejects(
    () => collab.delegate({ peer: 'HOSTB', workspace: '/work/a', prompt: '   ' }),
    (error) => error.code === 'collab/bad-request'
  )
  await assert.rejects(
    () => collab.delegate({ peer: 'HOSTB', workspace: 'relative/path', prompt: 'x' }),
    (error) => error.code === 'collab/bad-request'
  )
})

test('refuses to call out without a group secret', async () => {
  const { collab } = harness(async () => ({ ok: true, status: 200, json: async () => ({}) }), { withGroup: false })
  await assert.rejects(
    () => collab.files({ peer: 'HOSTB', workspace: '/work/a' }),
    (error) => error.code === 'collab/no-group'
  )
  await assert.rejects(
    () => collab.delegate({ peer: 'HOSTB', workspace: '/work/a', prompt: 'x' }),
    (error) => error.code === 'collab/no-group'
  )
})

test('downloads an artifact into an absolute local path', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'collab-'))
  try {
    const payload = Buffer.from('fake-png-bytes')
    const fetchImpl = async (url, init) => {
      assert.equal(init.method, 'GET')
      assert.ok(url.includes(`/api/collab/file?cwd=${encodeURIComponent(resolve('/work/design'))}&path=design%2Frobot.png`))
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength)
      }
    }
    const { collab } = harness(fetchImpl)
    const saveAs = join(dir, 'robot.png')
    const result = await collab.fetchArtifact({ peer: 'HOSTB', workspace: '/work/design', path: 'design/robot.png', saveAs })
    assert.equal(result.bytes, payload.byteLength)
    assert.equal(result.saveAs, saveAs)
    assert.equal((await readFile(saveAs)).toString(), 'fake-png-bytes')
    await assert.rejects(
      () => collab.fetchArtifact({ peer: 'HOSTB', workspace: '/work/design', path: 'a.png', saveAs: 'relative.png' }),
      (error) => error.code === 'collab/bad-request'
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('registers a collab tool that renders peers and delegate results', async () => {
  const fetchImpl = async (url) => {
    if (url === 'http://10.0.0.2:48123/api/sessions') {
      return { ok: true, status: 200, json: async () => ({ sessionId: 'sess-2' }) }
    }
    if (url.includes('/api/sessions/sess-2')) {
      return { ok: true, status: 200, json: async () => ({ session: { running: false }, records: [{ type: 'assistant', text: '完成' }] }) }
    }
    return { ok: true, status: 200, json: async () => ({ files: [{ rel: 'a.png', size: 1024 }] }) }
  }
  const { collab } = harness(fetchImpl)
  const tool = createCollabTool({ collab })

  assert.equal(tool.name, 'collab')
  assert.deepEqual(tool.parameters.required, ['action'])

  const peers = await tool.execute({ action: 'peers' })
  assert.equal(tool.output.render({ action: 'peers' }, peers)[0].text.includes('B 渲染机'), true)

  const delegated = await tool.execute({ action: 'delegate', peer: 'HOSTB', workspace: '/work/x', prompt: '画画', waitSeconds: 5 })
  const text = tool.output.render({ action: 'delegate' }, delegated)[0].text
  assert.equal(text.includes('完成'), true)
  assert.equal(text.includes('a.png'), true)

  await assert.rejects(() => tool.execute({ action: 'fetch' }), (error) => error.code === 'collab/unknown-peer')
})

test('falls back to the peer collab root when workspace is omitted', async () => {
  const peer = { ...PEER, collabRoot: 'D:\\collab' }
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    if (url.startsWith('http://10.0.0.2:48123/api/collab/files')) {
      return { ok: true, status: 200, json: async () => ({ files: [] }) }
    }
    throw new Error(`unexpected ${url}`)
  }
  const group = {
    group: { id: 'grp_1', name: 'g', secret: 'dshg_secret' },
    snapshot: () => ({ group: { id: 'grp_1' }, peers: [peer], invite: null }),
    peerOf: () => peer,
    refresh: async () => {}
  }
  const collab = createCollab({ group, logger: { info: () => {}, warn: () => {} }, fetchImpl, now: () => Date.now() })
  const result = await collab.files({ peer: 'HOSTB', since: 0 })
  assert.equal(result.workspace, 'D:\\collab')
  assert.match(calls[0].url, /cwd=D%3A%5Ccollab/)
})

test('refuses to delegate when no workspace is known', async () => {
  const peer = { ...PEER, collabRoot: null }
  const group = {
    group: { id: 'grp_1', name: 'g', secret: 'dshg_secret' },
    snapshot: () => ({ group: { id: 'grp_1' }, peers: [peer], invite: null }),
    peerOf: () => peer,
    refresh: async () => {}
  }
  const collab = createCollab({ group, logger: { info: () => {}, warn: () => {} }, fetchImpl: async () => { throw new Error('should not fetch') } })
  await assert.rejects(() => collab.delegate({ peer: 'HOSTB', prompt: 'draw' }), /协作工作区/)
})
