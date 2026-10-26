import { randomUUID } from 'node:crypto'
import { approvalPreview } from './preview.js'

const MAX_PLAN_CHARS = 12_000
const MAX_CUSTOM_CHARS = 4_000

function timeoutOf(value, fallback) {
  return Number.isFinite(value) && value >= 1_000 && value <= 600_000 ? value : fallback
}

function questionText(question) {
  return typeof question?.question === 'string' ? question.question : 'Question'
}

function clipPlan(detail) {
  if (typeof detail !== 'string') return null
  return detail.length > MAX_PLAN_CHARS ? `${detail.slice(0, MAX_PLAN_CHARS)}\n…` : detail
}

function validateAnswers(questions, input) {
  if (!Array.isArray(input)) return { error: 'answers must be an array' }
  const byId = new Map()
  for (const item of input) {
    if (item === null || typeof item !== 'object' || typeof item.id !== 'string') {
      return { error: 'each answer needs a question id' }
    }
    if (byId.has(item.id)) return { error: `duplicate answer for ${item.id}` }
    byId.set(item.id, item)
  }
  if (byId.size !== questions.length) return { error: 'every question must be answered exactly once' }

  const answers = []
  for (const question of questions) {
    const item = byId.get(question.id)
    if (item === undefined) return { error: `missing answer for ${question.id}` }
    const selected = Array.isArray(item.selected) ? item.selected.filter((value) => typeof value === 'string') : []
    const options = Array.isArray(question.options) ? question.options : []
    const labels = new Set(options.map((option) => option?.label).filter((label) => typeof label === 'string'))
    if (question.multiSelect !== true && selected.length > 1) {
      return { error: `question ${question.id} accepts one option` }
    }
    if (options.length > 0) {
      for (const value of selected) {
        if (!labels.has(value)) return { error: `unknown option ${value} for ${question.id}` }
      }
      if (selected.length === 0 && (typeof item.custom !== 'string' || item.custom.trim() === '')) {
        return { error: `question ${question.id} needs a selection` }
      }
    } else if (selected.length === 0 && (typeof item.custom !== 'string' || item.custom.trim() === '')) {
      return { error: `question ${question.id} needs an answer` }
    }
    const custom = typeof item.custom === 'string' ? item.custom.trim() : ''
    if (custom.length > MAX_CUSTOM_CHARS) return { error: `custom answer for ${question.id} is too long` }
    answers.push(custom === '' ? { id: question.id, selected } : { id: question.id, selected, custom })
  }
  return { answers }
}

