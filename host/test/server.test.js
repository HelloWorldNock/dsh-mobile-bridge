import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBridgeServer } from '../lib/server.js'
import { createApprovals } from '../lib/approvals.js'
import { createBroadcaster } from '../lib/events.js'
import { createAuth } from '../lib/auth.js'
import { createDefaultState } from '../lib/state.js'
import { createGroup } from '../lib/group.js'
import { createLogSink } from '../lib/logs.js'

async function boot(options = {}) {
  const state = createDefaultState()
  const auth = createAuth({ state, save: async () => undefined, settings: state.settings, logger: { warn() {} } })
  const broadcast = createBroadcaster({ logger: { warn() {} } })
  const prompts = []
  const created = []
  const planCalls = []
  const permissionCalls = []
  const subscribed = []
  const createdWorkspaces = []
  const session = {
    sessionId: 's1',
    updatedAt: 123,
    running: false,
    blank: false,
    agentAvailable: true,
    cwd: 'F:\\work',
    projections: {
      values: {
        title: { title: 'Bridge work' },
        plan: { active: false, pending: false },
        permissions: { currentValue: 'workspace-write' }
      }
    }
  }
  const orphan = {
    ...session,
    sessionId: 's0',
    agentAvailable: false,
    projections: { values: { title: { title: 'Orphan task' } } }
  }
  const controller = {
    list: async () => ({ items: [session, orphan] }),
    inspect: async () => ({
      events: options.events ?? [
        { type: 'user/message', seq: 1, data: { content: [{ type: 'text', text: 'hello' }] } },
        { type: 'assistant/message', seq: 2, data: { message: { content: [{ type: 'text', text: 'hi' }] } } }
      ]
    }),
    prompt: async (request) => {
      prompts.push(request)
      if (options.promptError !== undefined) throw options.promptError
      return { accepted: true }
    },
    cancel: async () => ({ accepted: true }),
    rename: async (request) => ({ title: request.title, seq: 3 }),
    create: async (request) => {
      created.push(request)
      return options.create ? options.create(request) : { sessionId: 's2' }
    },
    resolveAgent: async () => ({
      agent: {
        session: {
          id: 's1',
          append(type, data) {
            if (type === 'plan/mode') planCalls.push(data.active)
          }
        }
      }
    })
  }
  const planMode = {
    set(agent, active) {
      planCalls.push(active)
      return 'queued'
    },
    get() {
      return { active: true, pending: false }
    }
  }
  const permissionPresets = {
    catalog: () => ({ options: [{ value: 'read-only' }, { value: 'workspace-write' }, { value: 'danger-full-access' }], defaultPreset: 'danger-full-access' }),
    set(sessionValue, preset) {
      permissionCalls.push(preset)
    }
  }
  const archiveCalls = []
  const archived = [...(options.archivedSessionIds ?? [])]
  let archiveSyncs = 0
  const ctx = {
    on() {
      return () => undefined
    },
    get(name) {
      if (name === 'permissionPresets') return permissionPresets
      if (name === 'planMode') return planMode
      if (name === 'sessions') return { get: () => session }
      if (name === 'attachments') return options.attachments ?? undefined
      return undefined
    },
    sessionController: controller,
    workspaceRegistry: {
      list: () => options.workspaces ??
        [{ id: 'w1', path: 'F:\\work', title: 'work', updatedAt: 5, sessionIds: ['s1'] }],
      resolveByPath: (path) => (options.registered ?? []).find((workspace) => workspace.path === path),
      create: async (path, title) => {
        createdWorkspaces.push({ path, title })
        return { id: `w${createdWorkspaces.length + 1}`, path, title, updatedAt: 9, sessionIds: [] }
      },
      get archivedSessionIds() {
        return archived
      },
      archiveSession: async (sessionId) => {
        archiveCalls.push(`archive:${sessionId}`)
        if (options.archiveError !== undefined) throw options.archiveError
        if (!archived.includes(sessionId)) archived.push(sessionId)
      },
      unarchiveSession: async (sessionId) => {
        archiveCalls.push(`unarchive:${sessionId}`)
        const index = archived.indexOf(sessionId)
        if (index >= 0) archived.splice(index, 1)
      }
    }
  }
  const approvals = createApprovals({
    ctx,
    broadcast,
    settings: state.settings,
    logger: { warn() {} },
    titleFor: () => 'Bridge work'
  })
  const hub = {
    ensureFollow: async (id) => subscribed.push(id),
    subscribe: async (id) => subscribed.push(id),
    unsubscribe: () => undefined,
    cacheSummary: () => undefined,
    syncArchive: () => {
      archiveSyncs += 1
    }
  }
  const config = { port: 0, discoveryPort: 0, bindHost: '127.0.0.1' }
  const group = createGroup({
    state,
    save: async () => undefined,
    logger: { info() {}, warn() {} },
    port: () => config.port,
    heartbeatMs: 0
  })
  const server = createBridgeServer({
    config,
    state,
    auth,
    broadcast,
    hub,
    approvals,
    settings: state.settings,
    logger: { warn() {}, error() {} },
    version: '0.1.0-test',
    ctx,
    logs: options.logs ?? null,
    tailscale: options.tailscale ?? null,
    group: options.group === false ? null : group,
    updater: options.updater ?? null
  })
  const port = await server.listen()
  const base = `http://127.0.0.1:${port}`
  const token = auth.pair({ code: auth.currentCode().code, installId: 'i1', deviceName: 'Phone', ip: '127.0.0.1' }).token
  return {
    base,
    token,
    auth,
    state,
    group,
    prompts,
    created,
    planCalls,
    permissionCalls,
    subscribed,
    createdWorkspaces,
    archiveCalls,
    archived,
    archiveSyncs: () => archiveSyncs,
    close: async () => {
      await server.close()
      broadcast.dispose()
      approvals.dispose()
    }
  }
}

function authHeaders(token) {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
}

