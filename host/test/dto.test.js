import assert from 'node:assert/strict'
import test from 'node:test'
import { planOf, permissionOf, projectEvent, projectRecords, projectStreamFrame, serializeSummary, titleOf, toolArgumentPreview } from '../lib/dto.js'

test('reads title, plan and permission projections', () => {
  const projections = {
    values: {
      title: { title: 'Build the bridge' },
      plan: { active: true, pending: true },
      permissions: { currentValue: 'workspace-write' }
    }
  }
  assert.equal(titleOf(projections), 'Build the bridge')
  assert.deepEqual(planOf(projections), { active: true, pending: true })
  assert.equal(permissionOf(projections), 'workspace-write')
})

test('accepts a plain string title', () => {
  assert.equal(titleOf({ values: { title: 'Plain' } }), 'Plain')
})

test('serializes a session summary for the phone', () => {
  const value = serializeSummary({
    sessionId: 's1',
    updatedAt: 123,
    running: true,
    blank: false,
    agentAvailable: true,
    cwd: 'F:\\work',
    parentSessionId: null,
    origin: 'subagent',
    projections: { values: { title: { title: 'T' }, plan: { active: false, pending: false }, permissions: { currentValue: 'read-only' } } }
  })
  assert.deepEqual(value, {
    id: 's1',
    title: 'T',
    cwd: 'F:\\work',
    updatedAt: 123,
    running: true,
    blank: false,
    agentAvailable: true,
    parentSessionId: null,
    origin: 'subagent',
    permission: 'read-only',
    plan: { active: false, pending: false }
  })
})

test('projects timeline events and drops log-only ones', () => {
  const user = projectEvent({ type: 'user/message', seq: 1, time: 10, data: { content: [{ type: 'text', text: 'hello' }] } })
  assert.equal(user.kind, 'user')
  assert.equal(user.text, 'hello')

  const call = projectEvent({ type: 'tool/call', seq: 2, time: 11, data: { callId: 'c1', name: 'bash', arguments: '{"command":"dir"}' } })
  assert.equal(call.kind, 'tool-call')
  assert.equal(call.preview, 'dir')

  assert.equal(projectEvent({ type: 'request/header', seq: 3, data: {} }), null)
})

test('projects history records and stream deltas', () => {
  const records = projectRecords([
    { type: 'event', event: { type: 'user/message', seq: 1, data: { content: [{ type: 'text', text: 'a' }] } } },
    { type: 'event', event: { type: 'turn/end', seq: 2, data: { turn: 0, reason: 'done' } } }
  ])
  assert.deepEqual(records.map((item) => item.kind), ['user', 'turn'])

  assert.deepEqual(projectStreamFrame({ type: 'chunk', chunk: { type: 'text-delta', index: 0, text: 'hi' } }), {
    phase: 'delta',
    kind: 'text',
    index: 0,
    text: 'hi'
  })
})

test('prefers useful tool arguments for previews', () => {
  assert.equal(toolArgumentPreview('{"path":"C:\\\\tmp\\\\a.txt","description":"read"}'), 'C:\\tmp\\a.txt')
  assert.equal(toolArgumentPreview('{"foo":"bar"}'), '{"foo":"bar"}')
  assert.equal(toolArgumentPreview('not json'), 'not json')
})

test('keeps the turn/end reason of either host generation', () => {
  const legacy = projectEvent({ type: 'turn/end', seq: 1, data: { turn: 0, reason: 'done' } })
  assert.equal(legacy.reason, 'done')

  // 0.2.x 起 reason 是 { kind }，手机端要能读出 completed / aborted / max-tokens。
  const current = projectEvent({ type: 'turn/end', seq: 2, data: { turn: 1, reason: { kind: 'max-tokens' } } })
  assert.equal(current.reason, 'max-tokens')

  const absent = projectEvent({ type: 'turn/end', seq: 3, data: { turn: 2 } })
  assert.equal(absent.reason, null)
})
