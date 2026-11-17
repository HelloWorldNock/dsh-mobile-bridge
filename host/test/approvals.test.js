import assert from 'node:assert/strict'
import test from 'node:test'
import { createApprovals } from '../lib/approvals.js'

function stripAgent(request) {
  const projected = {}
  for (const key of Object.keys(request)) {
    if (key === 'agent' || key === 'signal') continue
    projected[key] = request[key]
  }
  return projected
}

function harness({ clients = true, desktop = true, phoneFirst = true, timeouts = {} } = {}) {
  const handlers = new Map()
  const emitted = []
  const clientState = { value: clients }
  const desktopState = { value: desktop }
  const pendingRemoteEvents = new Map()
  const dismissed = []
  const settled = []
  const gateway = {
    hasLiveClient: () => desktopState.value,
    pendingRemoteEvents,
    finishRemoteEvent(entry) {
      dismissed.push(entry.id)
      pendingRemoteEvents.delete(entry.id)
    }
  }
  const ctx = {
    on(name, handler) {
      handlers.set(name, handler)
      return () => handlers.delete(name)
    },
    get(name) {
      return name === 'typertGateway' ? gateway : undefined
    }
  }
  const broadcast = {
    hasClients: () => clientState.value,
    broadcast(name, data) {
      emitted.push({ name, data })
    }
  }
  const settings = { phoneFirst, approvalTimeoutMs: 30_000, questionTimeoutMs: 60_000, planReviewTimeoutMs: 120_000, ...timeouts }
  const approvals = createApprovals({
    ctx,
    broadcast,
    settings,
    logger: { warn() {}, debug() {} },
    titleFor: () => 'Session title'
  })
  /**
   * 模拟网关转发：next() 时登记一条 pending 远程事件，并返回一个不会自己结束的
   * promise —— 桌面端还在等人点按钮。
   */
  function forwardAndWait(request) {
    const id = `ev_${pendingRemoteEvents.size + 1}`
    pendingRemoteEvents.set(id, {
      id,
      frame: { event: request.event, request: stripAgent(request.request) },
      source: { resolve: (value) => settled.push({ id, value }) }
    })
    return new Promise(() => {})
  }
  return {
    approvals,
    emitted,
    dismissed,
    settled,
    pendingRemoteEvents,
    setClients(value) {
      clientState.value = value
    },
    setDesktop(value) {
      desktopState.value = value
    },
    dispatch(name, request, next) {
      const handler = handlers.get(name)
      assert.equal(typeof handler, 'function')
      return handler(request, next)
    },
    forwardAndWait
  }
}

test('takes an approval on the phone and resolves allowed-once', async () => {
  const harnessed = harness({ desktop: false })
  const pending = harnessed.dispatch(
    'approval/request',
    {
      toolName: 'bash',
      callId: 'c1',
      displayReason: 'Run a command',
      agent: {
        session: {
          id: 's1',
          snapshotEvents: () => [
            { type: 'tool/call', data: { callId: 'c1', name: 'bash', arguments: '{"command":"dir"}', turn: 2, step: 1 } }
          ]
        }
      }
    },
    async () => 'desktop'
  )
  const requested = harnessed.emitted.find((item) => item.name === 'approval.requested')
  assert.equal(requested.data.toolName, 'bash')
  assert.equal(requested.data.preview.preview, 'dir')
  assert.equal(requested.data.dual, false)

  assert.deepEqual(harnessed.approvals.resolveApproval(requested.data.id, 'allow-once'), { ok: true, outcome: 'allowed-once' })
  assert.equal(await pending, 'allowed-once')
  assert.equal(harnessed.emitted.at(-1).name, 'approval.closed')
  assert.equal(harnessed.emitted.at(-1).data.answeredBy, 'phone')
})

test('answers a question with exactly one selection per question', async () => {
  const harnessed = harness({ desktop: false })
  const pending = harnessed.dispatch(
    'user-questions/request',
    {
      questions: [{ id: 'q1', question: 'Pick one', options: [{ label: 'A' }, { label: 'B' }] }],
      agent: { session: { id: 's1' } }
    },
    async () => 'desktop'
  )
  const requested = harnessed.emitted.find((item) => item.name === 'question.requested')
  assert.equal(harnessed.approvals.resolveQuestion(requested.data.id, [{ id: 'q1', selected: ['C'] }]).code, 'BAD_ANSWER')
  assert.deepEqual(harnessed.approvals.resolveQuestion(requested.data.id, [{ id: 'q1', selected: ['B'] }]), { ok: true })
  assert.deepEqual(await pending, { answers: [{ id: 'q1', selected: ['B'] }] })
})