test('serves health and loopback setup API, no standalone control page', async () => {
  const app = await boot()
  try {
    const health = await fetch(`${app.base}/health`)
    assert.equal(health.status, 200)
    const healthBody = await health.json()
    assert.equal(healthBody.ok, true)

    const discovery = await fetch(`${app.base}/api/discovery`)
    assert.equal(discovery.status, 200)
    const advertised = await discovery.json()
    assert.equal(advertised.type, 'dsh-remote-bridge')
    assert.equal(advertised.deviceId, healthBody.deviceId)
    assert.ok(Array.isArray(advertised.endpoints))

    const page = await fetch(`${app.base}/`)
    assert.equal(page.status, 404)
    assert.equal((await page.json()).error.code, 'not-found')

    const setup = await fetch(`${app.base}/api/setup/state`, { headers: { origin: 'http://127.0.0.1:9166' } })
    assert.equal(setup.status, 200)
    assert.equal(setup.headers.get('access-control-allow-origin'), 'http://127.0.0.1:9166')
    const setupBody = await setup.json()
    assert.equal(typeof setupBody.csrf, 'string')
    assert.equal(setupBody.deviceId.length > 0, true)

    const appOrigin = await fetch(`${app.base}/api/setup/state`, { headers: { origin: 'dsh-app://app' } })
    assert.equal(appOrigin.status, 200)
    assert.equal(appOrigin.headers.get('access-control-allow-origin'), 'dsh-app://app')

    const preflight = await fetch(`${app.base}/api/setup/state`, {
      method: 'OPTIONS',
      headers: {
        origin: 'http://127.0.0.1:9166',
        'access-control-request-method': 'GET'
      }
    })
    assert.equal(preflight.status, 204)
    assert.equal(preflight.headers.get('access-control-allow-headers'), 'content-type,x-dsh-csrf')

    const appPreflight = await fetch(`${app.base}/api/setup/state`, {
      method: 'OPTIONS',
      headers: {
        origin: 'dsh-app://app',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type,x-dsh-csrf',
        'access-control-request-private-network': 'true'
      }
    })
    assert.equal(appPreflight.status, 204)
    assert.equal(appPreflight.headers.get('access-control-allow-origin'), 'dsh-app://app')
    assert.equal(appPreflight.headers.get('access-control-allow-private-network'), 'true')
  } finally {
    await app.close()
  }
})

