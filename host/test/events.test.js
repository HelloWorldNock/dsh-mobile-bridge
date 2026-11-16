import assert from 'node:assert/strict'
import test from 'node:test'
import { createSessionHub } from '../lib/events.js'

function summary(id, extra = {}) {
  return {
    sessionId: id,
    updatedAt: 1,
    running: false,
    blank: false,
    agentAvailable: true,
    cwd: 'F:\\work',
    projections: { values: { title: { title: id } } },
    ...extra
  }
}

/** 一个能改归档集合、并记录广播帧的最小 Host。 */
function harness(archived = []) {
  const frames = []
  const items = [summary('s1'), summary('s2')]
  const state = { archived: [...archived] }
  const ctx = {
    on() {
      return () => undefined
    },
    workspaceRegistry: {
      get archivedSessionIds() {
        if (state.throws === true) throw new Error('registry not ready')
        return state.archived
      }
    }
  }
  const broadcast = {
    broadcast(name, data) {
      frames.push({ name, data })
    }
  }
  const controller = {
    list: async () => ({ items }),
    follow() {
      throw new Error('not used')
    }
  }
  const hub = createSessionHub({
    ctx,
    controller,
    broadcast,
    logger: { warn() {} }
  })
  return { hub, frames, state, items }
}

test('turns a new archive entry into session.removed', () => {
  const { hub, frames, state } = harness()
  hub.cacheSummary(summary('s1'))
  frames.length = 0

  state.archived.push('s1')
  assert.equal(hub.syncArchive(), true)

  assert.deepEqual(frames.map((frame) => frame.name), ['session.removed'])
  assert.deepEqual(frames[0].data, { sessionId: 's1', archived: true })
  assert.equal(hub.summaries.has('s1'), false)
  // 再对一次账不该重复推帧
  assert.equal(hub.syncArchive(), false)
  assert.equal(frames.length, 1)
  hub.dispose()
})

test('restores a session with session.added when it leaves the archive', () => {
  const { hub, frames, state } = harness(['s1'])
  hub.cacheSummary(summary('s1'))
  frames.length = 0

  state.archived.length = 0
  assert.equal(hub.syncArchive(), true)

  assert.deepEqual(frames.map((frame) => frame.name), ['session.added'])
  assert.equal(frames[0].data.session.id, 's1')
  hub.dispose()
})

test('keeps the baseline when the registry cannot be read', () => {
  const { hub, frames, state } = harness()
  state.throws = true
  assert.equal(hub.syncArchive(), false)
  assert.equal(frames.length, 0)
  hub.dispose()
})

test('seeds the baseline at construction so old archives are not re-announced', () => {
  const { hub, frames } = harness(['s1', 's2'])
  assert.equal(frames.length, 0)
  assert.equal(hub.syncArchive(), false)
  hub.dispose()
})
