import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { BridgeError } from './auth.js'

const INVITE_TTL_MS = 300_000
const INVITE_MAX_FAILURES = 5
const MAX_INVITE_ATTEMPTS_PER_MINUTE = 10
const HEARTBEAT_MS = 30_000
const PEER_OFFLINE_MS = 90_000
const FETCH_TIMEOUT_MS = 8_000

function hashSecret(value) {
  return createHash('sha256').update(value, 'utf8').digest()
}

function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a === '' || b === '') return false
  return timingSafeEqual(hashSecret(a), hashSecret(b))
}

function cleanText(value, max) {
  if (typeof value !== 'string') return ''
  return value
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, max)
}

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i

/**
 * 把用户填的地址收敛成 http(s)://host[:port]。
 * 面板上常见只填 `192.168.1.10:48123`，少了 http:// 时按 http 处理，
 * 而不是直接判非法——否则用户只会看到「点击加入没反应」。
 */
export function normalizeBaseUrl(value) {
  if (typeof value !== 'string') return null
  const text = value.trim().replace(/\/+$/, '')
  if (text === '') return null
  const withScheme = HAS_SCHEME.test(text) ? text : `http://${text}`
  try {
    const url = new URL(withScheme)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (url.username !== '' || url.password !== '') return null
    return `${url.protocol}//${url.host}`
  } catch {
    return null
  }
}

/**
 * 绑定组：同一部手机绑定过的 PC 端互相登记成 peer，形成一个小型协作组。
 * 组内用一次性邀请码换一把共享密钥，密钥只存 SHA-256（与本机 state.json 同权限）。
 * peer 之间走「手机 API」互相下任务，但 peer token 不算手机在线，不会抢审批。
 */