test('requires a token and rejects malformed pairing', async () => {
  const app = await boot()
  try {
    const unauthorized = await fetch(`${app.base}/api/sessions`)
    assert.equal(unauthorized.status, 401)
    assert.equal((await unauthorized.json()).error.code, 'auth/unauthorized')

    const bad = await fetch(`${app.base}/api/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: '000000', installId: 'x' })
    })
    assert.equal(bad.status, 401)
  } finally {
    await app.close()
  }
})

test('lists sessions with projections and serves history', async () => {
  const app = await boot()
  try {
    const list = await fetch(`${app.base}/api/sessions`, { headers: authHeaders(app.token) })
    assert.equal(list.status, 200)
    const body = await list.json()
    assert.equal(body.sessions.length, 1)
    const row = body.sessions[0]
    assert.equal(row.title, 'Bridge work')
    assert.deepEqual(row.plan, { active: false, pending: false })
    assert.equal(row.permission, 'workspace-write')

    const workspaces = await fetch(`${app.base}/api/workspaces`, { headers: authHeaders(app.token) })
    assert.equal(workspaces.status, 200)
    const workspaceBody = await workspaces.json()
    assert.deepEqual(workspaceBody.workspaces, [
      { id: 'w1', path: 'F:\\work', title: 'work', updatedAt: 5, sessionIds: ['s1'] }
    ])

    const detail = await fetch(`${app.base}/api/sessions/s1`, { headers: authHeaders(app.token) })
    assert.equal(detail.status, 200)
    const detailBody = await detail.json()
    assert.equal(detailBody.session.id, 's1')
    assert.deepEqual(detailBody.records.map((item) => item.kind), ['user', 'assistant'])

    const history = await fetch(`${app.base}/api/sessions/s1/history?maxMessages=1`, { headers: authHeaders(app.token) })
    const historyBody = await history.json()
    assert.equal(historyBody.records.length, 1)
    assert.equal(historyBody.hasMore, true)
  } finally {
    await app.close()
  }
})

test('normalizes workspace timestamps to epoch milliseconds', async () => {
  const app = await boot({
    workspaces: [
      { id: 'w1', path: 'F:\\work', title: 'work', updatedAt: '2026-10-28T15:34:18.490Z', sessionIds: ['s1'] },
      { id: 'w2', path: 'F:\\other', title: 'other', updatedAt: new Date('2026-10-01T00:00:00.000Z'), sessionIds: [] },
      { id: 'w3', path: 'F:\\broken', title: 'broken', updatedAt: 'not-a-date' }
    ]
  })
  try {
    const response = await fetch(`${app.base}/api/workspaces`, { headers: authHeaders(app.token) })
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.workspaces[0].updatedAt, Date.parse('2026-10-28T15:34:18.490Z'))
    assert.equal(body.workspaces[1].updatedAt, Date.parse('2026-10-01T00:00:00.000Z'))
    // 解析不了的时间直接省略，不影响工作区列表
    assert.equal('updatedAt' in body.workspaces[2], false)
    assert.deepEqual(body.workspaces.map((item) => item.id), ['w1', 'w2', 'w3'])
  } finally {
    await app.close()
  }
})

test('hides orphan sessions and deletes their files', async () => {
  const home = mkdtempSync(join(tmpdir(), 'bridge-home-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  const directory = join(home, 'sessions', 'F--work', 's0')
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'session.jsonl'), '{}')
  const app = await boot()
  try {
    const list = await fetch(`${app.base}/api/sessions`, { headers: authHeaders(app.token) })
    const body = await list.json()
    assert.deepEqual(body.sessions.map((item) => item.id), ['s1'])

    const deleted = await fetch(`${app.base}/api/sessions/s0`, {
      method: 'DELETE',
      headers: authHeaders(app.token)
    })
    assert.equal(deleted.status, 200)
    assert.equal((await deleted.json()).deleted, true)
    assert.equal(existsSync(directory), false)
  } finally {
    await app.close()
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    rmSync(home, { recursive: true, force: true })
  }
})

test('hides archived sessions and keeps them out of workspace grouping', async () => {
  const app = await boot({
    // 归档会话仍留在工作区 sessionIds 里：DSH 取消归档要还原原位置
    workspaces: [{ id: 'w1', path: 'F:\\work', title: 'work', updatedAt: 5, sessionIds: ['s1', 's0'] }],
    archivedSessionIds: ['s1']
  })
  try {
    const list = await (await fetch(`${app.base}/api/sessions`, { headers: authHeaders(app.token) })).json()
    assert.deepEqual(list.sessions.map((item) => item.id), ['s0'])

    const workspaces = await (await fetch(`${app.base}/api/workspaces`, { headers: authHeaders(app.token) })).json()
    assert.deepEqual(workspaces.workspaces[0].sessionIds, ['s0'])
    assert.deepEqual(workspaces.archivedSessionIds, ['s1'])

    // 归档只是从列表隐藏，详情和日志照旧可读
    const detail = await fetch(`${app.base}/api/sessions/s1`, { headers: authHeaders(app.token) })
    assert.equal(detail.status, 200)
  } finally {
    await app.close()
  }
})

test('archives and restores a session from the phone', async () => {
  const app = await boot()
  try {
    const archived = await fetch(`${app.base}/api/sessions/s1/archive`, {
      method: 'POST',
      headers: authHeaders(app.token),
      body: '{}'
    })
    assert.equal(archived.status, 200)
    assert.deepEqual(await archived.json(), { archived: true })
    assert.deepEqual(app.archiveCalls, ['archive:s1'])
    assert.equal(app.archiveSyncs(), 1)
    const hidden = await (await fetch(`${app.base}/api/sessions`, { headers: authHeaders(app.token) })).json()
    assert.deepEqual(hidden.sessions.map((item) => item.id), [])

    const restored = await fetch(`${app.base}/api/sessions/s1/unarchive`, {
      method: 'POST',
      headers: authHeaders(app.token),
      body: '{}'
    })
    assert.equal(restored.status, 200)
    assert.deepEqual(await restored.json(), { archived: false })
    assert.deepEqual(app.archiveCalls, ['archive:s1', 'unarchive:s1'])
    assert.equal(app.archiveSyncs(), 2)
    const visible = await (await fetch(`${app.base}/api/sessions`, { headers: authHeaders(app.token) })).json()
    assert.deepEqual(visible.sessions.map((item) => item.id), ['s1'])
  } finally {
    await app.close()
  }
})

test('refuses to archive a session that is still running', async () => {
  const active = new Error('cannot archive session: the session is active (turn)')
  active.name = 'WorkspaceActiveSessionError'
  const app = await boot({ archiveError: active })
  try {
    const response = await fetch(`${app.base}/api/sessions/s1/archive`, {
      method: 'POST',
      headers: authHeaders(app.token),
      body: '{}'
    })
    assert.equal(response.status, 409)
    assert.equal((await response.json()).error.code, 'session/active')
    assert.equal(app.archiveSyncs(), 0)
  } finally {
    await app.close()
  }
})

test('prompts, renames, cancels, sets permission and plan', async () => {
  const app = await boot()
  try {
    const prompt = await fetch(`${app.base}/api/sessions/s1/prompt`, {
      method: 'POST',
      headers: authHeaders(app.token),
      body: JSON.stringify({ text: 'build it', mode: 'queue' })
    })
    assert.equal(prompt.status, 200)
    assert.equal(app.prompts.length, 1)
    assert.equal(app.prompts[0].content[0].text, 'build it')
    assert.equal(app.prompts[0].sessionId, 's1')

    const image = await fetch(`${app.base}/api/sessions/s1/prompt`, {
      method: 'POST',
      headers: authHeaders(app.token),
      body: JSON.stringify({
        text: 'look',
        images: [{
          mediaType: 'image/png',
          data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
          name: 'dot.png'
        }]
      })
    })
    assert.equal(image.status, 200)
    assert.equal(app.prompts[1].content[0].text, 'look')
    assert.equal(app.prompts[1].content[1].type, 'image')
    assert.equal(app.prompts[1].content[1].mediaType, 'image/png')
    assert.equal(app.prompts[1].content[1].name, 'dot.png')

    const invalidImage = await fetch(`${app.base}/api/sessions/s1/prompt`, {
      method: 'POST',
      headers: authHeaders(app.token),
      body: JSON.stringify({ text: 'look', images: [{ mediaType: 'image/svg+xml', data: 'AAAA' }] })
    })
    assert.equal(invalidImage.status, 400)

    const rename = await fetch(`${app.base}/api/sessions/s1/rename`, {
      method: 'POST',
      headers: authHeaders(app.token),
      body: JSON.stringify({ title: 'Renamed' })
    })
    assert.equal(rename.status, 200)
    assert.equal((await rename.json()).title, 'Renamed')

    const cancel = await fetch(`${app.base}/api/sessions/s1/cancel`, { method: 'POST', headers: authHeaders(app.token), body: '{}' })
    assert.equal(cancel.status, 200)

    const permission = await fetch(`${app.base}/api/sessions/s1/permission`, {
      method: 'POST',
      headers: authHeaders(app.token),
      body: JSON.stringify({ preset: 'read-only' })
    })
    assert.equal(permission.status, 200)
    assert.deepEqual(app.permissionCalls, ['read-only'])

    const plan = await fetch(`${app.base}/api/sessions/s1/plan`, {
      method: 'POST',
      headers: authHeaders(app.token),
      body: JSON.stringify({ active: true })
    })
    assert.equal(plan.status, 200)
    assert.deepEqual(app.planCalls, [true])
  } finally {
    await app.close()
  }
})

test('creates a session and validates its input', async () => {
  const app = await boot()
  try {
    const missing = await fetch(`${app.base}/api/sessions`, {
      method: 'POST',
      headers: authHeaders(app.token),
      body: JSON.stringify({})
    })
    assert.equal(missing.status, 400)

    const created = await fetch(`${app.base}/api/sessions`, {
      method: 'POST',
      headers: authHeaders(app.token),
      body: JSON.stringify({ workspaceId: 'w1', prompt: 'start' })
    })
    assert.equal(created.status, 200)
    const body = await created.json()
    assert.equal(body.sessionId, 's2')
    assert.equal(app.prompts[0].sessionId, 's2')
  } finally {
    await app.close()
  }
})

test('routes a cwd that belongs to a registered workspace through its workspaceId', async () => {
  const app = await boot()
  try {
    const created = await fetch(`${app.base}/api/sessions`, {
      method: 'POST',
      headers: authHeaders(app.token),
      body: JSON.stringify({ cwd: 'F:\\work', prompt: 'start' })
    })
    assert.equal(created.status, 200)
    // 已登记工作区的 cwd 改成 workspaceId，避免会话落到「未分组」
    assert.deepEqual(app.created[0], { workspaceId: 'w1' })
  } finally {
    await app.close()
  }
})

test('continues an existing session instead of creating a new one', async () => {
  const app = await boot()
  try {
    const resumed = await fetch(`${app.base}/api/sessions`, {
      method: 'POST',
      headers: authHeaders(app.token),
      body: JSON.stringify({ sessionId: 's1', prompt: '接着做' })
    })
    assert.equal(resumed.status, 200)
    const body = await resumed.json()
    assert.equal(body.sessionId, 's1')
    assert.equal(body.resumed, true)
    assert.equal(app.created.length, 0)
    assert.equal(app.prompts[0].sessionId, 's1')

    const mixed = await fetch(`${app.base}/api/sessions`, {
      method: 'POST',
      headers: authHeaders(app.token),
      body: JSON.stringify({ sessionId: 's1', workspaceId: 'w1', prompt: 'x' })
    })
    assert.equal(mixed.status, 400)

    const unknown = await fetch(`${app.base}/api/sessions`, {
      method: 'POST',
      headers: authHeaders(app.token),
      body: JSON.stringify({ sessionId: 'nope', prompt: 'x' })
    })
    assert.equal(unknown.status, 404)
  } finally {
    await app.close()
  }
})

test('cleans up the fresh session when the prompt cannot be dispatched', async () => {
  const app = await boot({ promptError: new Error('agent went away') })
  try {
    const response = await fetch(`${app.base}/api/sessions`, {
      method: 'POST',
      headers: authHeaders(app.token),
      body: JSON.stringify({ workspaceId: 'w1', prompt: 'start' })
    })
    assert.equal(response.status, 500)
    const body = await response.json()
    assert.equal(body.error.code, 'session/prompt-failed')
    assert.match(body.error.message, /agent went away/)
    assert.match(body.error.message, /已清理这次刚建的会话/)
  } finally {
    await app.close()
  }
})

test('rejects a relative collab workspace and keeps an absolute one', async () => {
  const app = await boot()
  try {
    const state = await (await fetch(`${app.base}/api/setup/state`)).json()
    assert.deepEqual(
      state.workspaces.map((workspace) => ({ id: workspace.id, path: workspace.path })),
      [{ id: 'w1', path: 'F:\\work' }]
    )

    const relative = await fetch(`${app.base}/api/setup/settings`, {
      method: 'POST',
      headers: { ...authHeaders(app.token), 'x-dsh-csrf': state.csrf },
      body: JSON.stringify({ collabRoot: 'TS0-1 协作目录' })
    })
    assert.equal(relative.status, 400)

    const absolute = await fetch(`${app.base}/api/setup/settings`, {
      method: 'POST',
      headers: { ...authHeaders(app.token), 'x-dsh-csrf': state.csrf },
      body: JSON.stringify({ collabRoot: 'F:\\collab' })
    })
    assert.equal(absolute.status, 200)
    const saved = await absolute.json()
    assert.equal(saved.settings.collabRoot, 'F:\\collab')

    const withWorkspace = await fetch(`${app.base}/api/setup/state`).then((response) => response.json())
    assert.equal(withWorkspace.collabRoot, 'F:\\collab')
  } finally {
    await app.close()
  }
})

test('setup mutations require the CSRF header', async () => {
  const app = await boot()
  try {
    const state = await (await fetch(`${app.base}/api/setup/state`)).json()
    const denied = await fetch(`${app.base}/api/setup/code`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    })
    assert.equal(denied.status, 403)

    const allowed = await fetch(`${app.base}/api/setup/code`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dsh-csrf': state.csrf },
      body: '{}'
    })
    assert.equal(allowed.status, 200)
    assert.match((await allowed.json()).code, /^\d{6}$/)
  } finally {
    await app.close()
  }
})

test('checks for updates from the loopback panel and reports the cached answer', async () => {
  const checks = []
  const fakeUpdater = {
    snapshot: () => ({ current: '0.8.3', latest: '0.8.4', hasUpdate: true, checkedAt: 1, error: null }),
    check: async ({ force } = {}) => {
      checks.push(force === true)
      return { current: '0.8.3', latest: '0.8.4', hasUpdate: true, checkedAt: 2, error: null }
    }
  }
  const app = await boot({ updater: fakeUpdater })
  try {
    const setup = await (await fetch(`${app.base}/api/setup/state`)).json()
    assert.equal(setup.update.latest, '0.8.4')
    assert.equal(setup.update.hasUpdate, true)

    const denied = await fetch(`${app.base}/api/setup/update`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    })
    assert.equal(denied.status, 403)

    const forced = await fetch(`${app.base}/api/setup/update`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dsh-csrf': setup.csrf },
      body: JSON.stringify({ force: true })
    })
    assert.equal(forced.status, 200)
    const body = await forced.json()
    assert.equal(body.update.latest, '0.8.4')
    assert.deepEqual(checks, [true])
  } finally {
    await app.close()
  }

  const bare = await boot()
  try {
    const setup = await (await fetch(`${bare.base}/api/setup/state`)).json()
    assert.equal(setup.update, null)
    const response = await fetch(`${bare.base}/api/setup/update`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dsh-csrf': setup.csrf },
      body: '{}'
    })
    assert.equal(response.status, 503)
  } finally {
    await bare.close()
  }
})

test('exposes and drives the embedded Tailscale node from the loopback API', async () => {
  const calls = []
  const fakeTailscale = {
    endpoints: () => [
      { kind: 'tailscale', address: '100.64.1.2', url: 'http://100.64.1.2:48123', source: 'embedded' }
    ],
    status: () => ({ enabled: true, phase: 'running', ip4: '100.64.1.2', hostname: 'dsh-abc', log: [] }),
    setEnabled: async (value) => calls.push(['enable', value]),
    setAuthKey: async (value) => calls.push(['authkey', value]),
    setHostname: async (value) => calls.push(['hostname', value]),
    restart: async () => calls.push(['restart'])
  }
  const app = await boot({ tailscale: fakeTailscale })
  try {
    const setup = await (await fetch(`${app.base}/api/setup/state`)).json()
    assert.equal(setup.tailscale.phase, 'running')
    assert.deepEqual(
      setup.endpoints.filter((item) => item.source === 'embedded'),
      [{ kind: 'tailscale', address: '100.64.1.2', url: 'http://100.64.1.2:48123', source: 'embedded' }]
    )

    const info = await (await fetch(`${app.base}/api/info`, { headers: authHeaders(app.token) })).json()
    assert.ok(info.bridge.endpoints.some((item) => item.source === 'embedded'))
    assert.equal('tailscaleAuthKey' in info.settings, false)
    assert.equal(info.settings.hasTailscaleAuthKey, false)

    const url = `${app.base}/api/setup/tailscale`
    const denied = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'restart' })
    })
    assert.equal(denied.status, 403)

    const post = (body) =>
      fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dsh-csrf': setup.csrf },
        body: JSON.stringify(body)
      })

    for (const action of ['enable', 'disable']) {
      const response = await post({ action })
      assert.equal(response.status, 200)
      assert.equal((await response.json()).ok, true)
    }
    assert.equal((await post({ action: 'authkey', value: 'tskey-abc' })).status, 200)
    assert.equal((await post({ action: 'hostname', value: 'Phone PC' })).status, 200)
    assert.equal((await post({ action: 'restart' })).status, 200)
    assert.equal((await post({ action: 'nope' })).status, 400)

    assert.deepEqual(calls, [
      ['enable', true],
      ['enable', false],
      ['authkey', 'tskey-abc'],
      ['hostname', 'Phone PC'],
      ['restart']
    ])

    const read = await (await fetch(url)).json()
    assert.equal(read.tailscale.hostname, 'dsh-abc')
  } finally {
    await app.close()
  }
})

test('reports the embedded Tailscale node as unavailable without a manager', async () => {
  const app = await boot()
  try {
    const setup = await (await fetch(`${app.base}/api/setup/state`)).json()
    assert.equal(setup.tailscale, null)
    const response = await fetch(`${app.base}/api/setup/tailscale`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dsh-csrf': setup.csrf },
      body: JSON.stringify({ action: 'enable' })
    })
    assert.equal(response.status, 503)
  } finally {
    await app.close()
  }
})

test('creates a group from the loopback panel and accepts a peer by invite', async () => {
  const app = await boot()
  try {
    const setup = await (await fetch(`${app.base}/api/setup/state`)).json()
    assert.equal(setup.group.group, null)

    const created = await fetch(`${app.base}/api/setup/group`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dsh-csrf': setup.csrf },
      body: JSON.stringify({ action: 'create', name: '设计组' })
    })
    const createdBody = await created.json()
    assert.equal(created.status, 200)
    assert.equal(createdBody.group.name, '设计组')
    assert.match(createdBody.invite.code, /^\d{6}$/)
    assert.equal(JSON.stringify(createdBody).includes(app.group.group.secret), false)

    const join = await fetch(`${app.base}/api/group/join`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: createdBody.invite.code, baseUrl: 'http://10.0.0.2:48123', deviceId: 'HOSTB', name: 'PC-B' })
    })
    const joinBody = await join.json()
    assert.equal(join.status, 200)
    assert.equal(joinBody.secret, app.group.group.secret)
    assert.equal(joinBody.groupId, app.group.group.id)

    const hello = await fetch(`${app.base}/api/group/hello`, {
      method: 'POST',
      headers: { authorization: 'Bearer not-the-secret' }
    })
    assert.equal(hello.status, 401)

    const group = await (await fetch(`${app.base}/api/group`, { headers: authHeaders(app.token) })).json()
    assert.equal(group.peers.length, 1)
    assert.equal(group.peers[0].deviceId, 'HOSTB')

    const leave = await fetch(`${app.base}/api/setup/group`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dsh-csrf': setup.csrf },
      body: JSON.stringify({ action: 'leave' })
    })
    assert.equal((await leave.json()).group, null)
  } finally {
    await app.close()
  }
})

test('joins a group from the panel with an address that has no scheme', async () => {
  const host = await boot()
  const guest = await boot()
  try {
    const hostSetup = await (await fetch(`${host.base}/api/setup/state`)).json()
    const created = await fetch(`${host.base}/api/setup/group`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dsh-csrf': hostSetup.csrf },
      body: JSON.stringify({ action: 'create', name: '设计组' })
    })
    const createdBody = await created.json()
    assert.equal(created.status, 200)

    guest.state.deviceId = 'GUEST1'
    const guestSetup = await (await fetch(`${guest.base}/api/setup/state`)).json()
    const bare = host.base.replace(/^http:\/\//, '')
    const joined = await fetch(`${guest.base}/api/setup/group`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dsh-csrf': guestSetup.csrf },
      body: JSON.stringify({ action: 'join', baseUrl: bare, code: createdBody.invite.code })
    })
    const joinedBody = await joined.json()
    assert.equal(joined.status, 200, JSON.stringify(joinedBody))
    assert.equal(joinedBody.group.id, host.group.group.id)
    assert.equal(joinedBody.peers.length, 1)
    assert.equal(joinedBody.peers[0].baseUrl, `http://${bare}`)

    const listed = await (await fetch(`${host.base}/api/group`, { headers: authHeaders(host.token) })).json()
    assert.equal(listed.peers.some((peer) => peer.deviceId === 'GUEST1'), true)
  } finally {
    await host.close()
    await guest.close()
  }
})

test('lets a group peer drive the phone API but keeps it out of the event stream', async () => {
  const app = await boot()
  try {
    app.state.group = { id: 'grp_1', name: 'g', secret: 'dshg_test', createdAt: new Date().toISOString() }
    const peerHeaders = { authorization: 'Bearer dshg_test' }

    const list = await fetch(`${app.base}/api/sessions`, { headers: peerHeaders })
    assert.equal(list.status, 200)
    assert.equal((await list.json()).sessions.length, 1)

    const events = await fetch(`${app.base}/api/events`, { headers: peerHeaders })
    assert.equal(events.status, 403)

    const created = await fetch(`${app.base}/api/sessions`, {
      method: 'POST',
      headers: { ...peerHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ cwd: 'F:\\work', prompt: '画一张机器人概念图' })
    })
    assert.equal(created.status, 200)
    assert.equal(app.prompts.length, 1)
  } finally {
    await app.close()
  }
})

