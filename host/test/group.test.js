import test from 'node:test'
import assert from 'node:assert/strict'
import { createGroup, normalizeBaseUrl } from '../lib/group.js'
import { BridgeError } from '../lib/auth.js'

function harness({ fetchImpl = null } = {}) {
  const state = { deviceId: 'HOSTA', hostName: 'PC-A', group: null, peers: [] }
  const saves = []
  const group = createGroup({
    state,
    save: async () => saves.push(Date.now()),
    logger: { info() {}, warn() {} },
    port: 48123,
    now: () => Date.now(),
    fetchImpl,
    heartbeatMs: 0
  })
  return { state, saves, group }
}

test('creates a group with a one-time invite', () => {
  const { group, state } = harness()
  const created = group.create({ name: '设计组' })
  assert.equal(created.group.name, '设计组')
  assert.match(created.invite.code, /^\d{6}$/)
  assert.equal(state.group.id, created.group.id)
  assert.equal(JSON.stringify(created).includes(state.group.secret), false)

  const joined = group.acceptJoin({ code: created.invite.code, baseUrl: 'http://10.0.0.2:48123', deviceId: 'HOSTB', name: 'PC-B' }, '10.0.0.2')
  assert.equal(joined.groupId, state.group.id)
  assert.equal(joined.secret, state.group.secret)
  assert.equal(joined.deviceId, 'HOSTA')
  assert.equal(state.peers.length, 1)
  assert.equal(state.peers[0].deviceId, 'HOSTB')
  assert.equal(state.peers[0].lastSeenAt === null, false)

  assert.throws(
    () => group.acceptJoin({ code: created.invite.code, baseUrl: 'http://10.0.0.3:48123', deviceId: 'HOSTC', name: 'PC-C' }, '10.0.0.3'),
    (error) => error instanceof BridgeError && error.code === 'group/invite-expired'
  )
})

test('rejects a wrong invite and refuses to join before the group exists', () => {
  const { group } = harness()
  assert.throws(
    () => group.acceptJoin({ code: '000000', baseUrl: 'http://10.0.0.2:48123', deviceId: 'HOSTB', name: 'PC-B' }, '10.0.0.2'),
    (error) => error.code === 'group/not-ready'
  )
  const created = group.create({})
  const code = created.invite.code === '000000' ? '000001' : '000000'
  assert.throws(
    () => group.acceptJoin({ code, baseUrl: 'http://10.0.0.2:48123', deviceId: 'HOSTB', name: 'PC-B' }, '10.0.0.2'),
    (error) => error.code === 'group/bad-invite' && error.status === 401
  )
})

test('joins a remote group and adopts its peers', async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    return {
      ok: true,
      status: 200,
      json: async () => ({
        groupId: 'grp_remote',
        name: '远端组',
        secret: 'dshg_remote',
        deviceId: 'HOSTZ',
        hostName: 'PC-Z',
        port: 48123,
        collabRoot: 'D:\\collab',
        collabWorkspaceId: 'wz',
        peers: [
          { deviceId: 'HOSTZ', name: 'PC-Z', baseUrl: 'http://10.0.0.9:48123' },
          { deviceId: 'HOSTY', name: 'PC-Y', baseUrl: 'http://10.0.0.8:48123' },
          { deviceId: 'HOSTA', name: 'PC-A', baseUrl: 'http://10.0.0.1:48123' }
        ]
      })
    }
  }
  const { group, state, saves } = harness({ fetchImpl })
  const snapshot = await group.joinRemote({
    baseUrl: 'http://10.0.0.9:48123/',
    code: '123456',
    selfBaseUrl: 'http://10.0.0.1:48123',
    collabRoot: 'F:\\collab',
    collabWorkspaceId: 'w9'
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'http://10.0.0.9:48123/api/group/join')
  const body = JSON.parse(calls[0].init.body)
  assert.equal(body.deviceId, 'HOSTA')
  assert.equal(body.baseUrl, 'http://10.0.0.1:48123')
  assert.equal(body.collabRoot, 'F:\\collab')
  assert.equal(body.collabWorkspaceId, 'w9')

  assert.equal(state.group.id, 'grp_remote')
  assert.equal(state.group.secret, 'dshg_remote')
  assert.deepEqual(state.peers.map((peer) => peer.deviceId).sort(), ['HOSTY', 'HOSTZ'])
  const hostZ = state.peers.find((peer) => peer.deviceId === 'HOSTZ')
  assert.equal(hostZ.collabRoot, 'D:\\collab')
  assert.equal(hostZ.collabWorkspaceId, 'wz')
  assert.equal(group.secretMatches('dshg_remote'), true)
  assert.equal(group.secretMatches('nope'), false)
  assert.equal(snapshot.peers.length, 2)
  assert.ok(saves.length > 0)
})

