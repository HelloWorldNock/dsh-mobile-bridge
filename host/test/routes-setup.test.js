import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSetupRoutes } from '../lib/routes/setup.js'

/**
 * 设置路由族（R21 第二刀）。重点盯两条安全边界：非 loopback 一律 403、
 * POST 必须过 CSRF；其余按动作逐个断言副作用。
 */

function makeApi(overrides = {}) {
  const sent = []
  const text = []
  const calls = []
  const api = {
    sent,
    text,
    calls,
    isLoopback: () => true,
    checkCsrf: () => calls.push('csrf'),
    sendJson: (res, status, body) => sent.push({ status, body }),
    sendText: (res, status, body, filename) => text.push({ status, body, filename }),
    readJson: async () => ({}),
    setupState: async () => ({ deviceId: 'DEV1', code: '123456', compatibility: { ok: true } }),
    logBundle: ({ lines }) => `log:${lines}`,
    tailscale: null,
    updater: null,
    auth: {
      rotateCode: () => {
        calls.push('rotateCode')
        return { code: '654321', expiresAt: Date.now() + 120_000 }
      },
      revoke: (id) => id === 'known',
      revokeAll: () => calls.push('revokeAll'),
      updateSettings: (body) => ({ phoneFirst: body.phoneFirst !== false })
    },
    group: null,
    broadcast: { closeDevice: (id) => calls.push(`closeDevice:${id}`), closeAll: () => calls.push('closeAll') },
    approvals: { revalidate: () => calls.push('revalidate') },
    onDiscoveryChange: () => calls.push('discovery'),
    logger: { warn: (line) => calls.push(`warn:${line}`) },
    collabRoot: () => 'F:\\collab',
    collabWorkspace: () => ({ id: 'w1' }),
    advertisedBaseUrl: (peer, explicit) => explicit ?? `http://self:48123`,
    ...overrides
  }
  return api
}

async function call(api, { method = 'GET', path = '/api/setup/state', body = undefined, search = '' } = {}) {
  const handler = createSetupRoutes({ ...api, readJson: async () => body ?? {} })
  const url = new URL(`http://bridge.local${path}${search}`)
  const handled = await handler({ req: {}, res: {}, url, method, path })
  return handled
}

test('setup routes stay out of unrelated paths', async () => {
  const api = makeApi()
  assert.equal(await call(api, { path: '/api/sessions' }), false)
  assert.equal(api.sent.length, 0)
})

test('non-loopback requests are refused before anything else', async () => {
  const api = makeApi({ isLoopback: () => false })
  await assert.rejects(
    () => call(api, { path: '/api/setup/state' }),
    (error) => error.code === 'setup/forbidden' && error.status === 403
  )
  await assert.rejects(
    () => call(api, { method: 'POST', path: '/api/setup/reset' }),
    (error) => error.code === 'setup/forbidden'
  )
  assert.deepEqual(api.calls, [])
})

test('GET state returns the panel snapshot', async () => {
  const api = makeApi()
  await call(api)
  assert.equal(api.sent[0].status, 200)
  assert.equal(api.sent[0].body.deviceId, 'DEV1')
})

test('GET logs clamps the line count and names the file', async () => {
  const api = makeApi()
  await call(api, { path: '/api/setup/logs', search: '?lines=99999' })
  assert.equal(api.text[0].status, 200)
  assert.equal(api.text[0].body, 'log:1500')
  assert.match(api.text[0].filename, /^dsh-remote-host-\d{8}-\d{6}\.log$/)
})

test('POST requires csrf and rejects unknown actions', async () => {
  const blocked = makeApi({
    checkCsrf: () => {
      throw Object.assign(new Error('csrf'), { code: 'setup/csrf', status: 403 })
    }
  })
  await assert.rejects(
    () => call(blocked, { method: 'POST', path: '/api/setup/reset' }),
    (error) => error.code === 'setup/csrf'
  )

  const api = makeApi()
  await assert.rejects(
    () => call(api, { method: 'POST', path: '/api/setup/nope' }),
    (error) => error.code === 'not-found' && error.status === 404
  )
  assert.deepEqual(api.calls, ['csrf'])
})

test('POST code rotates the pairing code', async () => {
  const api = makeApi()
  await call(api, { method: 'POST', path: '/api/setup/code' })
  assert.equal(api.sent[0].body.code, '654321')
  assert.ok(typeof api.sent[0].body.expiresAt === 'string')
})