test('keeps peer sessions inside the collab workspace', async () => {
  const app = await boot()
  try {
    app.state.group = { id: 'grp_1', name: 'g', secret: 'dshg_test', createdAt: new Date().toISOString() }
    app.state.settings.collabRoot = 'F:\\work'
    const peerHeaders = { authorization: 'Bearer dshg_test', 'content-type': 'application/json' }

    const outside = await fetch(`${app.base}/api/sessions`, {
      method: 'POST',
      headers: peerHeaders,
      body: JSON.stringify({ cwd: 'C:\\Windows', prompt: '越界' })
    })
    assert.equal(outside.status, 403)
    assert.equal(app.created.length, 0)
    assert.equal(app.prompts.length, 0)

    const unknownWorkspace = await fetch(`${app.base}/api/sessions`, {
      method: 'POST',
      headers: peerHeaders,
      body: JSON.stringify({ workspaceId: 'w9', prompt: '越界' })
    })
    assert.equal(unknownWorkspace.status, 403)

    const inside = await fetch(`${app.base}/api/sessions`, {
      method: 'POST',
      headers: peerHeaders,
      body: JSON.stringify({ cwd: 'F:\\work\\out', prompt: '画图' })
    })
    assert.equal(inside.status, 200)
    assert.deepEqual(app.created, [{ cwd: 'F:\\work\\out' }])

    // 手机自己派的会话不受协作工作区限制，那是机主自己的机器。
    const phone = await fetch(`${app.base}/api/sessions`, {
      method: 'POST',
      headers: { ...authHeaders(app.token), 'content-type': 'application/json' },
      body: JSON.stringify({ cwd: 'C:\\Windows', prompt: '手机派的' })
    })
    assert.equal(phone.status, 200)
  } finally {
    await app.close()
  }
})