test('exposes plan-review detail and approval flag', async () => {
  const harnessed = harness({ desktop: false })
  const pending = harnessed.dispatch(
    'user-questions/request',
    {
      questions: [
        {
          id: 'q1',
          question: 'Approve the plan?',
          detail: '# Plan\n\n1. Build it',
          options: [{ label: 'Approve' }, { label: 'Revise' }],
          intent: { kind: 'plan-review', approve: 'Approve' }
        }
      ]
    },
    async () => 'desktop'
  )
  const requested = harnessed.emitted.find((item) => item.name === 'question.requested')
  assert.equal(requested.data.planReview, true)
  assert.match(requested.data.plan, /Build it/)
  harnessed.approvals.resolveQuestion(requested.data.id, [{ id: 'q1', selected: ['Approve'] }])
  assert.deepEqual(await pending, { answers: [{ id: 'q1', selected: ['Approve'] }] })
})

test('keeps the card for a reconnecting phone even when no phone is connected', async () => {
  const harnessed = harness({ clients: false })
  const pending = harnessed.dispatch('approval/request', { toolName: 'bash', callId: 'c1' }, async () => 'desktop')
  // 手机断线不等于「不要这张卡」：请求先落进待办，桌面照旧拿到它。
  const requested = harnessed.emitted.find((item) => item.name === 'approval.requested')
  assert.equal(requested.data.toolName, 'bash')
  assert.equal(harnessed.approvals.pendingSnapshot().approvals.length, 1)
  assert.equal(await pending, 'desktop')
  assert.equal(harnessed.approvals.approvals.size, 0)
})

test('keeps a plan review pending for a phone that is not connected', async () => {
  const harnessed = harness({ clients: false })
  const request = {
    questions: [
      {
        id: 'q1',
        question: 'Approve the plan?',
        detail: '# Plan\n\n1. Build it',
        options: [{ label: 'Approve' }, { label: 'Revise' }],
        intent: { kind: 'plan-review', approve: 'Approve' }
      }
    ],
    agent: { session: { id: 's1' } }
  }
  const pending = harnessed.dispatch('user-questions/request', request, () => harnessed.forwardAndWait({ event: 'user-questions/request', request }))
  const snapshot = harnessed.approvals.pendingSnapshot()
  assert.equal(snapshot.questions.length, 1)
  assert.equal(snapshot.questions[0].planReview, true)
  assert.match(snapshot.questions[0].plan, /Build it/)
  // 手机重连后按这张卡作答，桌面那张随之退掉。
  assert.deepEqual(harnessed.approvals.resolveQuestion(snapshot.questions[0].id, [{ id: 'q1', selected: ['Approve'] }]), { ok: true })
  assert.deepEqual(await pending, { answers: [{ id: 'q1', selected: ['Approve'] }] })
})

test('rejects allow-always: only allow-once and reject are implemented', async () => {
  // API.md 曾经承诺 allow-always，但实现只认两个值。这条断言把「契约别撒谎」钉住：
  // 要么实现持久化允许（R27），要么就明确拒绝——绝不能静默接受却没真的记住。
  const harnessed = harness({ desktop: false })
  const pending = harnessed.dispatch(
    'approval/request',
    { toolName: 'pwsh', callId: 'c-aw', agent: { session: { id: 's-aw' } } },
    async () => 'desktop'
  )
  const snapshot = harnessed.approvals.pendingSnapshot()
  assert.equal(snapshot.approvals.length, 1)
  const card = snapshot.approvals[0]

  const result = harnessed.approvals.resolveApproval(card.id, 'allow-always')
  assert.equal(result.ok, false)
  assert.equal(result.code, 'BAD_ACTION')

  // 卡片必须还挂着（被拒的 action 不能顺手把卡片结掉）
  assert.equal(harnessed.approvals.pendingSnapshot().approvals.length, 1)

  // 用合法动作收尾，避免测试里留一个悬挂 promise
  assert.deepEqual(harnessed.approvals.resolveApproval(card.id, 'allow-once'), { ok: true, outcome: 'allowed-once' })
  assert.deepEqual(await pending, 'allowed-once')
})

