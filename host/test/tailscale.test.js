import assert from 'node:assert/strict'
import test from 'node:test'
import { PassThrough } from 'node:stream'
import {
  applyEvent,
  createTailscale,
  goTargetNames,
  phaseForState,
  parseEventLine,
  resolveBinaryPath,
  sanitizeHostname
} from '../lib/tailscale.js'

function baseStatus(overrides = {}) {
  return {
    available: true,
    binary: 'tsnode',
    enabled: false,
    running: false,
    pid: null,
    phase: 'off',
    state: null,
    ip4: '',
    ip6: '',
    dnsName: '',
    hostname: '',
    tailnet: '',
    authUrl: null,
    peers: 0,
    health: [],
    listening: null,
    error: null,
    log: [],
    startedAt: null,
    ...overrides
  }
}

function fakeChild() {
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const stdin = new PassThrough()
  const handlers = new Map()
  const child = {
    pid: 4242,
    stdout,
    stderr,
    stdin,
    killed: false,
    on(event, handler) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler])
      return child
    },
    once(event, handler) {
      return child.on(event, handler)
    },
    emit(event, value) {
      for (const handler of handlers.get(event) ?? []) handler(value)
    },
    kill() {
      child.killed = true
      child.emit('exit', 1)
    }
  }
  return child
}

const tick = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms))

test('maps control-plane states to panel phases', () => {
  assert.equal(phaseForState('Running'), 'running')
  assert.equal(phaseForState('Starting'), 'starting')
  assert.equal(phaseForState('NoState'), 'starting')
  assert.equal(phaseForState('NeedsLogin'), 'needs-login')
  assert.equal(phaseForState('NeedsMachineAuth'), 'needs-login')
  assert.equal(phaseForState('Stopped'), 'stopped')
  assert.equal(phaseForState('Weird'), 'unknown')
  assert.equal(phaseForState(null), 'starting')
})

test('sanitizes tailnet hostnames to DNS-safe labels', () => {
  assert.equal(sanitizeHostname('DESKTOP-ABC 123'), 'desktop-abc-123')
  assert.equal(sanitizeHostname('  ..dsh_bridge..  '), 'dsh-bridge')
  assert.equal(sanitizeHostname('x'.repeat(80)).length, 63)
  assert.equal(sanitizeHostname(null), '')
})

test('translates node platform names to Go build target names', () => {
  assert.deepEqual(goTargetNames({ platform: 'win32', arch: 'x64' }), { goPlatform: 'windows', goArch: 'amd64' })
  assert.deepEqual(goTargetNames({ platform: 'linux', arch: 'arm64' }), { goPlatform: 'linux', goArch: 'arm64' })
  assert.deepEqual(goTargetNames({ platform: 'darwin', arch: 'arm64' }), { goPlatform: 'darwin', goArch: 'arm64' })
})

test('resolves a Go-named binary and falls back to plain names', () => {
  const seen = []
  const exists = (path) => {
    seen.push(path)
    return path.endsWith('tsnode-windows-amd64.exe')
  }
  const found = resolveBinaryPath({ root: 'C:\\plugin', platform: 'win32', arch: 'x64', exists })
  assert.ok(found.endsWith('tsnode-windows-amd64.exe'))
  assert.deepEqual(resolveBinaryPath({ root: 'C:\\plugin', platform: 'win32', arch: 'x64', exists: () => false }), null)
  assert.ok(Array.isArray(seen))
})

test('parses only JSON object lines', () => {
  assert.deepEqual(parseEventLine('{"type":"hello"}'), { type: 'hello' })
  assert.equal(parseEventLine('plain log line'), null)
  assert.equal(parseEventLine('[1,2]'), null)
  assert.equal(parseEventLine('{oops'), null)
  assert.equal(parseEventLine(''), null)
})

test('folds node events into the status snapshot', () => {
  let status = baseStatus({ enabled: true })
  status = applyEvent(status, { type: 'hello', version: '0.1.0', hostname: 'dsh-abc', listen: ':48123' })
  assert.equal(status.hostname, 'dsh-abc')
  assert.ok(status.log.at(-1).includes('dsh-abc'))

  status = applyEvent(status, { type: 'status', state: 'Running', ip4: '100.64.1.2', ip6: 'fd7a::1', peers: 3 })
  assert.equal(status.phase, 'starting')
  assert.equal(status.ip4, '100.64.1.2')
  assert.equal(status.peers, 3)

  status = applyEvent(status, { type: 'listening', addr: '100.64.1.2:48123', ip4: '100.64.1.2', local: '127.0.0.1:48123' })
  assert.equal(status.running, true)
  assert.equal(status.phase, 'running')
  assert.equal(status.listening, '100.64.1.2:48123')

  status = applyEvent(status, { type: 'error', code: 'listen-failed', message: 'open x: Access is denied.' })
  assert.equal(status.phase, 'error')
  assert.ok(status.error.includes('信任列表'))
})