test('accepts an address pasted without the http:// prefix', async () => {
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(url)
    return {
      ok: true,
      status: 200,
      json: async () => ({ groupId: 'grp_remote', name: '远端组', secret: 'dshg_remote', deviceId: 'HOSTZ', peers: [] })
    }
  }
  const { group, state } = harness({ fetchImpl })
  await group.joinRemote({ baseUrl: '10.0.0.9:48123', code: '123456', selfBaseUrl: '10.0.0.1:48123' })

  assert.equal(calls[0], 'http://10.0.0.9:48123/api/group/join')
  assert.equal(state.group.id, 'grp_remote')
  assert.equal(state.peers[0].baseUrl, 'http://10.0.0.9:48123')
})

test('normalizes self-declared addresses and rejects junk', () => {
  assert.equal(normalizeBaseUrl('192.168.1.10:48123'), 'http://192.168.1.10:48123')
  assert.equal(normalizeBaseUrl('  http://192.168.1.10:48123/  '), 'http://192.168.1.10:48123')
  assert.equal(normalizeBaseUrl('https://dsh-a.tail1.ts.net:48123'), 'https://dsh-a.tail1.ts.net:48123')
  assert.equal(normalizeBaseUrl('ftp://192.168.1.10:48123'), null)
  assert.equal(normalizeBaseUrl('u:p@192.168.1.10:48123'), null)
  assert.equal(normalizeBaseUrl('   '), null)
  assert.equal(normalizeBaseUrl(null), null)
})

test('reports a friendly error when the remote host is unreachable', async () => {
  const fetchImpl = async () => {
    throw new Error('ECONNREFUSED')
  }
  const { group } = harness({ fetchImpl })
  await assert.rejects(
    () => group.joinRemote({ baseUrl: 'http://10.0.0.9:48123', code: '123456' }),
    (error) => error.code === 'group/unreachable' && error.status === 502
  )
  assert.throws(() => group.rotateInvite(), (error) => error.code === 'group/not-ready')
})

test('gossips peers and tracks online status in the heartbeat', async () => {
  let seen = 0
  let firstUrl = null
  const fetchImpl = async (url, init) => {
    seen += 1
    assert.equal(init.headers.authorization, 'Bearer dshg_secret')
    if (firstUrl === null) firstUrl = url
    return {
      ok: true,
      status: 200,
      json: async () => ({
        groupId: 'grp_1',
        deviceId: 'HOSTB',
        hostName: 'PC-B',
        version: '0.9.0',
        peers: [
          { deviceId: 'HOSTB', name: 'PC-B', baseUrl: 'http://10.0.0.2:48123' },
          { deviceId: 'HOSTC', name: 'PC-C', baseUrl: 'http://10.0.0.3:48123' }
        ]
      })
    }
  }
  const { state, group } = harness({ fetchImpl })
  state.group = { id: 'grp_1', name: 'g', secret: 'dshg_secret', createdAt: new Date().toISOString() }
  state.peers = [{ deviceId: 'HOSTB', name: 'PC-B', baseUrl: 'http://10.0.0.2:48123', addedAt: new Date().toISOString(), lastSeenAt: null, version: null, groupId: 'grp_1' }]

  await group.refresh()
  assert.equal(seen, 1)
  assert.equal(firstUrl, 'http://10.0.0.2:48123/api/group/hello')
  assert.equal(state.peers.length, 2)
  assert.equal(state.peers[0].version, '0.9.0')
  assert.notEqual(state.peers[0].lastSeenAt, null)
  assert.equal(state.peers[1].deviceId, 'HOSTC')

  await group.refresh()
  assert.equal(seen, 3, '两台 peer 各探活一次')
  assert.equal(state.peers.length, 2, '已有的 peer 不会被重复添加')
})

test('resolves peers by id, name or prefix and forgets them on demand', () => {
  const { state, group } = harness()
  state.group = { id: 'grp_1', name: 'g', secret: 'dshg_secret', createdAt: new Date().toISOString() }
  group.upsertPeer({ deviceId: 'HOSTB1234', name: 'B 渲染机', baseUrl: 'http://10.0.0.2:48123' })
  assert.equal(group.peerOf('HOSTB1234').name, 'B 渲染机')
  assert.equal(group.peerOf('b 渲染机').deviceId, 'HOSTB1234')
  assert.equal(group.peerOf('1234').deviceId, 'HOSTB1234')
  assert.equal(group.peerOf('nobody'), null)
  assert.throws(() => group.upsertPeer({ deviceId: 'HOSTA', baseUrl: 'http://10.0.0.1:48123' }), (error) => error.code === 'group/bad-peer')

  assert.equal(group.removePeer('HOSTB1234'), true)
  assert.equal(group.removePeer('HOSTB1234'), false)
  assert.equal(group.snapshot().peers.length, 0)
})

test('leaving the group clears the secret and peers', async () => {
  const { state, group } = harness()
  group.create({})
  group.upsertPeer({ deviceId: 'HOSTB', name: 'PC-B', baseUrl: 'http://10.0.0.2:48123' })
  const snapshot = group.leave()
  assert.equal(snapshot.group, null)
  assert.equal(state.peers.length, 0)
  assert.equal(group.secretMatches(state.group?.secret ?? 'x'), false)
})