test('fails closed on timeout: nobody answers means unavailable, never allowed', async () => {
  // 审批超时必须是 fail-closed。这条最容易在改动 approval 逻辑时被写坏成「默认放行」，
  // 所以单独钉一条：超时后 waterfall 拿到的是 unavailable，且不会出现 allowed* 的结局。
  const harnessed = harness({ desktop: false, timeouts: { approvalTimeoutMs: 40 } })
  const pending = harnessed.dispatch(
    'approval/request',
    { toolName: 'pwsh', callId: 'c-timeout', agent: { session: { id: 's-timeout' } } },
    async () => 'desktop'
  )
  assert.equal(harnessed.approvals.pendingSnapshot().approvals.length, 1)

  const result = await pending
  assert.equal(result, 'unavailable', '超时必须 fail-closed，不能变成 allowed')

  const closed = harnessed.emitted.filter((item) => item.name === 'approval.closed')
  const outcomes = closed.map((item) => item.data?.outcome ?? item.data?.status ?? null)
  assert.ok(
    !outcomes.some((outcome) => typeof outcome === 'string' && outcome.startsWith('allowed')),
    `超时路径不该产生 allowed 结局，实际：${JSON.stringify(outcomes)}`
  )
})

test('returns unavailable when neither a phone nor a desktop is present', async () => {
  const harnessed = harness({ clients: false, desktop: false })
  const result = await harnessed.dispatch('approval/request', { toolName: 'bash', callId: 'c1' }, async () => 'desktop')
  assert.equal(result, 'unavailable')
})

test('lets the desktop win and closes the phone card', async () => {
  const harnessed = harness()
  let answerDesktop
  const pending = harnessed.dispatch(
    'approval/request',
    { toolName: 'bash', callId: 'c1', agent: { session: { id: 's1' } } },
    () => new Promise((resolvePromise) => {
      answerDesktop = resolvePromise
    })
  )
  const requested = harnessed.emitted.find((item) => item.name === 'approval.requested')
  assert.equal(requested.data.dual, true)
  answerDesktop('rejected')
  assert.equal(await pending, 'rejected')
  const closed = harnessed.emitted.filter((item) => item.name === 'approval.closed')
  assert.equal(closed.length, 1)
  assert.equal(closed[0].data.answeredBy, 'desktop')
  assert.equal(harnessed.approvals.approvals.size, 0)
})

test('answers on the phone first and cancels the forwarded desktop card', async () => {
  const harnessed = harness()
  const request = { toolName: 'bash', callId: 'c1', agent: { session: { id: 's1' } } }
  const pending = harnessed.dispatch(
    'approval/request',
    request,
    () => harnessed.forwardAndWait({ event: 'approval/request', request })
  )
  const requested = harnessed.emitted.find((item) => item.name === 'approval.requested')
  assert.equal(harnessed.pendingRemoteEvents.size, 1)
  harnessed.approvals.resolveApproval(requested.data.id, 'allow-once')
  assert.equal(await pending, 'allowed-once')
  assert.deepEqual(harnessed.dismissed, ['ev_1'])
  assert.deepEqual(harnessed.settled, [{ id: 'ev_1', value: { kind: 'next' } }])
  assert.equal(harnessed.pendingRemoteEvents.size, 0)
})

test('keeps waiting for the phone when the desktop round yields no answer', async () => {
  const harnessed = harness()
  const pending = harnessed.dispatch(
    'approval/request',
    { toolName: 'bash', callId: 'c1', agent: { session: { id: 's1' } } },
    async () => 'unavailable'
  )
  const requested = harnessed.emitted.find((item) => item.name === 'approval.requested')
  harnessed.approvals.resolveApproval(requested.data.id, 'reject')
  assert.equal(await pending, 'rejected')
})

test('keeps the phone card across a disconnect while the desktop is open', async () => {
  const harnessed = harness()
  let answerDesktop
  const pending = harnessed.dispatch(
    'approval/request',
    { toolName: 'bash', callId: 'c1', agent: { session: { id: 's1' } } },
    () => new Promise((resolvePromise) => {
      answerDesktop = resolvePromise
    })
  )
  harnessed.emitted.length = 0
  harnessed.setClients(false)
  harnessed.approvals.revalidate()
  // 桌面还开着：卡片留在待办里，手机重连后 /api/pending 还能拿到它。
  assert.deepEqual(harnessed.emitted, [])
  assert.equal(harnessed.approvals.pendingSnapshot().approvals.length, 1)
  answerDesktop('allowed-once')
  assert.equal(await pending, 'allowed-once')
  assert.equal(harnessed.approvals.approvals.size, 0)
})

test('delegates pending cards when the last phone disconnects and no desktop is present', async () => {
  const harnessed = harness({ desktop: false })
  const pending = harnessed.dispatch('approval/request', { toolName: 'bash', callId: 'c1' }, async () => 'desktop')
  harnessed.emitted.length = 0
  harnessed.setClients(false)
  harnessed.approvals.revalidate()
  assert.equal(await pending, 'unavailable')
  assert.deepEqual(harnessed.emitted.map((item) => [item.name, item.data.reason]), [['approval.closed', 'disconnected']])
})
