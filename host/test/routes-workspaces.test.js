import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createWorkspaceRoutes } from '../lib/routes/workspaces.js'

/** 工作区路由族（R21 第一刀）：直接对着模块测，不经过 HTTP。 */

function makeApi(overrides = {}) {
  const sent = []
  const api = {
    sent,
    sendJson: (res, status, body) => sent.push({ status, body }),
    readJson: async () => ({}),
    workspaceList: () => [
      { id: 'w1', path: 'F:\\work', title: 'work', updatedAt: 5, sessionIds: ['s1', 's2'] }
    ],
    workspaceRoot: () => 'F:\\root',
    archivedSessionIdSet: () => new Set(['s2']),
    workspaces: {
      supports: () => true,
      resolveByPath: async () => undefined,
      create: async (path, title) => ({ id: 'w2', path, title, updatedAt: 9, sessionIds: [] })
    },
    ...overrides
  }
  return api
}

function call(api, { method = 'GET', path = '/api/workspaces', body = undefined } = {}) {
  const handler = createWorkspaceRoutes({ ...api, readJson: async () => body ?? {} })
  const req = {}
  const res = {}
  return handler({ req, res, url: new URL(`http://bridge.local${path}`), method, path })
}

test('GET returns workspaces with archived sessions filtered out', async () => {
  const api = makeApi()
  const handled = await call(api)
  assert.equal(handled, true)
  const { status, body } = api.sent[0]
  assert.equal(status, 200)
  assert.equal(body.root, 'F:\\root')
  assert.deepEqual(body.workspaces[0].sessionIds, ['s1'])
  assert.deepEqual(body.archivedSessionIds, ['s2'])
  assert.equal(body.workspaces[0].updatedAt, 5)
})

test('POST refuses when the desktop has no default root', async () => {
  const api = makeApi({ workspaceRoot: () => null })
  await assert.rejects(
    () => call(api, { method: 'POST', body: { name: 'x' } }),
    (error) => error.code === 'workspace/no-root' && error.status === 409
  )
})

test('POST rejects unusable folder names', async () => {
  const api = makeApi()
  await assert.rejects(
    () => call(api, { method: 'POST', body: { name: '..' } }),
    (error) => error.code === 'workspace/bad-name' && error.status === 400
  )
})

test('POST reports 503 when the host cannot create workspaces', async () => {
  const api = makeApi({
    workspaces: { supports: () => false, resolveByPath: async () => undefined, create: async () => ({}) }
  })
  await assert.rejects(
    () => call(api, { method: 'POST', body: { name: '周报' } }),
    (error) => error.code === 'workspace/unavailable' && error.status === 503
  )
})

test('POST returns an already registered workspace without recreating it', async () => {
  const created = []
  const api = makeApi({
    workspaces: {
      supports: () => true,
      resolveByPath: async (path) => ({ id: 'w9', path, title: '已有', updatedAt: '2026-01-01T00:00:00Z', sessionIds: ['s9'] }),
      create: async (path, title) => {
        created.push([path, title])
        return {}
      }
    }
  })
  const handled = await call(api, { method: 'POST', body: { name: '已有目录' } })
  assert.equal(handled, true)
  assert.deepEqual(created, [])
  const { status, body } = api.sent[0]
  assert.equal(status, 200)
  assert.equal(body.workspace.id, 'w9')
  assert.equal(typeof body.workspace.updatedAt, 'number')
})

test('the handler ignores unrelated routes', async () => {
  const api = makeApi()
  assert.equal(await call(api, { path: '/api/sessions' }), false)
  assert.equal(api.sent.length, 0)
})
