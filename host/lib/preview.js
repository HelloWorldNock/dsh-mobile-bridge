import { toolArgumentPreview } from './dto.js'

/**
 * Best-effort human preview for an approval card: find the tool/call event that
 * belongs to this approval and render its most useful argument.
 */
export function approvalPreview(session, callId) {
  if (session === null || session === undefined || typeof callId !== 'string' || callId === '') return null
  let events
  try {
    events = typeof session.snapshotEvents === 'function' ? session.snapshotEvents() : []
  } catch {
    return null
  }
  if (!Array.isArray(events)) return null
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'tool/call') continue
    if (event.data?.callId !== callId) continue
    const preview = toolArgumentPreview(event.data?.arguments)
    return {
      tool: typeof event.data?.name === 'string' ? event.data.name : null,
      preview,
      turn: event.data?.turn ?? null,
      step: event.data?.step ?? null
    }
  }
  return null
}
