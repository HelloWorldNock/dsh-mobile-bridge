import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createLogSink, formatLogBundle, wrapLogger } from '../lib/logs.js'

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'dmb-logs-'))
  return { dir, clean: () => rmSync(dir, { recursive: true, force: true }) }
}

test('keeps a bounded ring buffer and mirrors it to disk', () => {
  const { dir, clean } = tempDir()
  try {
    const sink = createLogSink({ dir, maxEntries: 3 })
    for (let i = 0; i < 5; i += 1) sink.info(`line ${i}`)
    const snapshot = sink.snapshot()
    assert.equal(snapshot.length, 3)
    assert.match(snapshot[0].message, /line 2/)
    assert.equal(snapshot[2].message, 'line 4')
    assert.equal(sink.dropped, 2)
    const file = readFileSync(sink.path, 'utf8')
    assert.match(file, /line 0/)
    assert.match(file, /line 4/)
  } finally {
    clean()
  }
})

test('rotates the log file past its size limit', () => {
  const { dir, clean } = tempDir()
  try {
    const sink = createLogSink({ dir, maxFileBytes: 64 })
    sink.info('x'.repeat(80))
    sink.info('after-rotate')
    assert.match(readFileSync(join(dir, 'bridge.log.1'), 'utf8'), /xxxx/)
    assert.match(readFileSync(join(dir, 'bridge.log'), 'utf8'), /after-rotate/)
  } finally {
    clean()
  }
})

test('wraps ctx.logger so console output and the buffer both see a line', () => {
  const { dir, clean } = tempDir()
  try {
    const seen = []
    const base = { info: (message) => seen.push(message), warn: (message) => seen.push(`warn:${message}`) }
    const sink = createLogSink({ dir })
    const logger = wrapLogger(base, sink)
    logger.info('hello')
    logger.warn('careful')
    assert.deepEqual(seen, ['hello', 'warn:careful'])
    assert.deepEqual(sink.snapshot().map((entry) => entry.level), ['info', 'warn'])
    // 原 logger 没有的方法不能炸：插件里到处是 logger?.debug?.(...)。
    assert.equal(typeof logger.debug, 'function')
    assert.doesNotThrow(() => logger.error('boom'))
  } finally {
    clean()
  }
})

test('wrapped logger tolerates a throwing base logger', () => {
  const { dir, clean } = tempDir()
  try {
    const base = {
      info() {
        throw new Error('console gone')
      }
    }
    const sink = createLogSink({ dir })
    const logger = wrapLogger(base, sink)
    assert.doesNotThrow(() => logger.info('still logged'))
    assert.equal(sink.snapshot().length, 1)
  } finally {
    clean()
  }
})

test('export bundle carries the environment header and the recent lines', () => {
  const { dir, clean } = tempDir()
  try {
    const sink = createLogSink({ dir })
    sink.info('bridge started')
    const text = formatLogBundle({
      sink,
      header: { 桥接版本: '0.8.6', 设备ID: 'dev-1', 端口: 48123 },
      lines: 10
    })
    assert.match(text, /DSH 手机远控 · 运行日志/)
    assert.match(text, /桥接版本: 0\.8\.6/)
    assert.match(text, /设备ID: dev-1/)
    assert.match(text, /bridge started/)
  } finally {
    clean()
  }
})

test('bundling without a sink still produces readable text', () => {
  const text = formatLogBundle({ sink: null, header: { 设备ID: 'dev-1' } })
  assert.match(text, /设备ID: dev-1/)
  assert.match(text, /没有日志缓冲/)
})
