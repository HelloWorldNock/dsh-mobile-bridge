import { projectEvent, projectRecords, projectStreamFrame, serializeSummary } from './dto.js'

const HEARTBEAT_MS = 20_000
const SLOW_CLIENT_BYTES = 4 * 1024 * 1024
const IDLE_STOP_MS = 60_000

function sseFrame(name, data) {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`
}

export function createBroadcaster({ logger }) {
  const clients = new Set()
  let nextClientId = 1

  function attach(res, meta) {
    const client = {
      id: nextClientId++,
      res,
      closed: false,
      pendingBytes: 0,
      connectedAt: Date.now(),
      deviceId: meta?.deviceId ?? null
    }
    clients.add(client)
    res.on('close', () => {
      client.closed = true
      clients.delete(client)
    })
    res.on('drain', () => {
      client.pendingBytes = 0
    })
    return client
  }

  function send(client, name, data) {
    if (client.closed) return
    const payload = sseFrame(name, data)
    try {
      if (!client.res.write(payload)) client.pendingBytes += payload.length
      if (client.pendingBytes > SLOW_CLIENT_BYTES) {
        logger?.warn?.(`[mobile-bridge] closing slow SSE client ${client.id}`)
        client.closed = true
        client.res.end()
        clients.delete(client)
      }
    } catch {
      client.closed = true
      clients.delete(client)
    }
  }

  function broadcast(name, data, predicate) {
    for (const client of clients) {
      if (predicate !== undefined && !predicate(client)) continue
      send(client, name, data)
    }
  }

  function hasClients() {
    for (const client of clients) if (!client.closed) return true
    return false
  }

  function count() {
    return clients.size
  }

  function closeDevice(deviceId) {
    for (const client of [...clients]) {
      if (client.deviceId !== deviceId) continue
      client.closed = true
      try {
        client.res.end()
      } catch {
        // already gone
      }
      clients.delete(client)
    }
  }

  function closeAll() {
    for (const client of [...clients]) {
      client.closed = true
      try {
        client.res.end()
      } catch {
        // already gone
      }
      clients.delete(client)
    }
  }

  const heartbeat = setInterval(() => {
    for (const client of clients) {
      if (client.closed) continue
      try {
        client.res.write(': ping\n\n')
      } catch {
        client.closed = true
        clients.delete(client)
      }
    }
  }, HEARTBEAT_MS)
  heartbeat.unref?.()

  function dispose() {
    clearInterval(heartbeat)
    for (const client of clients) {
      try {
        client.res.end()
      } catch {
        // already gone
      }
    }
    clients.clear()
  }

  return { attach, send, broadcast, hasClients, count, closeDevice, closeAll, dispose }
}

export function createSessionHub({ ctx, controller, broadcast, logger, onTurnEnd, onTurnError }) {
  const follows = new Map()
  const summaries = new Map()

  function cacheSummary(summary) {
    const item = serializeSummary(summary)
    if (item !== null) summaries.set(item.id, item)
    return item
  }

  function titleFor(sessionId) {
    return summaries.get(sessionId)?.title ?? null
  }

  async function ensureFollow(sessionId) {
    if (typeof sessionId !== 'string' || sessionId === '') return undefined
    const existing = follows.get(sessionId)
    if (existing !== undefined) {
      if (existing.stopTimer !== null) {
        clearTimeout(existing.stopTimer)
        existing.stopTimer = null
      }
      return existing
    }
    const state = {
      sessionId,
      abort: new AbortController(),
      stopTimer: null,
      refs: 0,
      running: summaries.get(sessionId)?.running === true,
      lastAssistantText: '',
      turnStartedAt: null,
      disposed: false
    }
    follows.set(sessionId, state)
    void run(state)
    return state
  }

  function scheduleStop(state) {
    if (state.refs > 0) return
    if (state.stopTimer !== null) clearTimeout(state.stopTimer)
    state.stopTimer = setTimeout(() => {
      if (state.refs > 0) return
      state.disposed = true
      state.abort.abort()
      follows.delete(state.sessionId)
    }, IDLE_STOP_MS)
    state.stopTimer.unref?.()
  }

  function onEvent(state, event) {
    const item = projectEvent(event)
broadcast.broadcast('session.event', { sessionId: state.sessionId, event, item })

    if (event.type === 'turn/start') {
      state.turnStartedAt = Number.isFinite(event.time) ? event.time : Date.now()
      state.lastAssistantText = ''
      state.running = true
    } else if (event.type === 'assistant/message') {
      const content = event.data?.message?.content
      if (Array.isArray(content)) {
        const text = content
          .filter((block) => block?.type === 'text' && typeof block.text === 'string')
          .map((block) => block.text)
          .join('\n')
          .trim()
        if (text !== '') state.lastAssistantText = text
      }
    } else if (event.type === 'turn/end') {
      const started = state.turnStartedAt ?? event.time
      const durationMs = Number.isFinite(started) && Number.isFinite(event.time) ? Math.max(0, event.time - started) : null
      state.running = false
      state.turnStartedAt = null
      try {
        onTurnEnd?.({
          sessionId: state.sessionId,
          title: titleFor(state.sessionId) ?? 'DSH session',
          text: state.lastAssistantText,
          durationMs,
          reason: typeof event.data?.reason === 'string' ? event.data.reason : null
        })
      } catch (error) {
        logger?.warn?.(`[mobile-bridge] turn-end hook failed: ${String(error)}`)
      }
      state.lastAssistantText = ''
      scheduleStop(state)
    } else if (event.type === 'session/title') {
      const title = typeof event.data?.title === 'string' ? event.data.title : null
      const known = summaries.get(state.sessionId)
      if (known !== undefined) {
        known.title = title
broadcast.broadcast('session.updated', { session: known })
      }
    }
  }

  async function run(state) {
    try {
      const frames = controller.follow(
        {
          address: { kind: 'session', sessionId: state.sessionId },
          maxMessages: 80,
          assistantStream: true
        },
        state.abort.signal
      )
      for await (const frame of frames) {
        if (state.disposed) break
        if (frame.type === 'snapshot') {
          state.running = summaries.get(state.sessionId)?.running === true
broadcast.broadcast('session.snapshot', {
            sessionId: state.sessionId,
            header: frame.header,
            cursor: frame.cursor,
            records: projectRecords(frame.records),
            hasMore: frame.hasMore,
            projections: frame.projections
          })
        } else if (frame.type === 'event') {
          onEvent(state, frame.event)
        } else if (frame.type === 'assistant-stream') {
broadcast.broadcast('assistant.delta', {
            sessionId: state.sessionId,
            frame: frame.frame,
            item: projectStreamFrame(frame.frame)
          })
        }
      }
    } catch (error) {
      if (!state.disposed && !state.abort.signal.aborted) {
        logger?.warn?.(`[mobile-bridge] follow ${state.sessionId} ended: ${String(error?.message ?? error)}`)
broadcast.broadcast('session.error', { sessionId: state.sessionId, message: String(error?.message ?? error) })
      }
    } finally {
      if (follows.get(state.sessionId) === state) follows.delete(state.sessionId)
    }
  }

  function subscribe(sessionId) {
    const statePromise = ensureFollow(sessionId)
    void statePromise.then((state) => {
      if (state !== undefined) state.refs += 1
    })
    return statePromise
  }

  function unsubscribe(sessionId) {
    const state = follows.get(sessionId)
    if (state === undefined) return
    state.refs = Math.max(0, state.refs - 1)
    if (state.refs === 0 && !state.running) scheduleStop(state)
  }

  async function refreshOne(sessionId) {
    const value = await controller.list({}, new AbortController().signal)
    const summary = value.items.find((item) => item.sessionId === sessionId)
    return summary === undefined ? undefined : cacheSummary(summary)
  }

  const offs = []
  offs.push(
    ctx.on('api-session/added', (summary) => {
      const item = cacheSummary(summary)
      if (item !== null) broadcast.broadcast('session.added', { session: item })
      if (item?.running === true) void ensureFollow(item.id)
    })
  )
  offs.push(
    ctx.on('api-session/removed', (sessionId) => {
      summaries.delete(sessionId)
broadcast.broadcast('session.removed', { sessionId })
      const state = follows.get(sessionId)
      if (state !== undefined) {
        state.disposed = true
        state.abort.abort()
        follows.delete(sessionId)
      }
    })
  )
  offs.push(
    ctx.on('api-session/status', (sessionId, running) => {
      const known = summaries.get(sessionId)
      if (known !== undefined) {
        known.running = running === true
broadcast.broadcast('session.status', { sessionId, running: running === true, session: { ...known, running: running === true } })
      } else {
broadcast.broadcast('session.status', { sessionId, running: running === true })
        void refreshOne(sessionId).catch(() => undefined)
      }
      if (running === true) {
        void ensureFollow(sessionId)
      } else {
        const state = follows.get(sessionId)
        if (state !== undefined) {
          state.running = false
          scheduleStop(state)
        }
      }
    })
  )
  offs.push(
    ctx.on('api-session/activity', (sessionId, updatedAt) => {
      const known = summaries.get(sessionId)
      if (known !== undefined) known.updatedAt = updatedAt
broadcast.broadcast('session.activity', { sessionId, updatedAt })
    })
  )
  offs.push(
    ctx.on('api-session/error', (sessionId, message) => {
broadcast.broadcast('session.error', { sessionId, message })
      try {
        onTurnError?.({ sessionId, title: titleFor(sessionId) ?? 'DSH session', message })
      } catch (error) {
        logger?.warn?.(`[mobile-bridge] turn-error hook failed: ${String(error)}`)
      }
    })
  )

  function dispose() {
    for (const off of offs) {
      try {
        off()
      } catch {
        // already disposed
      }
    }
    for (const state of follows.values()) {
      state.disposed = true
      state.abort.abort()
    }
    follows.clear()
  }

  return { ensureFollow, subscribe, unsubscribe, cacheSummary, summaries, dispose, follows }
}
