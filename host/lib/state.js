import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import os from 'node:os'

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function resolveDshHome() {
  return process.env.DSH_HOME && process.env.DSH_HOME.trim() !== ''
    ? process.env.DSH_HOME.trim()
    : join(os.homedir(), '.dsh')
}

export function defaultStatePath() {
  return join(resolveDshHome(), 'storages', 'mobile-bridge', 'state.json')
}

export function shortId(bytes = 5) {
  const buf = randomBytes(bytes)
  let out = ''
  let bits = 0
  let value = 0
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31]
  return out.slice(0, Math.ceil((bytes * 8) / 5))
}

export function createDefaultState() {
  return {
    version: 1,
    deviceId: shortId(5),
    hostName: os.hostname(),
    createdAt: new Date().toISOString(),
    devices: [],
    group: null,
    peers: [],
    settings: {
      phoneFirst: true,
      discovery: true,
      approvalTimeoutMs: 120_000,
      questionTimeoutMs: 120_000,
      planReviewTimeoutMs: 180_000,
      collabWorkspaceId: '',
      collabRoot: '',
      embeddedTailscale: false,
      tailscaleAuthKey: '',
      tailscaleHostname: '',
      tailscaleStateDir: ''
    }
  }
}

function normalizeState(raw) {
  const base = createDefaultState()
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return base
  const settings = raw.settings !== null && typeof raw.settings === 'object' ? raw.settings : {}
  return {
    version: 1,
    deviceId: typeof raw.deviceId === 'string' && raw.deviceId !== '' ? raw.deviceId : base.deviceId,
    hostName: typeof raw.hostName === 'string' && raw.hostName !== '' ? raw.hostName : base.hostName,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : base.createdAt,
    devices: Array.isArray(raw.devices)
      ? raw.devices
          .filter((d) => d !== null && typeof d === 'object' && typeof d.id === 'string' && typeof d.tokenHash === 'string')
          .map((d) => ({
            id: d.id,
            installId: typeof d.installId === 'string' ? d.installId : d.id,
            name: typeof d.name === 'string' ? d.name : 'Android device',
            model: typeof d.model === 'string' ? d.model : '',
            tokenHash: d.tokenHash,
            createdAt: typeof d.createdAt === 'string' ? d.createdAt : new Date().toISOString(),
            lastSeenAt: typeof d.lastSeenAt === 'string' ? d.lastSeenAt : null,
            revokedAt: typeof d.revokedAt === 'string' ? d.revokedAt : null
          }))
      : [],
    group:
      raw.group !== null && typeof raw.group === 'object' && typeof raw.group.id === 'string' && typeof raw.group.secret === 'string'
        ? {
            id: raw.group.id,
            name: typeof raw.group.name === 'string' ? raw.group.name : '绑定组',
            secret: raw.group.secret,
            createdAt: typeof raw.group.createdAt === 'string' ? raw.group.createdAt : new Date().toISOString()
          }
        : null,
    peers: Array.isArray(raw.peers)
      ? raw.peers
          .filter((p) => p !== null && typeof p === 'object' && typeof p.deviceId === 'string' && typeof p.baseUrl === 'string')
          .map((p) => ({
            deviceId: p.deviceId,
            name: typeof p.name === 'string' ? p.name : p.deviceId,
            baseUrl: p.baseUrl,
            groupId: typeof p.groupId === 'string' ? p.groupId : null,
            version: typeof p.version === 'string' ? p.version : null,
            collabRoot: typeof p.collabRoot === 'string' ? p.collabRoot : null,
            collabWorkspaceId: typeof p.collabWorkspaceId === 'string' ? p.collabWorkspaceId : null,
            addedAt: typeof p.addedAt === 'string' ? p.addedAt : new Date().toISOString(),
            lastSeenAt: typeof p.lastSeenAt === 'string' ? p.lastSeenAt : null
          }))
      : [],
    settings: {
      phoneFirst: settings.phoneFirst !== false,
      discovery: settings.discovery !== false,
      approvalTimeoutMs: Number.isFinite(settings.approvalTimeoutMs) ? settings.approvalTimeoutMs : base.settings.approvalTimeoutMs,
      questionTimeoutMs: Number.isFinite(settings.questionTimeoutMs) ? settings.questionTimeoutMs : base.settings.questionTimeoutMs,
      planReviewTimeoutMs: Number.isFinite(settings.planReviewTimeoutMs)
        ? settings.planReviewTimeoutMs
        : base.settings.planReviewTimeoutMs,
      collabWorkspaceId: typeof settings.collabWorkspaceId === 'string' ? settings.collabWorkspaceId.trim() : '',
      collabRoot: typeof settings.collabRoot === 'string' ? settings.collabRoot.trim() : '',
      embeddedTailscale: settings.embeddedTailscale === true,
      tailscaleAuthKey: typeof settings.tailscaleAuthKey === 'string' ? settings.tailscaleAuthKey.trim() : '',
      tailscaleHostname: typeof settings.tailscaleHostname === 'string' ? settings.tailscaleHostname.trim() : '',
      tailscaleStateDir: typeof settings.tailscaleStateDir === 'string' ? settings.tailscaleStateDir.trim() : ''
    }
  }
}

export async function loadState(file = defaultStatePath()) {
  try {
    const text = await readFile(file, 'utf8')
    return normalizeState(JSON.parse(text))
  } catch (error) {
    if (error && error.code === 'ENOENT') return createDefaultState()
    throw error
  }
}

export async function saveState(state, file = defaultStatePath()) {
  await mkdir(dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  await rename(temp, file)
  try {
    await chmod(file, 0o600)
  } catch {
    // Windows ignores POSIX modes; the DSH home is already user-scoped.
  }
}

export function lanAddresses() {
  const out = []
  const interfaces = os.networkInterfaces()
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4' || entry.internal) continue
      out.push({ name, address: entry.address, netmask: entry.netmask })
    }
  }
  return out
}
