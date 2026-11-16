import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSessionAdapter } from '../lib/adapters/dsh/session-adapter.js'
import { createWorkspaceAdapter } from '../lib/adapters/dsh/workspace-adapter.js'

/**
 * 适配层（R23）：宿主 0.1.x / 0.2.x 的形状差异都在这里，测它等于测「换宿主会不会炸」。
 */

test('session adapter normalizes both list shapes', async () => {
  const calls = []
  const itemsShape = createSessionAdapter({
    sessionController: {
      async list(query, signal) {
        calls.push({ query, hasSignal: signal !== undefined })
        return { items: [{ sessionId: 's1' }] }
      }
    }
  })
  assert.deepEqual(await itemsShape.list(new AbortController().signal), [{ sessionId: 's1' }])
  assert.equal(calls[0].hasSignal, true)

  const arrayShape = createSessionAdapter({ sessionController: { list: async () => [{ sessionId: 's2' }] } })
  assert.deepEqual(await arrayShape.list(), [{ sessionId: 's2' }])

  // 形状不认识时给空数组，而不是 undefined（调用方直接 .map）
  const oddShape = createSessionAdapter({ sessionController: { list: async () => null } })
  assert.deepEqual(await oddShape.list(), [])
})

test('session adapter maps positional and object argument shapes', async () => {
  const seen = []
  const adapter = createSessionAdapter({
    sessionController: {
      async prompt(request, signal) {
        seen.push(['prompt', request.sessionId, typeof signal])
        return { accepted: true }
      },
      async cancel(request) {
        seen.push(['cancel', request.sessionId])
      },
      async rename(request) {
        seen.push(['rename', request.sessionId, request.title])
        return { title: request.title }
      },
      async create(request) {
        seen.push(['create', request.workspaceId])
        return { sessionId: 's9' }
      },
      async resolveAgent(sessionId) {
        return { agent: { session: { id: sessionId } } }
      }
    }
  })

  await adapter.prompt({ sessionId: 's1', content: [] }, new AbortController().signal)
  await adapter.cancel('s1')
  assert.deepEqual(await adapter.rename('s1', '新标题'), { title: '新标题' })
  assert.equal((await adapter.create({ workspaceId: 'w1' })).sessionId, 's9')
  assert.equal((await adapter.resolveAgent('s1')).agent.session.id, 's1')

  assert.deepEqual(seen, [
    ['prompt', 's1', 'object'],
    ['cancel', 's1'],
    ['rename', 's1', '新标题'],
    ['create', 'w1']
  ])
})

test('session adapter reports unsupported methods instead of crashing quietly', async () => {
  const adapter = createSessionAdapter({})
  assert.equal(adapter.supports('prompt'), false)
  await assert.rejects(() => adapter.list(), (error) => error.code === 'adapter/unsupported')
  await assert.rejects(() => adapter.cancel('s1'), /sessionController\.cancel/)
})

test('workspace adapter tolerates a missing or broken registry', () => {
  for (const ctx of [undefined, null, {}, { workspaceRegistry: {} }]) {
    const adapter = createWorkspaceAdapter(ctx)
    assert.deepEqual(adapter.list(), [])
    assert.equal(adapter.supports('list'), false)
    assert.equal(adapter.archivedIds().size, 0)
    assert.equal(adapter.archivedIdsOrNull(), null)
  }

  const throwing = createWorkspaceAdapter({
    workspaceRegistry: {
      list() {
        throw new Error('boom')
      },
      get archivedSessionIds() {
        throw new Error('not ready')
      }
    }
  })
  assert.deepEqual(throwing.list(), [])
  assert.equal(throwing.archivedIds().size, 0)
  assert.equal(throwing.archivedIdsOrNull(), null)
})

test('workspace adapter awaits both sync and async resolveByPath', async () => {
  const asyncHost = createWorkspaceAdapter({
    workspaceRegistry: { async resolveByPath(path) { return { id: 'w1', path } } }
  })
  assert.deepEqual(await asyncHost.resolveByPath('/a'), { id: 'w1', path: '/a' })

  const syncHost = createWorkspaceAdapter({ workspaceRegistry: { resolveByPath: (path) => ({ id: 'w2', path }) } })
  assert.deepEqual(await syncHost.resolveByPath('/b'), { id: 'w2', path: '/b' })

  const missing = createWorkspaceAdapter({ workspaceRegistry: {} })
  assert.equal(await missing.resolveByPath('/c'), undefined)

  const nullHost = createWorkspaceAdapter({ workspaceRegistry: { resolveByPath: async () => null } })
  assert.equal(await nullHost.resolveByPath('/d'), undefined)
})

test('workspace adapter keeps the archived set separate from read failure', () => {
  const adapter = createWorkspaceAdapter({ workspaceRegistry: { archivedSessionIds: ['s1', 's2'] } })
  assert.deepEqual([...adapter.archivedIds()].sort(), ['s1', 's2'])
  assert.deepEqual(adapter.archivedIdsOrNull(), ['s1', 's2'])

  const empty = createWorkspaceAdapter({ workspaceRegistry: { archivedSessionIds: [] } })
  assert.equal(empty.archivedIds().size, 0)
  assert.deepEqual(empty.archivedIdsOrNull(), [])
})

test('workspace adapter passes write errors through for the server to map', async () => {
  const busy = Object.assign(new Error('still running'), { name: 'WorkspaceActiveSessionError' })
  const adapter = createWorkspaceAdapter({
    workspaceRegistry: {
      async archiveSession() {
        throw busy
      },
      async unarchiveSession() {
        return true
      }
    }
  })
  await assert.rejects(() => adapter.archive('s1'), (error) => error.name === 'WorkspaceActiveSessionError')
  assert.equal(await adapter.unarchive('s1'), true)

  const unsupported = createWorkspaceAdapter({ workspaceRegistry: {} })
  await assert.rejects(() => unsupported.archive('s1'), (error) => error.code === 'adapter/unsupported')
  await assert.rejects(() => unsupported.unarchive('s1'), /archiveSession|unarchiveSession/)
})

test('workspace adapter detaches only when the workspace supports it', async () => {
  const detached = []
  const adapter = createWorkspaceAdapter({ workspaceRegistry: { list: () => [] } })
  await adapter.detach({ detachSession: async (id) => detached.push(id) }, 's1')
  await adapter.detach({}, 's1')
  await adapter.detach(null, 's1')
  assert.deepEqual(detached, ['s1'])
})
