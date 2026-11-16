import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createConnectionRoutes } from '../lib/routes/connections.js'

/**
 * 绑定组与协作路由族（R21 第三刀）。重点：join/hello 在身份解析之前就要能跑，
 * 其余接口必须先过 `requireIdentity`；协作文件仍受「只能在协作工作区内部」约束。
 */

function makeApi(overrides = {}) {
  const calls = []
  const sent = []
  const secret = 'dshg_secret'
  const api = {
    calls,
    sent,
    readJson: async () => ({}),
    sendJson: (res, status, body) => sent.push({ status, body }),
    requireIdentity: (req) => {
      calls.push('identity')
      return { kind: 'phone', device: { id: 'dev1' } }
    },
    group: {
      group: { id: 'grp1' },
      acceptJoin: (payload, ip) => {
        calls.push(['acceptJoin', payload.code, ip])
        return { secret, groupId: 'grp1' }
      },
      secretMatches: (token) => token === secret,
      // 真实 group.snapshot() 会带上当前邀请码；这里跟着 rotateInvite 走。
      snapshot: () => ({ group: { id: 'grp1' }, peers: [{ deviceId: 'HOSTB' }], invite: api.__invite ?? null }),
      create: (input) => calls.push(['create', input.name]),
      rotateInvite: () => {
        api.__invite = { code: '123456', expiresAt: Date.now() }
        return api.__invite
      },
      joinRemote: async (payload) => {
        calls.push(['joinRemote', payload.code])
        return { joined: true }
      }
    },
    state: { group: { id: 'grp1', name: '设计组' }, deviceId: 'HOSTA', hostName: '书桌 PC' },
    version: '0.9.1-test',
    port: 48123,
    allEndpoints: () => [{ kind: 'lan', url: 'http://192.168.1.5:48123' }],
    collabRoot: () => 'F:\\collab',
    collabWorkspace: () => ({ id: 'w1' }),
    advertisedBaseUrl: (peer, explicit) => explicit ?? 'http://self:48123',
    absoluteDir: (value) => value ?? 'F:\\collab',
    assertInCollabRoot: (dir) => {
      calls.push(['assertInCollabRoot', dir])
      if (dir !== 'F:\\collab') {
        throw Object.assign(new Error('outside'), { code: 'collab/forbidden', status: 403 })
      }
    },
    listWorkspaceFiles: (dir, since) => [{ path: 'a.png', size: 3, since }],
    resolveWorkspaceFile: (dir, rel) => ({ target: join(dir, rel), info: { size: 5 } }),
    mediaTypeFor: () => 'image/png',
    ...overrides
  }
  return api
}

async function call(api, { method = 'GET', path = '/api/group', body = undefined, search = '', headers = {} } = {}) {
  const handler = createConnectionRoutes({ ...api, readJson: async () => body ?? {} })
  const url = new URL(`http://bridge.local${path}${search}`)
  const req = { headers, socket: { remoteAddress: '10.0.0.9' } }
  const res = {
    writeHead(status, hdrs) {
      res.status = status
      res.headers = hdrs
    },
    end(payload) {
      res.payload = payload
    }
  }
  const handled = await handler({ req, res, url, method, path })
  return { handled, res }
}

test('unrelated paths are ignored without touching identity', async () => {
  const api = makeApi()
  const { handled } = await call(api, { path: '/api/sessions' })
  assert.equal(handled, false)
  assert.deepEqual(api.calls, [])
})

test('group join runs before identity and forwards the peer ip', async () => {
  const api = makeApi()
  const { handled } = await call(api, {
    method: 'POST',
    path: '/api/group/join',
    body: { code: '123456', baseUrl: 'http://10.0.0.2:48123', deviceId: 'HOSTB', collabRoot: 'F:\\collab' }
  })
  assert.equal(handled, true)
  assert.equal(api.sent[0].status, 200)
  assert.equal(api.sent[0].body.groupId, 'grp1')
  assert.deepEqual(api.calls[0], ['acceptJoin', '123456', '10.0.0.9'])
  assert.ok(!api.calls.includes('identity'), 'join 不需要设备身份')
})

