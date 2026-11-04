import { randomUUID } from 'node:crypto'
import { approvalPreview } from './preview.js'

const MAX_PLAN_CHARS = 12_000
const MAX_CUSTOM_CHARS = 4_000

/**
 * 桌面端没有真正作答时 waterfall 会落到这些兜底值上。它们不能算「有人在电脑上处理
 * 完了」，否则手机侧还开着的卡片会被一条没人看过的结果顶掉。
 */
const PASSIVE_OUTCOMES = new Set(['unavailable', 'cancelled'])

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

/**
 * 请求投影：网关转发 waterfall 时会把 `agent`/`signal` 剔掉，剩下 own enumerable
 * 的字符串键按原顺序拷贝。这里做同样的投影，才能和 `pending.frame.request` 对得上。
 */
function projectRequest(request) {
  if (request === null || typeof request !== 'object') return {}
  const projected = {}
  for (const key of Object.keys(request)) {
    if (key === 'agent' || key === 'signal') continue
    projected[key] = request[key]
  }
  return projected
}

function sameRequest(left, right) {
  try {
    return JSON.stringify(left) === JSON.stringify(right)
  } catch {
    return false
  }
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

  function gatewayOf() {
    try {
      return typeof ctx.get === 'function' ? ctx.get('typertGateway') : undefined
    } catch {
      return undefined
    }
  }

  function desktopActive() {
    const gateway = gatewayOf()
    if (gateway === undefined || typeof gateway.hasLiveClient !== 'function') return true
    try {
      return gateway.hasLiveClient() !== false
    } catch {
      return true
    }
  }

  function emitClosed(kind, entry, outcome, reason, answeredBy) {
    if (entry.closedEmitted === true) return
    entry.closedEmitted = true
    broadcast.broadcast(kind === 'approval' ? 'approval.closed' : 'question.closed', {
      id: entry.id,
      outcome,
      reason,
      answeredBy: answeredBy ?? null,
      sessionId: entry.sessionId
    })
  }

  function mapFor(kind) {
    return kind === 'approval' ? approvals : questions
  }

  function clearTimer(entry) {
    if (entry.timer !== null) clearTimeout(entry.timer)
    entry.timer = null
  }

  function runCleanup(entry) {
    try {
      entry.cleanup?.()
    } catch {
      // ignore
    }
    entry.cleanup = null
  }

  /**
   * 手机侧收卡：把这一条从待办里摘掉并广播 closed。桌面侧的卡片是否需要一起退，
   * 由调用方决定（手机作答要退，手机超时/断连不能退）。
   */
  function closePhone(kind, entry, outcome, reason, answeredBy) {
    if (!entry.phoneOpen) return false
    entry.phoneOpen = false
    clearTimer(entry)
    runCleanup(entry)
    mapFor(kind).delete(entry.id)
    emitClosed(kind, entry, outcome, reason, answeredBy)
    return true
  }

  /**
   * 手机先答：桌面那张已经转发出去的卡片必须退掉。
   *
   * 网关给这条请求建过一个 `pendingRemoteEvents` 条目，每条投递都带着自己的
   * deliverySignal；`finishRemoteEvent` 会给每个投递推一帧 `cancel`，客户端据此
   * abort 掉 waterfall 的 signal，卡片在自己的 finally 里移除。工具调用的 signal
   * 完全不参与，所以工具不会被取消。
   */
  function dismissDesktop(entry) {
    const desktop = entry.desktop
    if (desktop === null || desktop.dismissed) return
    desktop.dismissed = true
    const gateway = gatewayOf()
    const pending = gateway?.pendingRemoteEvents
    if (pending === undefined || typeof pending.values !== 'function' || typeof gateway.finishRemoteEvent !== 'function') {
      logger?.debug?.('[mobile-bridge] no forwarded remote event registry; desktop card stays until dismissed by hand')
      return
    }
    let dismissed = false
    for (const item of [...pending.values()]) {
      if (item?.frame?.event !== desktop.event) continue
      if (!sameRequest(item.frame.request, desktop.request)) continue
      try {
        gateway.finishRemoteEvent(item)
        item.source?.resolve?.({ kind: 'next' })
        dismissed = true
      } catch (error) {
        logger?.warn?.(`[mobile-bridge] dismiss forwarded ${desktop.event} failed: ${String(error)}`)
      }
    }
    if (!dismissed) {
      logger?.debug?.(`[mobile-bridge] forwarded ${desktop.event} already left the registry`)
    }
  }

  /**
   * 把这次请求同时推到桌面：调用 `next()` 让 api-remotes 转发，转发结果既可能是
   * 人真的点了按钮，也可能是没有客户端时的兜底值，`settleFromDesktop` 负责区分。
   */
  function startDesktop(kind, event, request, next) {
    let forwarded
    try {
      forwarded = next()
    } catch (error) {
      return { event, request: projectRequest(request), promise: Promise.resolve({ ok: false, error }), dismissed: false }
    }
    const promise = Promise.resolve(forwarded).then(
      (value) => ({ ok: true, value }),
      (error) => ({ ok: false, error })
    )
    return { event, request: projectRequest(request), promise, dismissed: false }
  }

  /** 桌面先处理完：退掉手机卡片，并把同一个结果交回 waterfall。 */
  function settleFromDesktop(kind, entry, result, phonePromise) {
    if (entry.resolved) return entry.value
    const passive = result.ok !== true || (kind === 'approval' && PASSIVE_OUTCOMES.has(result.value))
    if (passive) {
      // 桌面没有真正作答（没有在线客户端、事件被取消或转发链路报错）。
      if (entry.phoneOpen) return phonePromise
      entry.resolved = true
      clearTimer(entry)
      runCleanup(entry)
      const value = kind === 'approval' ? 'unavailable' : { answers: [] }
      entry.value = value
      entry.resolve(value)
      return value
    }
    const value = kind === 'approval' ? result.value : result.value?.answers !== undefined ? result.value : { answers: result.value }
    entry.resolved = true
    entry.value = value
    closePhone(kind, entry, kind === 'approval' ? (typeof value === 'string' ? value : 'answered') : 'answered', 'desktop', 'desktop')
    entry.resolve(value)
    return value
  }

  /** 手机作答：settle 手机 promise，并让桌面那张卡片退出。 */
  function settlePhone(kind, entry, outcome, reason) {
    const value = kind === 'approval' ? outcome : { answers: outcome }
    entry.resolved = true
    entry.value = value
    closePhone(kind, entry, kind === 'approval' ? outcome : 'answered', reason, 'phone')
    dismissDesktop(entry)
    entry.resolve(value)
    return value
  }

  /** 手机侧过期或断开：只关手机，桌面还在看就继续等桌面。 */
  function expirePhone(kind, entry, reason) {
    if (!entry.phoneOpen) return
    closePhone(kind, entry, 'expired', reason, 'phone')
    if (entry.desktop !== null) return
    // 没有桌面分支：维持旧行为，把决定权交回 DSH（无桌面客户端时回报 unavailable）。
    finishDelegated(kind, entry, reason)
  }

  /** 旧路径：没有手机接管，或手机侧已过期且没有桌面分支。 */
  function finishDelegated(kind, entry, reason) {
    if (entry.resolved) return
    entry.resolved = true
    clearTimer(entry)
    runCleanup(entry)
    mapFor(kind).delete(entry.id)
    if (kind === 'approval' && !desktopActive()) {
      emitClosed(kind, entry, 'delegated', reason ?? 'no-desktop', 'desktop')
      entry.resolve('unavailable')
      return
    }
    let value
    try {
      value = entry.next()
    } catch (error) {
      entry.reject?.(error)
      emitClosed(kind, entry, 'delegated', reason, 'desktop')
      return
    }
    entry.value = value
    emitClosed(kind, entry, 'delegated', reason, 'desktop')
    entry.resolve(value)
  }

  function newEntry(kind, fields, timeoutMs, next, resolve, reject) {
    const now = Date.now()
    const entry = {
      id: `${kind === 'approval' ? 'ap' : 'q'}_${randomUUID()}`,
      kind,
      createdAt: now,
      expiresAt: now + timeoutMs,
      phoneOpen: true,
      resolved: false,
      value: undefined,
      desktop: null,
      timer: null,
      cleanup: null,
      next,
      resolve,
      reject,
      ...fields
    }
    entry.timer = setTimeout(() => expirePhone(kind, entry, 'timeout'), timeoutMs)
    entry.timer.unref?.()
    return entry
  }

  /**
   * 双端并行等待：手机卡片与桌面转发同时在跑，谁先给出结果就用谁。
   * 桌面先答时会广播 closed 让手机撤卡；手机先答时会 cancel 桌面那张转发卡。
   */
  function raceDesktop(kind, entry, phonePromise, callNext) {
    const desktop = startDesktop(kind, kind === 'approval' ? 'approval/request' : 'user-questions/request', entry.request, callNext)
    entry.desktop = desktop
    const phoneBranch = phonePromise.then((value) => {
      dismissDesktop(entry)
      return value
    })
    const desktopBranch = desktop.promise.then((result) => settleFromDesktop(kind, entry, result, phonePromise))
    return Promise.race([phoneBranch, desktopBranch])
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
        preview,
        request
      },
      timeoutMs,
      next,
      resolve,
      reject
    )
    if (request.signal !== undefined && request.signal.aborted) {
      return desktopActive() ? next() : 'unavailable'
    }
    const onAbort = () => {
      // 工具调用自己取消了：手机卡片必然作废；桌面那张由网关按同一条 signal 撤掉。
      if (entry.desktop !== null) closePhone('approval', entry, 'expired', 'aborted', 'phone')
      else finishDelegated('approval', entry, 'aborted')
    }
    if (request.signal !== undefined) {
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
      expiresAt: entry.expiresAt,
      dual: desktopActive()
    }
    broadcast.broadcast('approval.requested', payload)
    try {
      onAttention?.({ kind: 'approval', id: entry.id, title: `审批：${entry.toolName}`, body: entry.preview?.preview ?? entry.displayReason ?? entry.reason ?? 'DSH 请求执行工具', sessionId })
    } catch (error) {
      logger?.warn?.(`[mobile-bridge] approval attention failed: ${String(error)}`)
    }
    if (!desktopActive()) return promise
    return raceDesktop('approval', entry, promise, next)
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
      { sessionId, questions: list, plan: clipPlan(planQuestion?.detail), planReview: isPlan, request },
      timeoutMs,
      next,
      resolve,
      reject
    )
    if (request.signal !== undefined && request.signal.aborted) return next()
    const onAbort = () => {
      if (entry.desktop !== null) closePhone('question', entry, 'expired', 'aborted', 'phone')
      else finishDelegated('question', entry, 'aborted')
    }
    if (request.signal !== undefined) {
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
      expiresAt: entry.expiresAt,
      dual: desktopActive()
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
    if (!desktopActive()) return promise
    return raceDesktop('question', entry, promise, next)
  }

  function resolveApproval(id, action) {
    const entry = approvals.get(id)
    if (entry === undefined) return { ok: false, code: 'NOT_FOUND', message: 'approval is no longer pending' }
    const outcome = action === 'allow-once' ? 'allowed-once' : action === 'reject' ? 'rejected' : null
    if (outcome === null) return { ok: false, code: 'BAD_ACTION', message: 'action must be allow-once or reject' }
    settlePhone('approval', entry, outcome, 'phone')
    return { ok: true, outcome }
  }

  function resolveQuestion(id, answers) {
    const entry = questions.get(id)
    if (entry === undefined) return { ok: false, code: 'NOT_FOUND', message: 'question is no longer pending' }
    const validated = validateAnswers(entry.questions, answers)
    if (validated.error !== undefined) return { ok: false, code: 'BAD_ANSWER', message: validated.error }
    settlePhone('question', entry, validated.answers, 'phone')
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

  /**
   * 最后一部手机断开时收掉手机侧卡片。桌面还开着的话继续等桌面作答，
   * 不把决定权抢回给 DSH。
   */
  function revalidate() {
    if (phoneActive()) return
    for (const entry of [...approvals.values()]) expirePhone('approval', entry, 'disconnected')
    for (const entry of [...questions.values()]) expirePhone('question', entry, 'disconnected')
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
    for (const entry of [...approvals.values()]) finishDelegated('approval', entry, 'disposed')
    for (const entry of [...questions.values()]) finishDelegated('question', entry, 'disposed')
  }

  return { resolveApproval, resolveQuestion, pendingSnapshot, revalidate, dispose, approvals, questions }
}
