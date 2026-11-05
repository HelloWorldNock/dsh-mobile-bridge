/**
 * 会话历史的「冷读」通道。
 *
 * 手机打开一个会话时要的第一件事就是历史。DSH 的 sessionController 在不同版本里
 * 暴露的读历史方法并不统一：0.8.6 只有 `page` / `events`（同一个 face，参数是
 * SessionPageRequest），早期的 `inspect` 已经没有了。插件以前只认 `inspect`，
 * 于是 inspect 抛错被 catch 吞掉、返回空数组 —— 老会话在手机上永远是空的。
 *
 * 这里按可用性依次尝试，返回第一个成功的结果，失败信息汇总成一条给日志看。
 */

const MAX_PAGE = 200

function clampInt(value, min, max, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

function messageOf(error) {
  return String(error?.message ?? error)
}

/**
 * @param {{ sessionController?: any }} ctx
 * @param {string} sessionId
 * @param {{ maxMessages?: number, beforeSeq?: number, signal?: AbortSignal }} [options]
 * @returns {Promise<{ records: any[], source: string, hasMore: boolean, cursor: number | null }>}
 */
export async function readSessionRecords(ctx, sessionId, options = {}) {
  const controller = ctx?.sessionController
  if (controller === undefined || controller === null) throw new Error('sessionController 不可用')
  const signal = options.signal ?? new AbortController().signal
  const maxMessages = clampInt(options.maxMessages, 1, MAX_PAGE, 80)
  const request = { address: { kind: 'session', sessionId }, maxMessages }
  const beforeSeq = Number(options.beforeSeq)
  if (Number.isFinite(beforeSeq) && beforeSeq > 0) request.beforeSeq = Math.round(beforeSeq)

  const failures = []
  for (const name of ['page', 'events', 'inspect']) {
    const fn = controller[name]
    if (typeof fn !== 'function') {
      failures.push(`${name}: 当前 DSH 没有这个方法`)
      continue
    }
    try {
      // inspect(sessionId, signal) 与 page(request, signal) 的调用式不同，
      // 单独区分，别把请求对象塞进老签名。
      const result = name === 'inspect' ? await fn.call(controller, sessionId, signal) : await fn.call(controller, request, signal)
      const records = Array.isArray(result?.records)
        ? result.records
        : Array.isArray(result?.events)
          ? result.events
          : null
      if (records === null) {
        failures.push(`${name}: 返回里既没有 records 也没有 events`)
        continue
      }
      return {
        records,
        source: name,
        hasMore: result?.hasMore === true,
        cursor: Number.isFinite(result?.cursor) ? Number(result.cursor) : null
      }
    } catch (error) {
      failures.push(`${name}: ${messageOf(error)}`)
    }
  }
  throw new Error(failures.join('; '))
}
