const MAX_TEXT = 4_000
const MAX_ARGS = 800

function asString(value) {
  return typeof value === 'string' ? value : ''
}

function clip(text, max = MAX_TEXT) {
  const value = asString(text)
  return value.length > max ? `${value.slice(0, max)}…` : value
}

export function textOfContent(content) {
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('\n')
}

export function titleOf(projections) {
  const value = projections?.values?.title
  if (typeof value === 'string') return value
  if (value !== null && typeof value === 'object' && typeof value.title === 'string') return value.title
  return null
}

export function planOf(projections) {
  const value = projections?.values?.plan
  if (value === null || typeof value !== 'object') return { active: false, pending: false }
  return { active: value.active === true, pending: value.pending === true }
}

export function permissionOf(projections) {
  const value = projections?.values?.permissions
  if (value !== null && typeof value === 'object' && typeof value.currentValue === 'string') return value.currentValue
  return null
}

export function serializeSummary(summary) {
  if (summary === null || typeof summary !== 'object') return null
  return {
    id: summary.sessionId,
    title: titleOf(summary.projections),
    cwd: typeof summary.cwd === 'string' ? summary.cwd : null,
    updatedAt: Number.isFinite(summary.updatedAt) ? summary.updatedAt : null,
    running: summary.running === true,
    blank: summary.blank === true,
    agentAvailable: summary.agentAvailable === true,
    parentSessionId: typeof summary.parentSessionId === 'string' ? summary.parentSessionId : null,
    origin: summary.origin === 'subagent' ? 'subagent' : null,
    permission: permissionOf(summary.projections),
    plan: planOf(summary.projections)
  }
}

function parseArguments(raw) {
  if (typeof raw !== 'string' || raw === '') return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function toolArgumentPreview(raw) {
  const parsed = parseArguments(raw)
  if (parsed === null || typeof parsed !== 'object') return clip(raw, MAX_ARGS)
  for (const key of ['command', 'cmd', 'path', 'file_path', 'filePath', 'pattern', 'query', 'url', 'description']) {
    const value = parsed[key]
    if (typeof value === 'string' && value.trim() !== '') return clip(value.trim(), MAX_ARGS)
  }
  return clip(JSON.stringify(parsed), MAX_ARGS)
}

/**
 * Convert one durable Session event into the compact timeline item the phone renders.
 * Returns null for log-only events that have no place in the conversation view.
 */
export function projectEvent(event) {
  if (event === null || typeof event !== 'object' || typeof event.type !== 'string') return null
  const base = {
    seq: Number.isFinite(event.seq) ? event.seq : 0,
    at: Number.isFinite(event.time) ? event.time : null,
    type: event.type
  }
  const data = event.data !== null && typeof event.data === 'object' ? event.data : {}

  if (event.type === 'user/message') {
    const text = textOfContent(data.content)
    if (text.trim() === '') return null
    const sourceKind = typeof data.source?.kind === 'string' ? data.source.kind : null
    // Runtime context, skill catalogs and time hints are injected as user messages
    // but are not part of the human conversation.
    if (sourceKind !== null && sourceKind !== 'user' && sourceKind !== 'user-rpc') return null
    return {
      ...base,
      kind: 'user',
      text: clip(text),
      sourceKind
    }
  }

  if (event.type === 'assistant/message') {
    const message = data.message !== null && typeof data.message === 'object' ? data.message : {}
    const text = textOfContent(message.content)
    if (text.trim() === '') return null
    return {
      ...base,
      kind: 'assistant',
      turn: data.turn,
      step: data.step,
      text: clip(text),
      interrupted: data.interrupted === true
    }
  }

  if (event.type === 'tool/call') {
    return {
      ...base,
      kind: 'tool-call',
      turn: data.turn,
      step: data.step,
      callId: typeof data.callId === 'string' ? data.callId : '',
      name: typeof data.name === 'string' ? data.name : 'tool',
      preview: toolArgumentPreview(data.arguments)
    }
  }

  if (event.type === 'tool/result') {
    const message = data.message !== null && typeof data.message === 'object' ? data.message : {}
    const text = clip(textOfContent(message.content), 2_000)
    return {
      ...base,
      kind: 'tool-result',
      callId: typeof message.toolCallId === 'string' ? message.toolCallId : '',
      text,
      isError: message.isError === true,
      reason: typeof data.error?.reason === 'string' ? clip(data.error.reason, 500) : null
    }
  }

  if (event.type === 'turn/start') {
    return null
  }

  if (event.type === 'turn/end') {
    return {
      ...base,
      kind: 'turn',
      phase: 'end',
      turn: data.turn,
      reason: typeof data.reason === 'string' ? data.reason : null
    }
  }

  if (event.type === 'session/title') {
    return null
  }

  return null
}

export function projectRecords(records) {
  if (!Array.isArray(records)) return []
  const out = []
  for (const entry of records) {
    const event = entry !== null && typeof entry === 'object' && entry.type === 'event' ? entry.event : entry
    const item = projectEvent(event)
    if (item !== null) out.push(item)
  }
  return out
}

export function projectStreamFrame(frame) {
  if (frame === null || typeof frame !== 'object') return null
  const chunk = frame.chunk !== null && typeof frame.chunk === 'object' ? frame.chunk : frame
  const type = typeof chunk.type === 'string' ? chunk.type : typeof frame.type === 'string' ? frame.type : ''
  if (type === 'text-delta' || type === 'reasoning-delta') {
    return { phase: 'delta', kind: type === 'text-delta' ? 'text' : 'reasoning', index: chunk.index, text: asString(chunk.text) }
  }
  if (type === 'start' || type === 'end' || type === 'block-start' || type === 'block-end' || type === 'finish') {
    return { phase: type, index: chunk.index, attemptId: frame.attemptId ?? null }
  }
  return null
}
