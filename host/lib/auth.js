import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { isAbsolute } from 'node:path'

export class BridgeError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.name = 'BridgeError'
    this.code = code
    this.status = status
  }
}

const CODE_TTL_MS = 120_000
const MAX_CODE_FAILURES = 5
const MAX_IP_ATTEMPTS_PER_MINUTE = 10
const LAST_SEEN_WRITE_MS = 60_000

function hashToken(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

function sameHash(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
  } catch {
    return false
  }
}

function cleanText(value, max) {
  if (typeof value !== 'string') return ''
  const text = value.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  return text.slice(0, max)
}

/**
 * Pairing codes, bearer tokens and per-device state.
 * Tokens are only ever persisted as SHA-256 hashes.
 */
export function createAuth({ state, save, settings, logger, now = () => Date.now() }) {
  let pairing = null
  let saveChain = Promise.resolve()
  const ipAttempts = new Map()
  const lastSeenWrites = new Map()

  function persist() {
    saveChain = saveChain.then(() => save(state)).catch((error) => {
      logger?.warn?.(`[mobile-bridge] failed to persist state: ${String(error)}`)
    })
    return saveChain
  }

  function rotateCode() {
    pairing = {
      code: String(randomInt(0, 1_000_000)).padStart(6, '0'),
      expiresAt: now() + CODE_TTL_MS,
      failures: 0
    }
    return pairing
  }

  function currentCode() {
    if (pairing === null || pairing.expiresAt <= now()) rotateCode()
    return pairing
  }

  function checkIpRate(ip) {
    const key = ip || 'unknown'
    const cutoff = now() - 60_000
    const list = (ipAttempts.get(key) ?? []).filter((time) => time > cutoff)
    if (list.length >= MAX_IP_ATTEMPTS_PER_MINUTE) {
      throw new BridgeError('pair/rate-limited', '配对尝试过于频繁，请稍后再试', 429)
    }
    list.push(now())
    ipAttempts.set(key, list)
    if (ipAttempts.size > 512) {
      for (const [candidate, times] of ipAttempts) {
        if (times.every((time) => time <= cutoff)) ipAttempts.delete(candidate)
      }
    }
  }

  function devicePublic(device) {
    return {
      id: device.id,
      name: device.name,
      model: device.model,
      createdAt: device.createdAt,
      lastSeenAt: device.lastSeenAt,
      revokedAt: device.revokedAt
    }
  }

  function setupState() {
    const code = currentCode()
    const { tailscaleAuthKey, ...safeSettings } = settings
    return {
      deviceId: state.deviceId,
      hostName: state.hostName,
      code: code.code,
      codeExpiresAt: new Date(code.expiresAt).toISOString(),
      devices: state.devices.map(devicePublic),
      settings: { ...safeSettings, hasTailscaleAuthKey: typeof tailscaleAuthKey === 'string' && tailscaleAuthKey !== '' }
    }
  }

  function pair({ code, installId, deviceName, model, appVersion, ip }) {
    checkIpRate(ip)
    const active = currentCode()
    if (active.expiresAt <= now()) {
      rotateCode()
      throw new BridgeError('pair/expired', '配对码已过期，请刷新后重试', 410)
    }
    if (typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) {
      throw new BridgeError('pair/bad-code', '请输入 6 位配对码', 400)
    }
    if (active.failures >= MAX_CODE_FAILURES) {
      rotateCode()
      throw new BridgeError('pair/locked', '配对码失败次数过多，已刷新，请重新读取', 429)
    }
    if (code.trim() !== active.code) {
      active.failures += 1
      throw new BridgeError('pair/bad-code', '配对码不正确', 401)
    }

    const token = `dshm_${randomBytes(32).toString('base64url')}`
    const tokenHash = hashToken(token)
    const install = cleanText(installId, 80) || `install-${randomBytes(8).toString('hex')}`
    const name = cleanText(deviceName, 64) || 'Android device'
    const modelText = cleanText(model, 64)
    const existing = state.devices.find((device) => device.installId === install && device.revokedAt === null)
    let device
    if (existing !== undefined) {
      existing.name = name
      existing.model = modelText
      existing.tokenHash = tokenHash
      existing.lastSeenAt = new Date(now()).toISOString()
      device = existing
    } else {
      device = {
        id: `dev-${randomBytes(8).toString('hex')}`,
        installId: install,
        name,
        model: modelText,
        tokenHash,
        createdAt: new Date(now()).toISOString(),
        lastSeenAt: new Date(now()).toISOString(),
        revokedAt: null
      }
      state.devices.push(device)
    }
    rotateCode()
    persist()
    logger?.info?.(`[mobile-bridge] paired ${device.name} (${device.id}) app ${cleanText(appVersion, 24) || '?'}`)
    return {
      token,
      device: devicePublic(device),
      host: { id: state.deviceId, name: state.hostName, version: '0.1.0' }
    }
  }

  function authenticate(token) {
    if (typeof token !== 'string' || token === '') return undefined
    const hash = hashToken(token)
    const device = state.devices.find((candidate) => candidate.revokedAt === null && sameHash(candidate.tokenHash, hash))
    if (device === undefined) return undefined
    const previous = lastSeenWrites.get(device.id) ?? 0
    if (now() - previous > LAST_SEEN_WRITE_MS) {
      lastSeenWrites.set(device.id, now())
      device.lastSeenAt = new Date(now()).toISOString()
      persist()
    }
    return device
  }

  function revoke(deviceId) {
    const device = state.devices.find((candidate) => candidate.id === deviceId)
    if (device === undefined) return false
    device.revokedAt = new Date(now()).toISOString()
    persist()
    return true
  }

  function revokeAll() {
    let count = 0
    for (const device of state.devices) {
      if (device.revokedAt === null) {
        device.revokedAt = new Date(now()).toISOString()
        count += 1
      }
    }
    if (count > 0) persist()
    return count
  }

  function updateSettings(patch) {
    if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return { ...settings }
    if (typeof patch.phoneFirst === 'boolean') settings.phoneFirst = patch.phoneFirst
    if (typeof patch.discovery === 'boolean') settings.discovery = patch.discovery
    for (const key of ['approvalTimeoutMs', 'questionTimeoutMs', 'planReviewTimeoutMs']) {
      const value = patch[key]
      if (Number.isFinite(value) && value >= 5_000 && value <= 600_000) settings[key] = Math.round(value)
    }
    if (typeof patch.collabWorkspaceId === 'string') settings.collabWorkspaceId = patch.collabWorkspaceId.trim().slice(0, 120)
    if (typeof patch.collabRoot === 'string') {
      const value = patch.collabRoot.trim().slice(0, 400)
      // 相对路径会被 DSH 按进程工作目录解析，落到 profiles\desktop 下面，协作会话就跑出工作区了。
      if (value !== '' && !isAbsolute(value)) {
        throw new BridgeError('setup/bad-workspace', '协作工作区必须是绝对路径，例如 F:\\collab', 400)
      }
      settings.collabRoot = value
    }
    // 默认工作区目录：手机在这个目录下新建工作区文件夹，所以同样必须是绝对路径。
    if (typeof patch.workspaceRoot === 'string') {
      const value = patch.workspaceRoot.trim().slice(0, 400)
      if (value !== '' && !isAbsolute(value)) {
        throw new BridgeError('setup/bad-root', '默认工作区目录必须是绝对路径，例如 F:\\AgentWorkProject', 400)
      }
      settings.workspaceRoot = value
    }
    persist()
    return { ...settings }
  }

  return {
    pair,
    authenticate,
    revoke,
    revokeAll,
    setupState,
    updateSettings,
    currentCode,
    rotateCode
  }
}
