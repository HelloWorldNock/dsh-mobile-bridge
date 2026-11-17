import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkHostCompatibility, logCompatibility } from '../lib/compatibility-check.js'

/** 一台「接口齐全」的宿主：只有显式指定的那几项会被改坏。 */
function fullHost(overrides = {}) {
  const host = {
    sessionController: {
      list: async () => [],
      prompt: async (id, text) => ({ id, text }),
      cancel: async (id) => id,
      rename: async (id, title) => ({ id, title }),
      create: async () => ({ id: 's_1' }),
      resolveAgent: () => null,
      follow: async (address) => () => {}
    },
    workspaceRegistry: {
      list: async () => [],
      create: async (input) => input,
      resolveByPath: async (path) => ({ id: 'ws', path }),
      unarchiveSession: async () => true,
      archivedSessionIds: []
    },
    on: () => () => {},
    get: (name) =>
      ({
        typertGateway: {},
        commands: {},
        permissionPresets: {},
        sessions: {}
      })[name],
    effect: () => {},
    logger: { info() {}, warn() {}, error() {} },
    slots: { inject: () => {} },
    attachments: {}
  }
  return Object.assign(host, overrides)
}

function statusOf(report, id) {
  return report.checks.find((check) => check.id === id)?.status ?? 'unknown'
}

test('齐全的宿主：ok，且没有降级', () => {
  const report = checkHostCompatibility(fullHost(), { version: '0.8.10' })
  assert.equal(report.ok, true)
  assert.deepEqual(report.problems, [])
  assert.deepEqual(report.warnings, [])
  assert.equal(report.summary, '宿主接口齐全')
  assert.equal(report.version, '0.8.10')
  assert.equal(statusOf(report, 'sessionController.prompt'), 'ok')
  assert.equal(statusOf(report, 'workspaceRegistry.resolveByPath'), 'ok')
})

test('缺 sessionController：必需项缺失，ok=false', () => {
  const report = checkHostCompatibility(fullHost({ sessionController: undefined }))
  assert.equal(report.ok, false)
  assert.equal(statusOf(report, 'sessionController'), 'missing')
  assert.ok(report.problems.some((line) => line.includes('sessionController')))
  assert.match(report.summary, /必需接口不兼容/)
})

test('prompt 被换成非函数：签名不符要报出来', () => {
  const host = fullHost()
  host.sessionController = { ...host.sessionController, prompt: 'nope' }
  const report = checkHostCompatibility(host)
  assert.equal(report.ok, false)
  assert.equal(statusOf(report, 'sessionController.prompt'), 'mismatch')
  assert.ok(report.problems.some((line) => line.includes('期望 function')))
})

test('cancel 少参数（签名漂了）：只降级，不判为不可用', () => {
  const host = fullHost()
  host.sessionController = { ...host.sessionController, cancel: async () => {} }
  const report = checkHostCompatibility(host)
  // 0.2.2 起 cancel/rename 改成「单个对象参数」，老版本是位置参数；适配层统一按对象调用，
  // 两种都能工作，所以 Function.length 只能当提示，不能当成「必需接口坏了」。
  assert.equal(report.ok, true)
  assert.equal(statusOf(report, 'sessionController.cancel'), 'degraded')
  assert.ok(report.warnings.some((line) => line.includes('签名可疑')))
})

test('resolveByPath 是同步实现：只降级，不算失败', () => {
  const host = fullHost()
  host.workspaceRegistry = { ...host.workspaceRegistry, resolveByPath: (path) => ({ path }) }
  const report = checkHostCompatibility(host)
  assert.equal(report.ok, true)
  assert.equal(statusOf(report, 'workspaceRegistry.resolveByPath'), 'degraded')
  assert.ok(report.warnings.some((line) => line.includes('同步实现')))
  assert.match(report.summary, /1 项降级/)
})

test('缺 ctx.get：必需项缺失', () => {
  const report = checkHostCompatibility(fullHost({ get: undefined }))
  assert.equal(report.ok, false)
  assert.equal(statusOf(report, 'get'), 'missing')
})

test('可选服务缺失：只记降级，说明影响', () => {
  const host = fullHost({ get: (name) => (name === 'commands' ? {} : undefined) })
  const report = checkHostCompatibility(host)
  assert.equal(report.ok, true)
  assert.equal(statusOf(report, 'service.commands'), 'ok')
  assert.equal(statusOf(report, 'service.permissionPresets'), 'degraded')
  assert.ok(report.warnings.some((line) => line.includes('权限预设')))
})

test('空 ctx 不抛异常，按全缺处理', () => {
  const report = checkHostCompatibility(undefined)
  assert.equal(report.ok, false)
  assert.equal(statusOf(report, 'sessionController'), 'missing')
  assert.equal(statusOf(report, 'on'), 'missing')
})

test('logCompatibility：有问题写 warn，全绿写一行 info', () => {
  const lines = []
  const logger = { info: (line) => lines.push(['info', line]), warn: (line) => lines.push(['warn', line]) }

  logCompatibility(checkHostCompatibility(fullHost()), logger)
  assert.equal(lines.length, 1)
  assert.equal(lines[0][0], 'info')

  lines.length = 0
  logCompatibility(checkHostCompatibility(fullHost({ sessionController: undefined })), logger)
  assert.equal(lines[0][0], 'warn')
  assert.ok(lines.some(([level, line]) => level === 'warn' && line.includes('sessionController')))

  lines.length = 0
  logCompatibility(checkHostCompatibility(fullHost({ effect: undefined })), logger)
  assert.ok(lines.every(([level]) => level === 'info'))
})