export function createGroup({
  state,
  save,
  logger,
  port = 0,
  now = () => Date.now(),
  fetchImpl = globalThis.fetch,
  heartbeatMs = HEARTBEAT_MS
}) {
  let invite = null
  let timer = null
  let refreshing = false
  const inviteAttempts = new Map()
  let saveChain = Promise.resolve()

  function persist() {
    saveChain = saveChain
      .then(() => save())
      .catch((error) => logger?.warn?.(`[mobile-bridge] failed to persist group: ${String(error)}`))
    return saveChain
  }

  function resolvePort() {
    const value = typeof port === 'function' ? port() : port
    return Number.isFinite(value) ? value : 0
  }

  function peerPublic(peer) {
    const lastSeen = peer.lastSeenAt === null ? null : Date.parse(peer.lastSeenAt)
    const stale = lastSeen === null || Number.isNaN(lastSeen) || now() - lastSeen > PEER_OFFLINE_MS
    return {
      deviceId: peer.deviceId,
      name: peer.name,
      baseUrl: peer.baseUrl,
      groupId: peer.groupId ?? null,
      version: peer.version ?? null,
      collabRoot: typeof peer.collabRoot === 'string' ? peer.collabRoot : null,
      collabWorkspaceId: typeof peer.collabWorkspaceId === 'string' ? peer.collabWorkspaceId : null,
      addedAt: peer.addedAt,
      lastSeenAt: peer.lastSeenAt,
      status: stale ? 'offline' : 'online'
    }
  }

  function snapshot() {
    return {
      group:
        state.group === null
          ? null
          : { id: state.group.id, name: state.group.name, createdAt: state.group.createdAt },
      peers: state.peers.map(peerPublic),
      invite: currentInvite()
    }
  }

  function currentInvite() {
    if (invite === null || invite.expiresAt <= now()) return null
    return { code: invite.code, expiresAt: new Date(invite.expiresAt).toISOString() }
  }

  function rotateInvite() {
    if (state.group === null) throw new BridgeError('group/not-ready', '请先创建绑定组', 409)
    invite = {
      code: String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0'),
      expiresAt: now() + INVITE_TTL_MS,
      failures: 0
    }
    return currentInvite()
  }

  function create({ name } = {}) {
    if (state.group !== null) {
      return { ...snapshot(), invite: currentInvite() ?? rotateInvite() }
    }
    const label = cleanText(name, 40) || `${state.hostName} 的绑定组`
    state.group = {
      id: `grp_${randomBytes(5).toString('hex')}`,
      name: label,
      secret: `dshg_${randomBytes(32).toString('base64url')}`,
      createdAt: new Date(now()).toISOString()
    }
    state.peers = []
    invite = null
    persist()
    logger?.info?.(`[mobile-bridge] group ${state.group.id} created`)
    return { ...snapshot(), invite: rotateInvite() }
  }

  function leave() {
    state.group = null
    state.peers = []
    invite = null
    persist()
    return snapshot()
  }

  function checkInviteRate(ip) {
    const key = ip || 'unknown'
    const cutoff = now() - 60_000
    const list = (inviteAttempts.get(key) ?? []).filter((time) => time > cutoff)
    if (list.length >= MAX_INVITE_ATTEMPTS_PER_MINUTE) {
      throw new BridgeError('group/rate-limited', '绑定尝试过于频繁，请稍后再试', 429)
    }
    list.push(now())
    inviteAttempts.set(key, list)
  }

  function verifyInvite(code, ip) {
    checkInviteRate(ip)
    if (state.group === null) throw new BridgeError('group/not-ready', '对端尚未创建绑定组', 409)
    const active = currentInvite()
    if (active === null) throw new BridgeError('group/invite-expired', '邀请码已过期，请在本机重新生成', 410)
    if (invite.failures >= INVITE_MAX_FAILURES) {
      invite = null
      throw new BridgeError('group/invite-locked', '邀请码错误次数过多，请重新生成', 429)
    }
    if (typeof code !== 'string' || code.trim() !== invite.code) {
      invite.failures += 1
      throw new BridgeError('group/bad-invite', '邀请码不正确', 401)
    }
    invite = null
    return true
  }

  function upsertPeer({ deviceId, name, baseUrl, version = null, groupId = null, collabRoot = null, collabWorkspaceId = null }) {
    const id = cleanText(deviceId, 64)
    const url = normalizeBaseUrl(baseUrl)
    if (id === '' || url === null) throw new BridgeError('group/bad-peer', '缺少对端的设备标识或地址', 400)
    if (id === state.deviceId) throw new BridgeError('group/bad-peer', '不能把本机加进绑定组', 400)
    const existing = state.peers.find((peer) => peer.deviceId === id)
    if (existing !== undefined) {
      existing.name = cleanText(name, 64) || existing.name
      existing.baseUrl = url
      existing.groupId = groupId ?? state.group?.id ?? null
      existing.version = version
      if (typeof collabRoot === 'string') existing.collabRoot = collabRoot
      if (typeof collabWorkspaceId === 'string') existing.collabWorkspaceId = collabWorkspaceId
      return existing
    }
    const peer = {
      deviceId: id,
      name: cleanText(name, 64) || id,
      baseUrl: url,
      groupId: groupId ?? state.group?.id ?? null,
      version,
      collabRoot: typeof collabRoot === 'string' ? collabRoot : null,
      collabWorkspaceId: typeof collabWorkspaceId === 'string' ? collabWorkspaceId : null,
      addedAt: new Date(now()).toISOString(),
      lastSeenAt: null
    }
    state.peers.push(peer)
    return peer
  }

  function removePeer(deviceId) {
    const before = state.peers.length
    state.peers = state.peers.filter((peer) => peer.deviceId !== deviceId)
    if (state.peers.length !== before) persist()
    return before !== state.peers.length
  }

  /** 对端用自己的邀请码加入：登记它，并把组密钥交给它。 */
  function acceptJoin(
    { code, baseUrl, deviceId, name, version, collabRoot = null, collabWorkspaceId = null, selfCollabRoot = null, selfCollabWorkspaceId = null },
    ip
  ) {
    verifyInvite(code, ip)
    const peer = upsertPeer({
      deviceId,
      name,
      baseUrl: normalizeBaseUrl(baseUrl) ?? `http://${ip ?? '127.0.0.1'}:${resolvePort()}`,
      version,
      collabRoot: typeof collabRoot === 'string' ? collabRoot : null,
      collabWorkspaceId: typeof collabWorkspaceId === 'string' ? collabWorkspaceId : null
    })
    peer.lastSeenAt = new Date(now()).toISOString()
    persist()
    logger?.info?.(`[mobile-bridge] peer ${peer.deviceId} (${peer.name}) joined group ${state.group.id}`)
    return {
      groupId: state.group.id,
      name: state.group.name,
      secret: state.group.secret,
      deviceId: state.deviceId,
      hostName: state.hostName,
      port: resolvePort(),
      version: null,
      collabRoot: typeof selfCollabRoot === 'string' && selfCollabRoot !== '' ? selfCollabRoot : null,
      collabWorkspaceId:
        typeof selfCollabWorkspaceId === 'string' && selfCollabWorkspaceId !== '' ? selfCollabWorkspaceId : null,
      peers: state.peers.map(peerPublic)
    }
  }

  /** 本机拿着对端的邀请码加入别人的组。 */
  async function joinRemote({ baseUrl, code, selfBaseUrl = null, collabRoot = null, collabWorkspaceId = null }) {
    const target = normalizeBaseUrl(baseUrl)
    if (target === null) throw new BridgeError('group/bad-url', '请填写对端地址，例如 http://192.168.1.10:48123', 400)
    if (typeof fetchImpl !== 'function') throw new BridgeError('group/unavailable', '当前运行时不支持网络请求', 501)
    let payload
    try {
      const response = await fetchImpl(`${target}/api/group/join`, {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({
          code: typeof code === 'string' ? code.trim() : '',
          baseUrl: normalizeBaseUrl(selfBaseUrl) ?? null,
          deviceId: state.deviceId,
          name: state.hostName,
          version: null,
          collabRoot: typeof collabRoot === 'string' && collabRoot !== '' ? collabRoot : null,
          collabWorkspaceId:
            typeof collabWorkspaceId === 'string' && collabWorkspaceId !== '' ? collabWorkspaceId : null
        }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
      })
      payload = await response.json().catch(() => null)
      if (!response.ok || payload === null) {
        const message = typeof payload?.error?.message === 'string' ? payload.error.message : `对端返回 ${response.status}`
        throw new BridgeError('group/join-failed', message, response.status === 401 ? 401 : 400)
      }
    } catch (error) {
      if (error instanceof BridgeError) throw error
      throw new BridgeError('group/unreachable', `无法连接对端：${String(error?.message ?? error)}`, 502)
    }
    if (typeof payload.secret !== 'string' || typeof payload.groupId !== 'string') {
      throw new BridgeError('group/join-failed', '对端返回的数据不完整', 502)
    }
    state.group = {
      id: payload.groupId,
      name: cleanText(payload.name, 40) || '绑定组',
      secret: payload.secret,
      createdAt: new Date(now()).toISOString()
    }
    state.peers = []
    upsertPeer({
      deviceId: payload.deviceId,
      name: payload.hostName,
      baseUrl: target,
      version: payload.version ?? null,
      collabRoot: typeof payload.collabRoot === 'string' ? payload.collabRoot : null,
      collabWorkspaceId: typeof payload.collabWorkspaceId === 'string' ? payload.collabWorkspaceId : null
    })
    for (const peer of Array.isArray(payload.peers) ? payload.peers : []) {
      if (peer?.deviceId === state.deviceId || peer?.deviceId === payload.deviceId) continue
      if (typeof peer?.baseUrl !== 'string') continue
      try {
        upsertPeer({
          deviceId: peer.deviceId,
          name: peer.name,
          baseUrl: peer.baseUrl,
          version: peer.version ?? null,
          collabRoot: typeof peer.collabRoot === 'string' ? peer.collabRoot : null,
          collabWorkspaceId: typeof peer.collabWorkspaceId === 'string' ? peer.collabWorkspaceId : null
        })
      } catch {
        // 缺地址的 gossip 条目直接丢弃
      }
    }
    const self = state.peers.find((peer) => peer.deviceId === payload.deviceId)
    if (self !== undefined) self.lastSeenAt = new Date(now()).toISOString()
    invite = null
    persist()
    logger?.info?.(`[mobile-bridge] joined group ${state.group.id} at ${target}`)
    return snapshot()
  }

  function secretMatches(token) {
    if (state.group === null) return false
    return sameSecret(state.group.secret, token)
  }

  function peerOf(reference) {
    const text = cleanText(reference, 80)
    if (text === '') return null
    const direct = state.peers.find((peer) => peer.deviceId === text)
    if (direct !== undefined) return direct
    const lower = text.toLowerCase()
    const byName = state.peers.find((peer) => peer.name.toLowerCase() === lower)
    if (byName !== undefined) return byName
    return state.peers.find((peer) => peer.deviceId.includes(text) || peer.name.toLowerCase().includes(lower)) ?? null
  }

  /** 心跳：刷新每个 peer 的在线状态，并把对方知道的 peer 合进来（gossip）。 */
  async function refresh() {
    if (refreshing || typeof fetchImpl !== 'function') return
    if (state.group === null || state.peers.length === 0) return
    refreshing = true
    try {
      for (const peer of [...state.peers]) {
        try {
          const response = await fetchImpl(`${peer.baseUrl}/api/group/hello`, {
            method: 'POST',
            headers: { authorization: `Bearer ${state.group.secret}` },
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
          })
          if (!response.ok) {
            peer.lastSeenAt = peer.lastSeenAt ?? null
            continue
          }
          const payload = await response.json().catch(() => null)
          peer.lastSeenAt = new Date(now()).toISOString()
          if (typeof payload?.version === 'string') peer.version = payload.version
          if (typeof payload?.collabRoot === 'string') peer.collabRoot = payload.collabRoot
          if (typeof payload?.collabWorkspaceId === 'string') peer.collabWorkspaceId = payload.collabWorkspaceId
          for (const other of Array.isArray(payload?.peers) ? payload.peers : []) {
            if (other?.deviceId === state.deviceId) continue
            if (state.peers.some((item) => item.deviceId === other?.deviceId)) continue
            if (typeof other?.baseUrl !== 'string') continue
            try {
              upsertPeer({
                deviceId: other.deviceId,
                name: other.name,
                baseUrl: other.baseUrl,
                collabRoot: typeof other.collabRoot === 'string' ? other.collabRoot : null,
                collabWorkspaceId: typeof other.collabWorkspaceId === 'string' ? other.collabWorkspaceId : null
              })
            } catch {
              // 忽略不合法的 gossip 条目
            }
          }
        } catch {
          // 单点不可达不影响其它 peer
        }
      }
      persist()
    } finally {
      refreshing = false
    }
  }

  function start() {
    if (timer !== null || heartbeatMs <= 0) return
    timer = setInterval(() => {
      void refresh()
    }, heartbeatMs)
    timer.unref?.()
  }

  function dispose() {
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }

  return {
    snapshot,
    create,
    leave,
    rotateInvite,
    acceptJoin,
    joinRemote,
    secretMatches,
    peerOf,
    upsertPeer,
    removePeer,
    refresh,
    start,
    dispose,
    get group() {
      return state.group
    }
  }
}
