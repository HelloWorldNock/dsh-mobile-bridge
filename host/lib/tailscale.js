/**
 * Embedded Tailscale node for the mobile bridge.
 *
 * `tsnode` (host/bin/tsnode-<platform>-<arch>) is a userspace
 * tailscale.com/tsnet node with no TUN device and no system VPN. It listens on
 * the tailnet and forwards connections to the local bridge, so a phone in the
 * same tailnet can reach DSH on a PC that has no Tailscale installed.
 *
 * This module owns the child process: spawn, log/status parsing, restart with
 * backoff, and the endpoint it advertises to the phone.
 */
import { spawn as nodeSpawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { resolveDshHome } from './state.js'

const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const LOG_LIMIT = 40
const LOG_LINE_CHARS = 400
const RESTART_DELAYS_MS = [2_000, 5_000, 10_000, 20_000, 40_000, 60_000]
const STOP_GRACE_MS = 2_500

export const BINARY_MISSING = 'binary-missing'

/** Tailscale control-plane states → the phase the panel shows. */
export function phaseForState(state) {
  switch (state) {
    case 'Running':
      return 'running'
    case 'Starting':
    case 'NoState':
      return 'starting'
    case 'NeedsLogin':
    case 'NeedsMachineAuth':
      return 'needs-login'
    case 'Stopped':
      return 'stopped'
    default:
      return typeof state === 'string' && state !== '' ? 'unknown' : 'starting'
  }
}

export function sanitizeHostname(value) {
  const cleaned = String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
  return cleaned.slice(0, 63)
}

/** Node's process.platform/arch are not the names Go uses for build outputs. */
export function goTargetNames({ platform = process.platform, arch = process.arch } = {}) {
  const goPlatform = { win32: 'windows', darwin: 'darwin', linux: 'linux', freebsd: 'freebsd' }[platform] ?? platform
  const goArch = { x64: 'amd64', x32: '386', ia32: '386', arm64: 'arm64', arm: 'arm' }[arch] ?? arch
  return { goPlatform, goArch }
}

/**
 * Locate `tsnode` for this platform. Both the Go-style name
 * (`tsnode-windows-amd64.exe`) and the plain name are accepted so one bundle
 * can ship a binary per platform.
 */
export function resolveBinaryPath({ root = PLUGIN_ROOT, platform = process.platform, arch = process.arch, exists = existsSync } = {}) {
  const { goPlatform, goArch } = goTargetNames({ platform, arch })
  const suffix = goPlatform === 'windows' ? '.exe' : ''
  const candidates = [
    process.env.DSH_MOBILE_BRIDGE_TSNODE,
    join(root, 'bin', `tsnode-${goPlatform}-${goArch}${suffix}`),
    join(root, 'bin', `tsnode-${platform}-${arch}${suffix}`),
    join(root, 'bin', `tsnode-${goPlatform}${suffix}`),
    join(root, 'bin', `tsnode${suffix}`)
  ].filter((candidate) => typeof candidate === 'string' && candidate !== '')
  for (const candidate of candidates) {
    if (exists(candidate)) return candidate
  }
  return null
}

/** Parse one line of tsnode stdout. Returns null for junk. */
export function parseEventLine(line) {
  const text = typeof line === 'string' ? line.trim() : ''
  if (text === '' || text[0] !== '{') return null
  try {
    const value = JSON.parse(text)
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
    return value
  } catch {
    return null
  }
}

function emptyStatus({ available, binary, enabled }) {
  return {
    available,
    binary: binary ?? null,
    enabled: Boolean(enabled),
    running: false,
    pid: null,
    phase: enabled ? (available ? 'starting' : BINARY_MISSING) : 'off',
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
    error: available ? null : '没有找到内置 Tailscale 节点二进制，请先运行 tools/build-tsnode.ps1',
    log: [],
    startedAt: null
  }
}

// An embedded node has no OS-level DNS or network extension, and it cannot
// update itself, so upstream always reports these conditions as health issues.
// They are expected here and would only show up as red noise in the panel.
const BENIGN_HEALTH = /OS base config is not supported|An update from version .* is (?:now )?available|fetch the DNS configuration of your device/i

/** Fold one tsnode event into the status snapshot (pure, used by tests). */
export function applyEvent(status, event) {
  if (event === null || typeof event !== 'object') return status
  const next = { ...status }
  switch (event.type) {
    case 'hello':
      next.hostname = typeof event.hostname === 'string' ? event.hostname : next.hostname
      next.log = pushLog(next.log, `node ${event.version ?? ''} hostname=${event.hostname ?? ''} listen=${event.listen ?? ''}`)
      break
    case 'status': {
      const phase = phaseForState(event.state)
      next.state = typeof event.state === 'string' ? event.state : next.state
      next.phase = phase === 'running' && next.running === false ? 'starting' : phase
      next.ip4 = typeof event.ip4 === 'string' ? event.ip4 : next.ip4
      next.ip6 = typeof event.ip6 === 'string' ? event.ip6 : next.ip6
      next.dnsName = typeof event.dnsName === 'string' ? event.dnsName : next.dnsName
      next.hostname = typeof event.hostname === 'string' && event.hostname !== '' ? event.hostname : next.hostname
      next.tailnet = typeof event.tailnet === 'string' ? event.tailnet : next.tailnet
      next.peers = Number.isFinite(event.peers) ? event.peers : next.peers
      next.health = Array.isArray(event.health)
        ? event.health.filter((item) => typeof item === 'string' && item !== '' && !BENIGN_HEALTH.test(item))
        : []
      next.authUrl = typeof event.authUrl === 'string' && event.authUrl !== '' ? event.authUrl : null
      if (next.running) next.error = next.health[0] ?? null
      break
    }
    case 'listening': {
      next.running = true
      next.phase = 'running'
      next.error = null
      next.ip4 = typeof event.ip4 === 'string' && event.ip4 !== '' ? event.ip4 : next.ip4
      next.listening = typeof event.addr === 'string' ? event.addr : next.listening
      next.log = pushLog(next.log, `listening on ${event.addr ?? '?'} → ${event.local ?? '?'}`)
      break
    }
    case 'error': {
      const message = typeof event.message === 'string' ? event.message : String(event.code ?? '未知错误')
      next.error = /access is denied/i.test(message)
        ? `${message}（安全软件拦截了内置节点写文件，请把 host/bin/tsnode-*.exe 加入信任列表）`
        : message
      next.phase = 'error'
      next.log = pushLog(next.log, `error ${event.code ?? ''}: ${next.error}`)
      break
    }
    case 'exit':
      next.running = false
      next.listening = null
      next.log = pushLog(next.log, `node exited (${event.code ?? 0})`)
      break
    default:
      break
  }
  return next
}

function pushLog(log, line) {
  const text = String(line ?? '').split('\n')[0].slice(0, LOG_LINE_CHARS)
  if (text === '') return log
  const next = [...(log ?? []), text]
  return next.length > LOG_LIMIT ? next.slice(-LOG_LIMIT) : next
}

export function createTailscale({
  settings,
  save,
  logger = console,
  deviceId = '',
  platform = process.platform,
  arch = process.arch,
  root = PLUGIN_ROOT,
  spawn = nodeSpawn,
  exists = existsSync,
  stateDir = join(resolveDshHome(), 'storages', 'mobile-bridge', 'tsnet')
} = {}) {
  const binary = resolveBinaryPath({ root, platform, arch, exists })
  // The node writes its state (node key + logs) to one directory. Security
  // software that trusts only specific folders refuses that write, so keep a
  // fallback chain and lock in the first directory that works.
  function candidateDirs() {
    return [
      typeof settings?.tailscaleStateDir === 'string' ? settings.tailscaleStateDir.trim() : '',
      typeof process.env.DSH_MOBILE_BRIDGE_TSNET_DIR === 'string' ? process.env.DSH_MOBILE_BRIDGE_TSNET_DIR.trim() : '',
      stateDir,
      join(root, '.tsnet-state'),
      join(tmpdir(), 'dsh-mobile-bridge-tsnet')
    ].filter((item, index, list) => item !== '' && list.indexOf(item) === index)
  }
  let stateDirIndex = 0
  let status = emptyStatus({ available: binary !== null, binary, enabled: settings?.embeddedTailscale === true })
  let child = null
  let port = 48123
  let attempts = 0
  let restartTimer = null
  let stopping = false
  let disposed = false

  function currentStateDir() {
    const dirs = candidateDirs()
    return dirs[Math.min(stateDirIndex, dirs.length - 1)] ?? stateDir
  }

  function nextStateDir() {
    const dirs = candidateDirs()
    return stateDirIndex + 1 < dirs.length ? dirs[stateDirIndex + 1] : null
  }

  function defaultHostname() {
    const configured = sanitizeHostname(settings?.tailscaleHostname ?? '')
    if (configured !== '') return configured
    const id = String(deviceId ?? '').toLowerCase()
    return sanitizeHostname(id === '' ? 'dsh-bridge' : `dsh-${id}`)
  }

  function snapshot() {
    return {
      ...status,
      enabled: settings?.embeddedTailscale === true,
      hasAuthKey: typeof settings?.tailscaleAuthKey === 'string' && settings.tailscaleAuthKey !== '',
      hostname: status.hostname !== '' ? status.hostname : defaultHostname(),
      stateDir: currentStateDir(),
      log: [...status.log]
    }
  }

  function broadcast() {
    try {
      onChange?.(snapshot())
    } catch (error) {
      logger?.warn?.(`[mobile-bridge] tailscale notify failed: ${String(error)}`)
    }
  }

  let onChange = null
  function onStatusChange(callback) {
    onChange = typeof callback === 'function' ? callback : null
  }

  function clearRestart() {
    if (restartTimer !== null) {
      clearTimeout(restartTimer)
      restartTimer = null
    }
  }

  function scheduleRestart() {
    if (disposed || stopping || settings?.embeddedTailscale !== true) return
    if (attempts >= RESTART_DELAYS_MS.length) {
      status.phase = 'error'
      status.error = `${status.error ? `${status.error}；` : ''}已停止自动重试`
      broadcast()
      return
    }
    const delay = RESTART_DELAYS_MS[attempts]
    attempts += 1
    status.phase = 'error'
    status.log = pushLog(status.log, `restart in ${Math.round(delay / 1000)}s (attempt ${attempts})`)
    broadcast()
    clearRestart()
    restartTimer = setTimeout(() => {
      restartTimer = null
      void start()
    }, delay)
    restartTimer.unref?.()
  }

  function stopChild() {
    if (child === null) return
    const current = child
    child = null
    try {
      current.stdin?.end()
    } catch {
      // stdin already gone
    }
    const killer = setTimeout(() => {
      try {
        current.kill()
      } catch {
        // already exited
      }
    }, STOP_GRACE_MS)
    killer.unref?.()
    current.once?.('exit', () => clearTimeout(killer))
  }

  async function start() {
    if (disposed) return snapshot()
    clearRestart()
    status.enabled = settings?.embeddedTailscale === true
    if (status.enabled !== true) {
      status.phase = 'off'
      status.error = null
      broadcast()
      return snapshot()
    }
    if (binary === null) {
      status.available = false
      status.phase = BINARY_MISSING
      status.error = '没有找到内置 Tailscale 节点二进制，请先运行 tools/build-tsnode.ps1'
      broadcast()
      return snapshot()
    }
    if (child !== null) return snapshot()

    const authKey = typeof settings?.tailscaleAuthKey === 'string' ? settings.tailscaleAuthKey.trim() : ''
    const args = [
      '-state-dir', currentStateDir(),
      '-hostname', defaultHostname(),
      '-listen', `:${port}`,
      '-local', `127.0.0.1:${port}`
    ]
    if (authKey !== '') args.push('-authkey', authKey)

    stopping = false
    status = {
      ...status,
      available: true,
      running: true,
      phase: 'starting',
      error: null,
      authUrl: null,
      startedAt: new Date().toISOString(),
      log: pushLog(status.log, `spawn ${binary} ${args.join(' ').replace(authKey === '' ? '\u0000' : authKey, '***')}`)
    }

    let spawned
    try {
      spawned = spawn(binary, args, {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, TS_AUTHKEY: authKey }
      })
    } catch (error) {
      status.running = false
      status.phase = 'error'
      status.error = `启动内置节点失败：${String(error?.message ?? error)}`
      broadcast()
      return snapshot()
    }
    child = spawned
    status.pid = spawned.pid ?? null

    spawned.on('error', (error) => {
      status.error = `内置节点进程错误：${String(error?.message ?? error)}`
      status.phase = 'error'
      status.running = false
      broadcast()
    })

    spawned.on('exit', (code) => {
      if (child === spawned) child = null
      status.running = false
      status.listening = null
      status.pid = null
      status.authUrl = null
      status.log = pushLog(status.log, `node exited (${code ?? 0})`)
      if (stopping || disposed || settings?.embeddedTailscale !== true) {
        status.phase = 'off'
        if (!disposed) broadcast()
        return
      }
      status.phase = 'error'
      if (!status.error) status.error = `内置节点退出（代码 ${code ?? 0}）`
      if (/access is denied/i.test(String(status.error ?? ''))) {
        const fallback = nextStateDir()
        if (fallback !== null) {
          stateDirIndex += 1
          status.error = null
          status.phase = 'starting'
          status.log = pushLog(status.log, `state dir blocked, retrying with ${fallback}`)
          broadcast()
          setImmediate(() => {
            void start()
          })
          return
        }
      }
      scheduleRestart()
    })

    if (spawned.stdout) {
      const lines = createInterface({ input: spawned.stdout })
      lines.on('line', (line) => {
        const event = parseEventLine(line)
        if (event === null) {
          status.log = pushLog(status.log, line)
          broadcast()
          return
        }
        const wasRunning = status.running
        status = applyEvent(status, event)
        if (status.running && !wasRunning) attempts = 0
        if (event.type === 'listening' && stateDirIndex > 0) {
          // The node wrote its state, so this directory is usable; remember it
          // instead of rediscovering the blocked default on every start.
          settings.tailscaleStateDir = currentStateDir()
          stateDirIndex = 0
          try {
            save?.()
          } catch (error) {
            logger?.warn?.(`[mobile-bridge] persist tailscale state dir failed: ${String(error)}`)
          }
        }
        broadcast()
      })
    }
    if (spawned.stderr) {
      const lines = createInterface({ input: spawned.stderr })
      lines.on('line', (line) => {
        status.log = pushLog(status.log, line)
        broadcast()
      })
    }

    broadcast()
    return snapshot()
  }

  function stop() {
    clearRestart()
    stopping = true
    attempts = 0
    stopChild()
    status = {
      ...status,
      enabled: false,
      running: false,
      listening: null,
      pid: null,
      phase: 'off',
      state: null,
      ip4: '',
      ip6: '',
      dnsName: '',
      peers: 0,
      health: [],
      authUrl: null
    }
    broadcast()
    return snapshot()
  }

  async function restart() {
    stop()
    stopping = false
    return start()
  }

  async function setEnabled(value) {
    settings.embeddedTailscale = value === true
    await save?.()
    if (settings.embeddedTailscale) {
      stopping = false
      return start()
    }
    return stop()
  }

  async function setAuthKey(value) {
    const key = typeof value === 'string' ? value.trim() : ''
    settings.tailscaleAuthKey = key
    await save?.()
    if (settings.embeddedTailscale === true) return restart()
    return snapshot()
  }

  async function setHostname(value) {
    settings.tailscaleHostname = sanitizeHostname(value)
    await save?.()
    if (settings.embeddedTailscale === true && child !== null) return restart()
    return snapshot()
  }

  /** Points the node at another state directory (empty = back to defaults). */
  async function setStateDir(value) {
    settings.tailscaleStateDir = typeof value === 'string' ? value.trim() : ''
    stateDirIndex = 0
    await save?.()
    if (settings.embeddedTailscale === true) return restart()
    return snapshot()
  }

  /** Called once the bridge has a real port; restarts the node if it moved. */
  async function configure(nextPort) {
    if (!Number.isSafeInteger(nextPort) || nextPort <= 0 || nextPort === port) return snapshot()
    port = nextPort
    if (settings?.embeddedTailscale === true) return restart()
    return snapshot()
  }

  /** Tailnet endpoints for /api/info, discovery replies and pairing. */
  function endpoints() {
    if (status.enabled !== true || status.running !== true || status.ip4 === '') return []
    return [{ kind: 'tailscale', address: status.ip4, url: `http://${status.ip4}:${port}`, source: 'embedded' }]
  }

  async function dispose() {
    disposed = true
    clearRestart()
    stopping = true
    stopChild()
  }

  return {
    binary,
    deviceId,
    onStatusChange,
    status: snapshot,
    start,
    stop,
    restart,
    setEnabled,
    setAuthKey,
    setHostname,
    setStateDir,
    configure,
    endpoints,
    dispose
  }
}