export function createApprovals({ ctx, broadcast, settings, logger, titleFor, onAttention }) {
  const approvals = new Map()
  const questions = new Map()
  const offs = []

  function phoneActive() {
    return settings.phoneFirst !== false && broadcast.hasClients()
  }

  function desktopActive() {
    let gateway
    try {
      gateway = typeof ctx.get === 'function' ? ctx.get('typertGateway') : undefined
    } catch {
      return true
    }
    if (gateway === undefined || typeof gateway.hasLiveClient !== 'function') return true
    try {
      return gateway.hasLiveClient() !== false
    } catch {
      return true
    }
  }

  function emitClosed(kind, entry, outcome, reason) {
    broadcast.broadcast(kind === 'approval' ? 'approval.closed' : 'question.closed', {
      id: entry.id,
      outcome,
      reason,
      sessionId: entry.sessionId
    })
  }

  function finish(kind, entry, outcome, reason, answeredBy) {
    if (entry.resolved) return
    entry.resolved = true
    if (entry.timer !== null) clearTimeout(entry.timer)
    entry.timer = null
    try {
      entry.cleanup?.()
    } catch {
      // ignore
    }
    const map = kind === 'approval' ? approvals : questions
    map.delete(entry.id)

    if (outcome === 'next' && kind === 'approval' && !desktopActive()) {
      emitClosed(kind, entry, 'delegated', reason ?? 'no-desktop')
      entry.resolve('unavailable')
      return
    }

    let value
    if (outcome === 'next') {
      try {
        value = entry.next()
      } catch (error) {
        entry.reject?.(error)
        emitClosed(kind, entry, 'delegated', reason)
        return
      }
    } else if (kind === 'approval') {
      value = outcome
    } else {
      value = { answers: outcome }
    }
    const closedOutcome = outcome === 'next' ? 'delegated' : Array.isArray(outcome) ? 'answered' : outcome
    emitClosed(kind, entry, closedOutcome, reason)
    entry.resolve(value)
  }

  function newEntry(kind, fields, timeoutMs, next, resolve, reject) {
    const now = Date.now()
    const entry = {
      id: `${kind === 'approval' ? 'ap' : 'q'}_${randomUUID()}`,
      kind,
      createdAt: now,
      expiresAt: now + timeoutMs,
      resolved: false,
      timer: null,
      cleanup: null,
      next,
      resolve,
      reject,
      ...fields
    }
    entry.timer = setTimeout(() => finish(kind, entry, 'next', 'timeout'), timeoutMs)
    entry.timer.unref?.()
    return entry
  }

  async function handleApproval(request, next) {
    if (!phoneActive()) return desktopActive() ? next() : 'unavailable'
    const sessionId = request.agent?.session?.id ?? null
    const preview = approvalPreview(request.agent?.session, request.callId)
    const timeoutMs = timeoutOf(settings.approvalTimeoutMs, 120_000)
    let resolve
    let reject
    const promise = new Promise((resolvePromise, rejectPromise) => {
      resolve = resolvePromise
      reject = rejectPromise
    })
    const entry = newEntry(
      'approval',
      {
        sessionId,
        callId: typeof request.callId === 'string' ? request.callId : null,
        toolName: typeof request.toolName === 'string' ? request.toolName : 'tool',
        reason: typeof request.reason === 'string' ? request.reason : null,
        displayReason: typeof request.displayReason === 'string' ? request.displayReason : null,
        preview
      },
      timeoutMs,
      next,
      resolve,
      reject
    )
    const onAbort = () => finish('approval', entry, 'next', 'aborted')
    if (request.signal !== undefined) {
      if (request.signal.aborted) return next()
      request.signal.addEventListener('abort', onAbort, { once: true })
      entry.cleanup = () => request.signal.removeEventListener('abort', onAbort)
    }
    approvals.set(entry.id, entry)
    const payload = {
      id: entry.id,
      kind: 'approval',
      sessionId,
      sessionTitle: titleFor?.(sessionId) ?? null,
      toolName: entry.toolName,
      callId: entry.callId,
      reason: entry.reason,
      displayReason: entry.displayReason,
      preview: entry.preview,
      createdAt: entry.createdAt,
      expiresAt: entry.expiresAt
    }
    broadcast.broadcast('approval.requested', payload)
    try {
      onAttention?.({ kind: 'approval', id: entry.id, title: `审批：${entry.toolName}`, body: entry.preview?.preview ?? entry.displayReason ?? entry.reason ?? 'DSH 请求执行工具', sessionId })
    } catch (error) {
      logger?.warn?.(`[mobile-bridge] approval attention failed: ${String(error)}`)
    }
    return promise
  }

  async function handleQuestion(request, next) {
    if (!phoneActive()) return next()
    if (request.wait?.timed === true) return next()
    const list = Array.isArray(request.questions) ? request.questions : []
    if (list.length === 0) return next()
    const planQuestion = list.find((question) => question?.intent?.kind === 'plan-review')
    const isPlan = planQuestion !== undefined
    const timeoutMs = isPlan
      ? timeoutOf(settings.planReviewTimeoutMs, 180_000)
      : timeoutOf(settings.questionTimeoutMs, 120_000)
    const sessionId = request.agent?.session?.id ?? null
    let resolve
    let reject
    const promise = new Promise((resolvePromise, rejectPromise) => {
      resolve = resolvePromise
      reject = rejectPromise
    })
    const entry = newEntry(
      'question',
      { sessionId, questions: list, plan: clipPlan(planQuestion?.detail), planReview: isPlan },
      timeoutMs,
      next,
      resolve,
      reject
    )
    const onAbort = () => finish('question', entry, 'next', 'aborted')
    if (request.signal !== undefined) {
      if (request.signal.aborted) return next()
      request.signal.addEventListener('abort', onAbort, { once: true })
      entry.cleanup = () => request.signal.removeEventListener('abort', onAbort)
    }
    questions.set(entry.id, entry)
    broadcast.broadcast('question.requested', {
      id: entry.id,
      kind: 'question',
      sessionId,
      sessionTitle: titleFor?.(sessionId) ?? null,
      questions: list,
      plan: entry.plan,
      planReview: isPlan,
      createdAt: entry.createdAt,
      expiresAt: entry.expiresAt
    })
    try {
      onAttention?.({
        kind: isPlan ? 'plan' : 'question',
        id: entry.id,
        title: isPlan ? '计划待审阅' : 'DSH 需要你的选择',
        body: isPlan ? '点按查看计划并批准或提出修改' : questionText(list[0]),
        sessionId
      })
    } catch (error) {
      logger?.warn?.(`[mobile-bridge] question attention failed: ${String(error)}`)
    }
    return promise
  }

  function resolveApproval(id, action) {
    const entry = approvals.get(id)
    if (entry === undefined) return { ok: false, code: 'NOT_FOUND', message: 'approval is no longer pending' }
    const outcome = action === 'allow-once' ? 'allowed-once' : action === 'reject' ? 'rejected' : null
    if (outcome === null) return { ok: false, code: 'BAD_ACTION', message: 'action must be allow-once or reject' }
    finish('approval', entry, outcome, 'phone')
    return { ok: true, outcome }
  }

  function resolveQuestion(id, answers) {
    const entry = questions.get(id)
    if (entry === undefined) return { ok: false, code: 'NOT_FOUND', message: 'question is no longer pending' }
    const validated = validateAnswers(entry.questions, answers)
    if (validated.error !== undefined) return { ok: false, code: 'BAD_ANSWER', message: validated.error }
    finish('question', entry, validated.answers, 'phone')
    return { ok: true }
  }

  function pendingSnapshot() {
    return {
      approvals: [...approvals.values()].map((entry) => ({
        id: entry.id,
        sessionId: entry.sessionId,
        sessionTitle: titleFor?.(entry.sessionId) ?? null,
        toolName: entry.toolName,
        callId: entry.callId,
        reason: entry.reason,
        displayReason: entry.displayReason,
        preview: entry.preview,
        createdAt: entry.createdAt,
        expiresAt: entry.expiresAt
      })),
      questions: [...questions.values()].map((entry) => ({
        id: entry.id,
        sessionId: entry.sessionId,
        sessionTitle: titleFor?.(entry.sessionId) ?? null,
        questions: entry.questions,
        plan: entry.plan,
        planReview: entry.planReview,
        createdAt: entry.createdAt,
        expiresAt: entry.expiresAt
      }))
    }
  }

  /** Delegate every pending card when the last phone disconnects. */
  function revalidate() {
    if (phoneActive()) return
    for (const entry of [...approvals.values()]) finish('approval', entry, 'next', 'disconnected')
    for (const entry of [...questions.values()]) finish('question', entry, 'next', 'disconnected')
  }

  offs.push(ctx.on('approval/request', handleApproval, { prepend: true, global: true }))
  offs.push(ctx.on('user-questions/request', handleQuestion, { prepend: true, global: true }))

  function dispose() {
    for (const off of offs) {
      try {
        off()
      } catch {
        // already gone
      }
    }
    for (const entry of [...approvals.values()]) finish('approval', entry, 'next', 'disposed')
    for (const entry of [...questions.values()]) finish('question', entry, 'next', 'disposed')
  }

  return { resolveApproval, resolveQuestion, pendingSnapshot, revalidate, dispose, approvals, questions }
}