test('POST revoke reports missing devices and kicks live sessions', async () => {
  const missing = makeApi()
  await assert.rejects(
    () => call(missing, { method: 'POST', path: '/api/setup/revoke', body: { deviceId: 'ghost' } }),
    (error) => error.code === 'setup/not-found'
  )

  const api = makeApi()
  await call(api, { method: 'POST', path: '/api/setup/revoke', body: { deviceId: 'known' } })
  assert.deepEqual(api.calls, ['csrf', 'closeDevice:known', 'revalidate'])
})

test('POST reset revokes everything and refreshes the code', async () => {
  const api = makeApi()
  await call(api, { method: 'POST', path: '/api/setup/reset' })
  assert.deepEqual(api.calls, ['csrf', 'revokeAll', 'rotateCode', 'closeAll', 'revalidate'])
})

test('tailscale actions report 503 when the node is unavailable', async () => {
  const api = makeApi()
  await assert.rejects(
    () => call(api, { method: 'POST', path: '/api/setup/tailscale', body: { action: 'enable' } }),
    (error) => error.code === 'tailscale/unavailable' && error.status === 503
  )
})

test('tailscale actions drive the node and notify discovery', async () => {
  const seen = []
  const node = {
    setEnabled: async (v) => seen.push(['enable', v]),
    setAuthKey: async (v) => seen.push(['authkey', v]),
    setHostname: async (v) => seen.push(['hostname', v]),
    setStateDir: async (v) => seen.push(['statedir', v]),
    restart: async () => seen.push(['restart']),
    status: () => ({ phase: 'on' })
  }
  const api = makeApi({ tailscale: node })

  await call(api, { method: 'POST', path: '/api/setup/tailscale', body: { action: 'enable' } })
  await call(api, { method: 'POST', path: '/api/setup/tailscale', body: { action: 'authkey', value: 'tskey-1' } })
  assert.deepEqual(seen, [['enable', true], ['authkey', 'tskey-1']])
  assert.ok(api.calls.includes('discovery'))
  assert.deepEqual(api.sent[0].body.tailscale, { phase: 'on' })

  await assert.rejects(
    () => call(api, { method: 'POST', path: '/api/setup/tailscale', body: { action: 'bogus' } }),
    (error) => error.code === 'setup/bad-request'
  )
})

test('group actions are gated and forwarded', async () => {
  const none = makeApi()
  await assert.rejects(
    () => call(none, { method: 'POST', path: '/api/setup/group', body: { action: 'create' } }),
    (error) => error.code === 'group/unavailable' && error.status === 503
  )

  const joined = []
  const group = {
    create: ({ name }) => ({ group: { name } }),
    rotateInvite: () => ({ code: '111111' }),
    snapshot: () => ({ peers: [] }),
    joinRemote: async (payload) => {
      joined.push(payload)
      return { ok: true }
    },
    leave: () => ({ group: null }),
    removePeer: (id) => id,
    refresh: async () => undefined
  }
  const api = makeApi({ group })

  await call(api, { method: 'POST', path: '/api/setup/group', body: { action: 'create', name: '设计组' } })
  await call(api, { method: 'POST', path: '/api/setup/group', body: { action: 'invite' } })
  await call(api, { method: 'POST', path: '/api/setup/group', body: { action: 'join', baseUrl: 'http://b:48123', code: '123456', selfBaseUrl: 'http://a:48123' } })
  await call(api, { method: 'POST', path: '/api/setup/group', body: { action: 'forget', deviceId: 'HOSTB' } })

  assert.deepEqual(joined[0], {
    baseUrl: 'http://b:48123',
    code: '123456',
    selfBaseUrl: 'http://a:48123',
    collabRoot: 'F:\\collab',
    collabWorkspaceId: 'w1'
  })
  assert.equal(api.sent[0].body.group.name, '设计组')
  assert.equal(api.sent[1].body.invite.code, '111111')
  assert.equal(api.sent[3].body.removed, 'HOSTB')

  await assert.rejects(
    () => call(api, { method: 'POST', path: '/api/setup/group', body: { action: 'nope' } }),
    (error) => error.code === 'setup/bad-request'
  )
})