test('group join reports 503 when the host has no binding group', async () => {
  const api = makeApi({ group: null })
  await assert.rejects(
    () => call(api, { method: 'POST', path: '/api/group/join', body: {} }),
    (error) => error.code === 'group/unavailable' && error.status === 503
  )
})

test('group hello accepts only the group secret', async () => {
  const wrong = makeApi()
  await assert.rejects(
    () => call(wrong, { method: 'POST', path: '/api/group/hello', headers: { authorization: 'Bearer dshm_device' } }),
    (error) => error.code === 'auth/unauthorized' && error.status === 401
  )
  await assert.rejects(
    () => call(wrong, { method: 'POST', path: '/api/group/hello' }),
    (error) => error.code === 'auth/unauthorized'
  )

  const api = makeApi()
  await call(api, {
    method: 'POST',
    path: '/api/group/hello',
    headers: { authorization: 'Bearer dshg_secret' }
  })
  assert.equal(api.sent[0].status, 200)
  const body = api.sent[0].body
  assert.equal(body.deviceId, 'HOSTA')
  assert.equal(body.groupId, 'grp1')
  assert.equal(body.port, 48123)
  assert.deepEqual(body.peers, [{ deviceId: 'HOSTB' }])
  assert.equal(body.collabRoot, 'F:\\collab')
})

test('group status requires identity and returns the snapshot', async () => {
  const api = makeApi()
  await call(api, { path: '/api/group' })
  assert.ok(api.calls.includes('identity'))
  assert.equal(api.sent[0].status, 200)
  assert.equal(api.sent[0].body.collabRoot, 'F:\\collab')
  assert.deepEqual(api.sent[0].body.peers, [{ deviceId: 'HOSTB' }])
})

test('invite creates a group when there is none and returns endpoints', async () => {
  const api = makeApi()
  api.group.group = null
  await call(api, { method: 'POST', path: '/api/group/invite' })
  assert.ok(api.calls.some((call) => Array.isArray(call) && call[0] === 'create'))
  const body = api.sent[0].body
  assert.equal(body.invite.code, '123456')
  assert.equal(body.endpoints.length, 1)
  assert.equal(body.collabRoot, 'F:\\collab')
})

test('link forwards the peer address and picks the advertised self url', async () => {
  const api = makeApi()
  await call(api, {
    method: 'POST',
    path: '/api/group/link',
    body: { peerBaseUrl: 'http://10.0.0.2:48123', code: '654321' }
  })
  assert.ok(api.calls.some((call) => Array.isArray(call) && call[0] === 'joinRemote' && call[1] === '654321'))
  assert.equal(api.sent[0].body.joined, true)
  assert.equal(api.sent[0].body.collabRoot, 'F:\\collab')
})

test('collab listing stays inside the collab root', async () => {
  const api = makeApi()
  await call(api, { path: '/api/collab/files', search: '?cwd=F%3A%5Ccollab&since=5' })
  assert.equal(api.sent[0].status, 200)
  assert.equal(api.sent[0].body.cwd, 'F:\\collab')
  assert.deepEqual(api.sent[0].body.files, [{ path: 'a.png', size: 3, since: 5 }])

  const escaping = makeApi()
  await assert.rejects(
    () => call(escaping, { path: '/api/collab/files', search: '?cwd=C%3A%5Cwindows' }),
    (error) => error.code === 'collab/forbidden'
  )
})

test('collab file streams bytes with attachment headers', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-collab-'))
  try {
    writeFileSync(join(dir, 'shot.png'), Buffer.from([1, 2, 3, 4, 5]))
    const api = makeApi({
      absoluteDir: () => dir,
      assertInCollabRoot: () => undefined,
      resolveWorkspaceFile: (root, rel) => ({ target: join(root, rel), info: { size: 5 } })
    })
    const { res } = await call(api, { path: '/api/collab/file', search: '?cwd=x&path=shot.png' })
    assert.equal(res.status, 200)
    assert.equal(res.headers['content-type'], 'image/png')
    assert.equal(res.headers['content-length'], 5)
    assert.match(res.headers['content-disposition'], /shot\.png/)
    assert.equal(res.payload.length, 5)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
