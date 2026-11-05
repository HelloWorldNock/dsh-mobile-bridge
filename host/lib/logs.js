/**
 * 运行日志的本地留存与导出。
 *
 * 插件原来只把日志交给 ctx.logger（控制台），手机那端出问题时没有任何可带走的证据。
 * 这里做三件事：
 *   1. 环形缓冲：最近若干条日志留在内存里，导出时不需要读文件；
 *   2. 落盘：同样的内容追加到 <DSH home>/storages/mobile-bridge/logs/bridge.log，
 *      超过上限就滚动成 bridge.log.1，不至于无限长；
 *   3. 导出：把缓冲拼成一段可直接粘进 issue 的纯文本。
 *
 * 所有写盘都是 best-effort：日志不能因为磁盘满、目录没权限就把桥接本身拖挂。
 */

import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { defaultStatePath } from './state.js'

const MAX_ENTRIES = 1_500
const MAX_FILE_BYTES = 3 * 1024 * 1024
const LEVELS = ['debug', 'info', 'warn', 'error']

export function defaultLogDir() {
  return join(dirname(defaultStatePath()), 'logs')
}

function stamp(date = new Date()) {
  return date.toISOString()
}

function safeString(value) {
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.stack ?? value.message
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/**
 * @param {{ dir?: string | null, maxEntries?: number, maxFileBytes?: number, logger?: any }} [options]
 */
export function createLogSink(options = {}) {
  const maxEntries = Number.isSafeInteger(options.maxEntries) && options.maxEntries > 0 ? options.maxEntries : MAX_ENTRIES
  const maxFileBytes = Number.isFinite(options.maxFileBytes) && options.maxFileBytes > 0 ? options.maxFileBytes : MAX_FILE_BYTES
  const entries = []
  let file = null
  let fileError = null
  let dropped = 0

  const dir = typeof options.dir === 'string' && options.dir !== '' ? options.dir : defaultLogDir()
  try {
    mkdirSync(dir, { recursive: true })
    file = join(dir, 'bridge.log')
  } catch (error) {
    fileError = `无法创建日志目录 ${dir}：${String(error?.message ?? error)}`
    file = null
  }

  function rotate() {
    if (file === null) return
    try {
      const size = statSync(file).size
      if (size < maxFileBytes) return
      renameSync(file, join(dir, 'bridge.log.1'))
    } catch {
      // 文件不存在或滚动失败都无妨，继续 append。
    }
  }

  function record(level, message) {
    const line = { at: stamp(), level, message: safeString(message) }
    entries.push(line)
    while (entries.length > maxEntries) {
      entries.shift()
      dropped += 1
    }
    if (file === null) return
    try {
      rotate()
      appendFileSync(file, `${line.at} ${level.toUpperCase().padEnd(5)} ${line.message}\n`, 'utf8')
    } catch (error) {
      fileError = `写日志失败：${String(error?.message ?? error)}`
      file = null
    }
  }

  return {
    get path() {
      return file
    },
    get lastError() {
      return fileError
    },
    get dropped() {
      return dropped
    },
    debug: (message) => record('debug', message),
    info: (message) => record('info', message),
    warn: (message) => record('warn', message),
    error: (message) => record('error', message),
    record,
    /** 最近的日志，按时间正序。 */
    snapshot(limit = maxEntries) {
      const size = Number.isSafeInteger(limit) && limit > 0 ? limit : maxEntries
      return entries.slice(-size)
    },
    lines(limit) {
      return this.snapshot(limit).map((entry) => `${entry.at} ${entry.level.toUpperCase().padEnd(5)} ${entry.message}`)
    }
  }
}

/**
 * 把 ctx.logger 包一层：原来的控制台输出照旧，同时进缓冲和文件。
 * 原 logger 的其余成员（如果有）继续透传，避免插件里别的地方用到。
 */
export function wrapLogger(logger, sink) {
  if (sink === null || sink === undefined) return logger
  const base = logger !== null && typeof logger === 'object' ? logger : {}
  const wrapped = Object.create(base)
  for (const level of LEVELS) {
    wrapped[level] = (message, ...rest) => {
      sink[level](message)
      const fn = base[level]
      if (typeof fn === 'function') {
        try {
          fn.call(base, message, ...rest)
        } catch {
          // 控制台写失败不该影响调用方。
        }
      }
    }
  }
  return wrapped
}

/**
 * 导出用的一段纯文本：头部是环境信息，后面是日志行。
 * 头部字段刻意选「排查这些问题时会问到的」：版本、设备、平台、日志文件位置。
 */
export function formatLogBundle({ sink, header = {}, lines = 400 } = {}) {
  const rows = []
  rows.push('==== DSH 手机远控 · 运行日志 ====')
  for (const [key, value] of Object.entries(header)) {
    if (value === undefined || value === null || value === '') continue
    rows.push(`${key}: ${safeString(value)}`)
  }
  if (sink?.path) rows.push(`日志文件: ${sink.path}`)
  if (sink?.lastError) rows.push(`日志文件异常: ${sink.lastError}`)
  rows.push('')
  if (sink === null || sink === undefined) {
    rows.push('(没有日志缓冲：桥接还没启动或已停止)')
    return rows.join('\n')
  }
  const body = sink.lines(lines)
  if (body.length === 0) rows.push('(日志为空)')
  else rows.push(...body)
  return rows.join('\n')
}

export { startLogTee }

/**
 * 把 process.stdout/stderr 里带插件前缀的输出也收进缓冲。
 * 有些依赖（http 服务、tailscale 桥）直接 console.log，不经过 ctx.logger，
 * 手机上出问题往往就指这几行。只收带 [mobile-bridge] 前缀的行，避免把整台
 * DSH 的输出都抄进来。
 */
function startLogTee(sink, prefix = '[mobile-bridge]') {
  if (sink === null || sink === undefined) return () => {}
  const restores = []
  for (const stream of [process.stdout, process.stderr]) {
    if (stream === null || typeof stream?.write !== 'function') continue
    const original = stream.write.bind(stream)
    stream.write = (chunk, encoding, callback) => {
      try {
        const text = typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString('utf8') : ''
        if (text.includes(prefix)) {
          for (const line of text.split('\n')) {
            const trimmed = line.trim()
            if (trimmed === '' || !trimmed.includes(prefix)) continue
            sink.info(trimmed)
          }
        }
      } catch {
        // 采集失败就当没这回事。
      }
      return original(chunk, encoding, callback)
    }
    restores.push(() => {
      stream.write = original
    })
  }
  return () => {
    for (const restore of restores) restore()
  }
}