test('lists and serves artifacts only inside the requested workspace', async () => {
  const root = mkdtempSync(join(tmpdir(), 'collab-files-'))
  const outside = mkdtempSync(join(tmpdir(), 'collab-outside-'))
  const app = await boot()
  try {
    mkdirSync(join(root, 'design'), { recursive: true })
    writeFileSync(join(root, 'design', 'robot.png'), 'png-bytes')
    writeFileSync(join(root, 'notes.txt'), 'hello')
    writeFileSync(join(outside, 'secret.txt'), 'nope')
    app.state.group = { id: 'grp_1', name: 'g', secret: 'dshg_test', createdAt: new Date().toISOString() }
    const headers = { authorization: 'Bearer dshg_test' }

    const listed = await (await fetch(`${app.base}/api/collab/files?cwd=${encodeURIComponent(root)}&since=0`, { headers })).json()
    const names = listed.files.map((file) => file.rel).sort()
    assert.deepEqual(names, ['design/robot.png', 'notes.txt'])

    const fresh = await (await fetch(`${app.base}/api/collab/files?cwd=${encodeURIComponent(root)}&since=${Date.now() + 60_000}`, { headers })).json()
    assert.equal(fresh.files.length, 0)

    const file = await fetch(`${app.base}/api/collab/file?cwd=${encodeURIComponent(root)}&path=design%2Frobot.png`, { headers })
    assert.equal(file.status, 200)
    assert.equal(file.headers.get('content-type'), 'image/png')
    assert.equal(await file.text(), 'png-bytes')

    const escape = await fetch(`${app.base}/api/collab/file?cwd=${encodeURIComponent(root)}&path=..%2F${encodeURIComponent(outside.split(/[\\\\/]/).pop())}%2Fsecret.txt`, { headers })
    assert.equal(escape.status, 403)

    const relative = await fetch(`${app.base}/api/collab/files?cwd=work&since=0`, { headers })
    assert.equal(relative.status, 400)

    app.state.settings.collabRoot = root
    const locked = await fetch(`${app.base}/api/collab/files?cwd=${encodeURIComponent(outside)}&since=0`, { headers })
    assert.equal(locked.status, 403)
  } finally {
    await app.close()
    rmSync(root, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  }
})

test('lets the phone broker a group between two paired hosts', async () => {
  const app = await boot()
  try {
    const invite = await fetch(`${app.base}/api/group/invite`, { method: 'POST', headers: authHeaders(app.token) })
    const inviteBody = await invite.json()
    assert.equal(invite.status, 200)
    assert.match(inviteBody.invite.code, /^\d{6}$/)
    assert.equal(inviteBody.group.name.length > 0, true)

    const listed = await (await fetch(`${app.base}/api/group`, { headers: authHeaders(app.token) })).json()
    assert.equal(listed.group.id, inviteBody.group.id)

    const linked = await fetch(`${app.base}/api/group/link`, {
      method: 'POST',
      headers: { ...authHeaders(app.token), 'content-type': 'application/json' },
      body: JSON.stringify({ peerBaseUrl: app.base, code: inviteBody.invite.code })
    })
    assert.equal(linked.status, 400)
  } finally {
    await app.close()
  }
})


test('serves the raw bytes behind a timeline image and keeps image-only messages', async () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9])
  const ref = { attachmentId: 'a1', mediaType: 'image/jpeg', bytes: jpeg.length, width: 8, height: 6, name: 'shot.jpg' }
  const reads = []
  const app = await boot({
    attachments: {
      readImage: async (requested) => {
        reads.push(requested)
        return { data: jpeg, ref }
      }
    },
    events: [
      { type: 'user/message', seq: 1, data: { content: [{ type: 'text', text: 'hello' }] } },
      { type: 'assistant/message', seq: 2, data: { message: { content: [{ type: 'text', text: 'hi' }] } } },
      { type: 'user/message', seq: 3, data: { content: [{ type: 'image', attachment: ref }] } }
    ]
  })
  try {
    // 手机直接要图、还没拉过历史：缓存没命中，接口自己读一次会话找引用。
    const cold = await fetch(`${app.base}/api/sessions/s1/images/3/0`, { headers: authHeaders(app.token) })
    assert.equal(cold.status, 200)
    assert.deepEqual(Buffer.from(await cold.arrayBuffer()), jpeg)

    const history = await (await fetch(`${app.base}/api/sessions/s1/history`, { headers: authHeaders(app.token) })).json()
    const imageOnly = history.records.find((item) => item.seq === 3)
    assert.ok(imageOnly, 'an image-only message must stay in the timeline')
    assert.equal(imageOnly.kind, 'user')
    assert.equal(imageOnly.text, '')
    assert.deepEqual(imageOnly.images, [
      { index: 0, mediaType: 'image/jpeg', name: 'shot.jpg', width: 8, height: 6, bytes: jpeg.length }
    ])

    const bytes = await fetch(`${app.base}/api/sessions/s1/images/3/0`, { headers: authHeaders(app.token) })
    assert.equal(bytes.status, 200)
    assert.equal(bytes.headers.get('content-type'), 'image/jpeg')
    assert.equal(bytes.headers.get('x-content-type-options'), 'nosniff')
    assert.deepEqual(Buffer.from(await bytes.arrayBuffer()), jpeg)
    assert.equal(reads.length, 2)
    assert.equal(reads[0].attachmentId, 'a1')

    const missing = await fetch(`${app.base}/api/sessions/s1/images/3/7`, { headers: authHeaders(app.token) })
    assert.equal(missing.status, 404)
    assert.equal((await missing.json()).error.code, 'image/not-found')

    const unauth = await fetch(`${app.base}/api/sessions/s1/images/3/0`)
    assert.equal(unauth.status, 401)
  } finally {
    await app.close()
  }
})