test('drops health warnings that an embedded node cannot act on', () => {
  let status = baseStatus({ enabled: true })
  status = applyEvent(status, { type: 'listening', addr: '100.64.1.2:48123', ip4: '100.64.1.2', local: '127.0.0.1:48123' })
  status = applyEvent(status, {
    type: 'status',
    state: 'Running',
    ip4: '100.64.1.2',
    health: [
      'getting OS base config is not supported',
      'Tailscale failed to fetch the DNS configuration of your device: getting OS base config is not supported',
      'An update from version 1.88.2-dev20261028 to 1.104.4 is available. Run `tailscale update` or `tailscale set --auto-update` to update now.',
      'Tailscale is in a crash loop'
    ]
  })
  assert.deepEqual(status.health, ['Tailscale is in a crash loop'])
  assert.equal(status.error, 'Tailscale is in a crash loop')
})

test('spawns, reports and stops the embedded node', async () => {
  const settings = { embeddedTailscale: true, tailscaleAuthKey: '', tailscaleHostname: '' }
  const child = fakeChild()
  const node = createTailscale({
    settings,
    save: async () => undefined,
    logger: { warn() {}, info() {} },
    deviceId: 'dev-1a2b',
    root: 'C:\\plugin',
    stateDir: 'C:\\state',
    exists: () => true,
    spawn: () => child
  })

  assert.equal(node.binary, 'C:\\plugin\\bin\\tsnode-windows-amd64.exe')
  assert.equal(node.status().phase, 'starting')

  await node.start()
  assert.equal(node.status().running, true)
  assert.equal(node.status().hostname, 'dsh-dev-1a2b')

  child.stdout.write(`${JSON.stringify({ type: 'hello', version: '0.1.0', hostname: 'dsh-dev-1a2b' })}\n`)
  child.stdout.write(`${JSON.stringify({ type: 'status', state: 'Running', ip4: '100.64.1.2' })}\n`)
  child.stdout.write(`${JSON.stringify({ type: 'listening', addr: '100.64.1.2:48123', ip4: '100.64.1.2' })}\n`)
  await tick()

  assert.equal(node.status().phase, 'running')
  assert.deepEqual(node.endpoints(), [
    { kind: 'tailscale', address: '100.64.1.2', url: 'http://100.64.1.2:48123', source: 'embedded' }
  ])

  await node.setEnabled(false)
  assert.equal(node.status().phase, 'off')
  assert.deepEqual(node.endpoints(), [])
  await node.dispose()
})

test('falls back to another state directory when the write is denied', async () => {
  const settings = { embeddedTailscale: true, tailscaleAuthKey: '', tailscaleHostname: '', tailscaleStateDir: '' }
  const spawns = []
  let saves = 0
  const node = createTailscale({
    settings,
    save: async () => {
      saves += 1
    },
    logger: { warn() {}, info() {} },
    deviceId: 'dev-1a2b',
    root: 'C:\\plugin',
    stateDir: 'C:\\state',
    exists: () => true,
    spawn: (bin, args) => {
      const child = fakeChild()
      spawns.push({ args, child })
      return child
    }
  })

  await node.start()
  assert.deepEqual(spawns[0].args.slice(0, 2), ['-state-dir', 'C:\\state'])

  spawns[0].child.stdout.write(
    `${JSON.stringify({ type: 'error', code: 'state-dir', message: 'mkdir C:\\state: Access is denied. ' })}\n`
  )
  await tick()
  spawns[0].child.emit('exit', 2)
  await tick()

  assert.equal(spawns.length, 2)
  assert.deepEqual(spawns[1].args.slice(0, 2), ['-state-dir', 'C:\\plugin\\.tsnet-state'])
  assert.equal(node.status().stateDir, 'C:\\plugin\\.tsnet-state')

  spawns[1].child.stdout.write(
    `${JSON.stringify({ type: 'listening', addr: '100.64.1.2:48123', ip4: '100.64.1.2' })}\n`
  )
  await tick()
  assert.equal(settings.tailscaleStateDir, 'C:\\plugin\\.tsnet-state')
  assert.ok(saves >= 1)
  await node.dispose()
})

