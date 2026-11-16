import test from 'node:test'
import assert from 'node:assert/strict'

import { isSubagentAddressError, subagentAddress } from '../lib/history.js'

test('recognises the host subagent-address rejection', () => {
  assert.equal(isSubagentAddressError({ code: 'session/agent-busy' }), true)
  assert.equal(
    isSubagentAddressError(new Error('subagent Sessions require their durable parent address')),
    true,
  )
  assert.equal(isSubagentAddressError(new Error('boom')), false)
  assert.equal(isSubagentAddressError(undefined), false)
})

test('resolves a durable parent address from the session list', async () => {
  const controller = {
    list: async () => ({ items: [{ sessionId: 'child', parentSessionId: 'parent', origin: 'subagent' }] }),
  }
  assert.deepEqual(await subagentAddress(controller, 'child', new AbortController().signal), {
    kind: 'subagent',
    parentSessionId: 'parent',
    childSessionId: 'child',
    mode: 'unknown',
  })
})

test('gives up when the parent is unknown', async () => {
  assert.equal(await subagentAddress({ list: async () => ({ items: [] }) }, 'child'), null)
  assert.equal(
    await subagentAddress(
      {
        list: async () => {
          throw new Error('nope')
        },
      },
      'child',
    ),
    null,
  )
})