test('creates a workspace folder under the configured default root', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-ws-'))
  const app = await boot()
  try {
    app.state.settings.workspaceRoot = root

    const listing = await (await fetch(`${app.base}/api/workspaces`, { headers: authHeaders(app.token) })).json()
    assert.equal(listing.root, root)

    const created = await fetch(`${app.base}/api/workspaces`, {
      method: 'POST',
      headers: authHeaders(app.token),
      body: JSON.stringify({ name: 'demo' })
    })
    assert.equal(created.status, 200)
    const body = await created.json()
    assert.equal(body.root, root)
    assert.equal(body.workspace.path, join(root, 'demo'))
    assert.equal(existsSync(join(root, 'demo')), true)
    assert.deepEqual(app.createdWorkspaces, [{ path: join(root, 'demo'), title: 'demo' }])

    // 名字里的分隔符被剥掉后仍可能拼出「跳出根目录」的形状，这里必须拒。
    const escaped = await fetch(`${app.base}/api/workspaces`, {
      method: 'POST',
      headers: authHeaders(app.token),
      body: JSON.stringify({ name: '../outside' })
    })
    assert.equal(escaped.status, 400)
    assert.equal((await escaped.json()).error.code, 'workspace/bad-name')
    assert.equal(existsSync(join(root, '..', 'outside')), false)

    const bad = await fetch(`${app.base}/api/workspaces`, {
      method: 'POST',
      headers: authHeaders(app.token),
      body: JSON.stringify({ name: '..' })
    })
    assert.equal(bad.status, 400)
    assert.equal((await bad.json()).error.code, 'workspace/bad-name')

    app.state.settings.workspaceRoot = ''
    const noRoot = await fetch(`${app.base}/api/workspaces`, {
      method: 'POST',
      headers: authHeaders(app.token),
      body: JSON.stringify({ name: 'demo2' })
    })
    assert.equal(noRoot.status, 409)
    assert.equal((await noRoot.json()).error.code, 'workspace/no-root')
  } finally {
    await app.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('exports the run log to the panel and to a paired phone', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-bridge-logs-'))
  const logs = createLogSink({ dir, logger: { warn() {} } })
  logs.info('boot')
  logs.warn('plan review kept while the phone reconnects')
  const app = await boot({ logs })
  try {
    const panel = await fetch(`${app.base}/api/setup/logs?lines=50`)
    assert.equal(panel.status, 200)
    assert.match(panel.headers.get('content-type') ?? '', /text\/plain/)
    assert.match(panel.headers.get('content-disposition') ?? '', /attachment; filename="dsh-remote-host-/)
    const panelText = await panel.text()
    assert.match(panelText, /^==== /)
    assert.match(panelText, /0\.1\.0-test/)
    assert.match(panelText, /bridge\.log/)
    assert.match(panelText, /plan review kept while the phone reconnects/)

    const unauthorized = await fetch(`${app.base}/api/logs`)
    assert.equal(unauthorized.status, 401)

    const phone = await fetch(`${app.base}/api/logs?format=json&lines=20`, {
      headers: { authorization: `Bearer ${app.token}` }
    })
    assert.equal(phone.status, 200)
    const bundle = await phone.json()
    assert.equal(bundle.path, logs.path)
    assert.match(bundle.text, /plan review kept while the phone reconnects/)
    assert.equal(bundle.count > 0, true)

    const attachment = await fetch(`${app.base}/api/logs?lines=5`, {
      headers: { authorization: `Bearer ${app.token}` }
    })
    assert.match(attachment.headers.get('content-disposition') ?? '', /dsh-remote-host-/)
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

/**
 * R11 探针之外的另一个「静默坏掉」入口：鉴权分层如果没人守，坏掉也不会报错。
 * 这里按 README 的分层逐个点：设备 token 能过的路由，缺 token 必须 401；
 * 组密钥只放行它该放行的，`/api/group/hello` 不接受设备 token。
 */
test('every device route rejects a missing token', async () => {
  const app = await boot()
  const routes = [
    ['GET', '/api/info'],
    ['GET', '/api/logs'],
    ['GET', '/api/workspaces'],
    ['POST', '/api/workspaces'],
    ['GET', '/api/group'],
    ['POST', '/api/group/invite'],
    ['POST', '/api/group/link'],
    ['GET', '/api/collab/files?cwd=F%3A%5Cwork'],
    ['GET', '/api/collab/file?cwd=F%3A%5Cwork&path=a.txt'],
    ['GET', '/api/permission-presets'],
    ['GET', '/api/sessions'],
    ['POST', '/api/sessions'],
    ['GET', '/api/sessions/s1'],
    ['DELETE', '/api/sessions/s1'],
    ['POST', '/api/sessions/s1/archive'],
    ['POST', '/api/sessions/s1/unarchive'],
    ['GET', '/api/sessions/s1/history'],
    ['GET', '/api/sessions/s1/images/1/0'],
    ['POST', '/api/sessions/s1/prompt'],
    ['POST', '/api/sessions/s1/cancel'],
    ['POST', '/api/sessions/s1/rename'],
    ['POST', '/api/sessions/s1/permission'],
    ['POST', '/api/sessions/s1/plan'],
    ['POST', '/api/subscribe'],
    ['POST', '/api/unsubscribe'],
    ['GET', '/api/pending'],
    ['POST', '/api/approvals/ap_x'],
    ['POST', '/api/questions/q_x'],
    ['GET', '/api/events']
  ]
  try {
    for (const [method, path] of routes) {
      const anonymous = await fetch(`${app.base}${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: method === 'GET' ? undefined : '{}'
      })
      assert.equal(anonymous.status, 401, `${method} ${path} 缺 token 时应当 401`)

      const forged = await fetch(`${app.base}${path}`, {
        method,
        headers: { authorization: 'Bearer dshm_not-a-real-token', 'content-type': 'application/json' },
        body: method === 'GET' ? undefined : '{}'
      })
      assert.equal(forged.status, 401, `${method} ${path} 用伪造 token 时应当 401`)
    }
  } finally {
    await app.close()
  }
})

test('group/hello accepts only the group secret, never a device token', async () => {
  const app = await boot()
  try {
    const setup = await (await fetch(`${app.base}/api/setup/state`)).json()
    const created = await fetch(`${app.base}/api/setup/group`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dsh-csrf': setup.csrf },
      body: JSON.stringify({ action: 'create', name: '设计组' })
    })
    assert.equal(created.status, 200)
    const secret = app.state.group.secret

    const anonymous = await fetch(`${app.base}/api/group/hello`, { method: 'POST' })
    assert.equal(anonymous.status, 401)
    assert.equal((await anonymous.json()).error.code, 'auth/unauthorized')

    // 设备 token 与组密钥是两套凭据：配对过的手机也不能拿 dshm_ 当组密钥。
    const withDeviceToken = await fetch(`${app.base}/api/group/hello`, {
      method: 'POST',
      headers: { authorization: `Bearer ${app.token}` }
    })
    assert.equal(withDeviceToken.status, 401)

    const wrongSecret = await fetch(`${app.base}/api/group/hello`, {
      method: 'POST',
      headers: { authorization: 'Bearer dshg_wrong' }
    })
    assert.equal(wrongSecret.status, 401)

    const ok = await fetch(`${app.base}/api/group/hello`, {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}` }
    })
    const body = await ok.json()
    assert.equal(ok.status, 200)
    assert.equal(body.groupId, app.state.group.id)
    assert.equal(body.deviceId, app.state.deviceId)
    assert.equal(typeof body.port, 'number')
    assert.ok(Array.isArray(body.peers))
    assert.equal(JSON.stringify(body).includes(secret), false)
  } finally {
    await app.close()
  }
})

test('group routes report 503 when the host has no binding group', async () => {
  const app = await boot({ group: false })
  try {
    const hello = await fetch(`${app.base}/api/group/hello`, {
      method: 'POST',
      headers: { authorization: 'Bearer dshg_whatever' }
    })
    assert.equal(hello.status, 503)
    assert.equal((await hello.json()).error.code, 'group/unavailable')

    const join = await fetch(`${app.base}/api/group/join`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: '123456' })
    })
    assert.equal(join.status, 503)
  } finally {
    await app.close()
  }
})
