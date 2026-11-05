import http from 'node:http'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { BridgeError } from './auth.js'
import { lanAddresses, resolveDshHome } from './state.js'
import { bridgeEndpoints, isTailnetHost } from './endpoints.js'
import { imageRefsOf, projectRecords, serializeSummary } from './dto.js'
import { normalizeBaseUrl } from './group.js'

const MAX_BODY_BYTES = 33_554_432
const MAX_PROMPT_CHARS = 20_000
const MAX_TITLE_CHARS = 200
const MAX_HISTORY = 80
const MAX_IMAGES = 4
const MAX_IMAGE_BYTES = 8_388_608
const MAX_IMAGE_TOTAL_BYTES = 16_777_216
const IMAGE_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const LOCAL_ORIGIN = /^(?:https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?|dsh-app:\/\/[^/]+)$/

const MAX_ARTIFACT_FILES = 200
const MAX_ARTIFACT_DEPTH = 6
const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024
const SKIPPED_DIRS = new Set(['node_modules', '.git', '.dsh', '__pycache__', '.venv', 'venv', '.cache', '.idea'])
const MEDIA_TYPES = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
  ['.svg', 'image/svg+xml'],
  ['.json', 'application/json; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.md', 'text/markdown; charset=utf-8'],
  ['.csv', 'text/csv; charset=utf-8']
])

function mediaTypeFor(file) {
  return MEDIA_TYPES.get(extname(file).toLowerCase()) ?? 'application/octet-stream'
}

function absoluteDir(value, label = 'cwd') {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new BridgeError('collab/bad-request', `${label} 不能为空`, 400)
  }
  const text = value.trim()
  if (!isAbsolute(text)) throw new BridgeError('collab/bad-request', `${label} 必须是绝对路径`, 400)
  const dir = resolve(text)
  if (!existsSync(dir)) throw new BridgeError('collab/not-found', `目录不存在：${dir}`, 404)
  return dir
}

function listWorkspaceFiles(dir, since) {
  const cutoff = Number.isFinite(since) && since > 0 ? since : 0
  const out = []
  const walk = (current, depth) => {
    if (out.length >= MAX_ARTIFACT_FILES || depth > MAX_ARTIFACT_DEPTH) return
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (out.length >= MAX_ARTIFACT_FILES) return
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && !SKIPPED_DIRS.has(entry.name)) walk(full, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      let info
      try {
        info = statSync(full)
      } catch {
        continue
      }
      if (cutoff > 0 && info.mtimeMs < cutoff) continue
      out.push({
        path: full,
        rel: relative(dir, full).split(sep).join('/'),
        name: entry.name,
        size: info.size,
        mtime: Math.round(info.mtimeMs)
      })
    }
  }
  walk(dir, 0)
  out.sort((left, right) => right.mtime - left.mtime)
  return out
}

function resolveWorkspaceFile(dir, relPath) {
  const text = typeof relPath === 'string' ? relPath.trim() : ''
  if (text === '') throw new BridgeError('collab/bad-request', 'path 不能为空', 400)
  const target = resolve(dir, text)
  const rel = relative(dir, target)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new BridgeError('collab/forbidden', '只允许读取指定工作区目录内的文件', 403)
  }
  if (!existsSync(target)) throw new BridgeError('collab/not-found', '文件不存在', 404)
  const info = statSync(target)
  if (!info.isFile()) throw new BridgeError('collab/bad-request', '目标不是文件', 400)
  if (info.size > MAX_ARTIFACT_BYTES) throw new BridgeError('collab/too-large', '文件过大', 413)
  return { target, info }
}

function isLoopback(req) {
  const address = req.socket.remoteAddress ?? ''
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

function applyCors(req, res) {
  const origin = req.headers.origin
  if (typeof origin !== 'string' || !LOCAL_ORIGIN.test(origin)) return false
  res.setHeader('access-control-allow-origin', origin)
  res.setHeader('vary', 'origin')
  res.setHeader('access-control-allow-methods', 'GET,POST,DELETE,OPTIONS')
  res.setHeader('access-control-allow-headers', 'content-type,x-dsh-csrf')
  res.setHeader('access-control-max-age', '600')
  if (req.headers['access-control-request-private-network'] === 'true') {
    res.setHeader('access-control-allow-private-network', 'true')
  }
  return true
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-length': Buffer.byteLength(body)
  })
  res.end(body)
}

function sendError(res, status, code, message) {
  sendJson(res, status, { error: { code, message } })
}

async function readJson(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new BridgeError('request/too-large', '请求体过大', 413)
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text === '') return {}
  try {
    const parsed = JSON.parse(text)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
    return parsed
  } catch {
    throw new BridgeError('request/bad-json', '请求体不是合法 JSON 对象', 400)
  }
}

function validTimeZone(value) {
  if (typeof value !== 'string' || value.length > 64) return undefined
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return value
  } catch {
    return undefined
  }
}

function promptContent(text, images) {
  const content = []
  if (text !== '') content.push({ type: 'text', text })
  if (images === undefined) return content
  if (!Array.isArray(images)) throw new BridgeError('prompt/image-invalid', '图片格式不正确', 400)
  if (images.length > MAX_IMAGES) throw new BridgeError('prompt/too-many-images', `最多发送 ${MAX_IMAGES} 张图片`, 400)
  let total = 0
  for (const image of images) {
    if (image === null || typeof image !== 'object') throw new BridgeError('prompt/image-invalid', '图片格式不正确', 400)
    const mediaType = image.mediaType
    if (typeof mediaType !== 'string' || !IMAGE_MEDIA_TYPES.has(mediaType)) {
      throw new BridgeError('prompt/image-invalid', '只支持 PNG、JPEG、WebP 或 GIF 图片', 400)
    }
    const data = image.data
    if (typeof data !== 'string' || data.length === 0 || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) {
      throw new BridgeError('prompt/image-invalid', '图片数据不是合法的 base64', 400)
    }
    const bytes = Buffer.byteLength(data, 'base64')
    if (bytes > MAX_IMAGE_BYTES) throw new BridgeError('prompt/image-too-large', '单张图片过大', 413)
    total += bytes
    if (total > MAX_IMAGE_TOTAL_BYTES) throw new BridgeError('prompt/image-too-large', '图片总大小过大', 413)
    const part = { type: 'image', mediaType, data }
    if (typeof image.name === 'string' && image.name.trim() !== '') part.name = image.name.trim().slice(0, 120)
    content.push(part)
  }
  return content
}

function cleanTitle(value) {
  if (typeof value !== 'string') throw new BridgeError('session/bad-title', '标题必须是字符串', 400)
  const title = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
  if (title === '' || title.length > MAX_TITLE_CHARS) throw new BridgeError('session/bad-title', '标题长度必须在 1–200 之间', 400)
  return title
}

// 桌面端工作区记录里的 updatedAt 可能是 Date、ISO 字符串或毫秒数；
// 统一成毫秒数，避免手机端把工作区列表整段解析失败。
function toEpochMillis(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (value instanceof Date) {
    const time = value.getTime()
    return Number.isFinite(time) ? time : undefined
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const time = Date.parse(value)
    return Number.isFinite(time) ? time : undefined
  }
  return undefined
}

export function createBridgeServer({ config, state, auth, broadcast, hub, approvals, settings, logger, version, ctx, onDiscoveryChange, tailscale = null, group = null, updater = null }) {
  const csrf = randomBytes(24).toString('base64url')
  let server = null

  function checkCsrf(req) {
    const value = req.headers['x-dsh-csrf']
    if (typeof value !== 'string' || value.length !== csrf.length) {
      throw new BridgeError('setup/csrf', '缺少或错误的 CSRF 令牌', 403)
    }
    if (!timingSafeEqual(Buffer.from(value), Buffer.from(csrf))) {
      throw new BridgeError('setup/csrf', '缺少或错误的 CSRF 令牌', 403)
    }
  }

  function requireAuth(req) {
    const header = req.headers.authorization
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
      throw new BridgeError('auth/unauthorized', '需要 Bearer token', 401)
    }
    const device = auth.authenticate(header.slice('Bearer '.length).trim())
    if (device === undefined) throw new BridgeError('auth/unauthorized', '设备未配对或已被撤销', 401)
    return device
  }

  /**
   * 手机 token 之外，绑定组密钥也能调用同一套接口（组内协作）。
   * peer 身份不参与「手机是否在线」的判断，因此不会抢走审批卡片。
   */
  function requireIdentity(req) {
    const header = req.headers.authorization
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
      throw new BridgeError('auth/unauthorized', '需要 Bearer token', 401)
    }
    const token = header.slice('Bearer '.length).trim()
    const device = auth.authenticate(token)
    if (device !== undefined) return { kind: 'phone', device }
    if (group !== null && group.secretMatches(token)) {
      return { kind: 'peer', device: { id: `peer:${state.deviceId}`, name: `peer:${state.hostName}` } }
    }
    throw new BridgeError('auth/unauthorized', '设备未配对或已被撤销', 401)
  }

  async function allSummaries(signal) {
    const value = await ctx.sessionController.list({}, signal)
    return value.items.map((summary) => serializeSummary(summary)).filter((item) => item !== null)
  }

  function visibleSessionIds() {
    const registry = ctx.workspaceRegistry
    if (typeof registry?.list !== 'function') return null
    const ids = new Set()
    for (const workspace of registry.list()) {
      for (const sessionId of workspace.sessionIds ?? []) ids.add(sessionId)
    }
    return ids
  }

  async function listSummaries(signal) {
    const items = await allSummaries(signal)
    const visible = visibleSessionIds()
    if (visible === null) return items
    return items.filter((item) => visible.has(item.id))
  }

  async function findSummary(sessionId) {
    const items = await allSummaries(new AbortController().signal)
    return items.find((item) => item.id === sessionId) ?? null
  }

  /** 把会话从工作区里摘掉并删除落盘文件；返回被删掉的目录列表。 */
  async function purgeSession(sessionId) {
    const registry = ctx.workspaceRegistry
    if (typeof registry?.list === 'function') {
      try {
        await registry.unarchiveSession?.(sessionId)
      } catch {
        // not archived
      }
      for (const workspace of registry.list()) {
        try {
          await workspace.detachSession(sessionId)
        } catch {
          // not a member of this workspace
        }
      }
    }
    return await removeSessionFiles(sessionId)
  }

  /** 派发失败后清掉刚建的会话；清不掉（还驻留在内存里）就返回 false，让调用方如实报告。 */
  async function discardSession(sessionId) {
    try {
      await purgeSession(sessionId)
      return (await findSummary(sessionId)) === null
    } catch {
      return false
    }
  }

  function samePath(left, right) {
    const a = resolve(left)
    const b = resolve(right)
    return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
  }

  /** cwd 命中已登记的工作区时，让会话挂到那个工作区，而不是落到「未分组」。 */
  function matchWorkspace(dir) {
    if (typeof dir !== 'string' || dir.trim() === '') return null
    const target = resolve(dir.trim())
    for (const workspace of workspaceList()) {
      if (typeof workspace?.path !== 'string' || workspace.path === '') continue
      if (samePath(workspace.path, target)) return workspace
    }
    return null
  }

  async function removeSessionFiles(sessionId) {
    const root = join(resolveDshHome(), 'sessions')
    const removed = []
    let buckets
    try {
      buckets = readdirSync(root, { withFileTypes: true })
    } catch {
      return removed
    }
    for (const bucket of buckets) {
      if (!bucket.isDirectory()) continue
      const direct = join(root, bucket.name, sessionId)
      if (!existsSync(direct)) continue
      rmSync(direct, { recursive: true, force: true })
      removed.push(direct)
    }
    return removed
  }

  async function ensureAgent(sessionId) {
    const result = await ctx.sessionController.resolveAgent(sessionId)
    if (result?.agent !== undefined) return result.agent
    throw new BridgeError('session/not-live', result?.error ?? '会话当前没有可交互的 Agent', 409)
  }

  function agentService(agent, name) {
    try {
      return typeof agent?.ctx?.get === 'function' ? agent.ctx.get(name) : agent?.ctx?.[name]
    } catch {
      return undefined
    }
  }

  async function inspectRecords(sessionId) {
    try {
      const inspection = await ctx.sessionController.inspect(sessionId, new AbortController().signal)
      rememberImageRefs(sessionId, inspection.events)
      return projectRecords(inspection.events)
    } catch (error) {
      logger?.warn?.(`[mobile-bridge] inspect ${sessionId} failed: ${String(error?.message ?? error)}`)
      return []
    }
  }

  /**
   * (sessionId:seq) → 该条消息里的图片引用。
   * 图片是内容寻址的，引用一经产生就不会变，所以缓存不需要失效逻辑，只限制条数。
   */
  const imageRefCache = new Map()
  const MAX_IMAGE_REF_CACHE = 256

  function rememberImageRefs(sessionId, events) {
    if (!Array.isArray(events)) return
    for (const event of events) {
      const record = event?.type === 'event' ? event.event : event
      if (record === null || typeof record !== 'object') continue
      if (record.type !== 'user/message' && record.type !== 'assistant/message') continue
      const content = record.type === 'user/message' ? record.data?.content : record.data?.message?.content
      const refs = imageRefsOf(content)
      if (refs.length === 0) continue
      const key = `${sessionId}:${Number.isFinite(record.seq) ? record.seq : 0}`
      imageRefCache.delete(key)
      imageRefCache.set(key, refs)
      while (imageRefCache.size > MAX_IMAGE_REF_CACHE) {
        const oldest = imageRefCache.keys().next().value
        if (oldest === undefined) break
        imageRefCache.delete(oldest)
      }
    }
  }

  /** 手机按 (seq, index) 要图时用；缓存没命中就重读一次会话。 */
  async function loadImageRefs(sessionId, seq) {
    const key = `${sessionId}:${seq}`
    const cached = imageRefCache.get(key)
    if (cached !== undefined) return cached
    try {
      const inspection = await ctx.sessionController.inspect(sessionId, new AbortController().signal)
      rememberImageRefs(sessionId, inspection.events)
    } catch (error) {
      logger?.warn?.(`[mobile-bridge] image lookup ${sessionId}#${seq} failed: ${String(error?.message ?? error)}`)
    }
    return imageRefCache.get(key) ?? []
  }

  /** 附件服务只在需要时才取，DSH 没挂附件服务时图片接口自己报错即可。 */
  function attachmentsService() {
    try {
      const service = typeof ctx.get === 'function' ? ctx.get('attachments') : ctx.attachments
      return service ?? null
    } catch {
      return null
    }
  }

  /** LAN interfaces plus the embedded tailnet node, in that order. */
  function allEndpoints() {
    return bridgeEndpoints(config.port, undefined, tailscale?.endpoints?.() ?? [])
  }

  /** Settings 里含 Tailscale 授权密钥，对外一律换成布尔标记。 */
  function publicSettings() {
    const { tailscaleAuthKey, tailscaleStateDir, ...rest } = settings
    return {
      ...rest,
      hasTailscaleAuthKey: typeof tailscaleAuthKey === 'string' && tailscaleAuthKey !== ''
    }
  }

  function workspaceList() {
    const registry = ctx.workspaceRegistry
    if (typeof registry?.list !== 'function') return []
    try {
      return registry.list()
    } catch {
      return []
    }
  }

  /**
   * 默认工作区目录：桌面端在设置里填一个绝对路径后，手机新建任务时可以在这个目录下
   * 再建子目录当工作区。目录不存在就当作没配置——否则等于允许手机在任意位置建目录。
   */
  function workspaceRoot() {
    const value = typeof settings.workspaceRoot === 'string' ? settings.workspaceRoot.trim() : ''
    if (value === '' || !isAbsolute(value)) return null
    const dir = resolve(value)
    return existsSync(dir) ? dir : null
  }

  /** 手机传来的只是文件夹名，不是路径：去掉分隔符和 Windows 非法字符，杜绝跳出根目录。 */
  function cleanFolderName(raw) {
    if (typeof raw !== 'string') return null
    const name = raw
      .trim()
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
      .replace(/\s+$/g, '')
      .slice(0, 60)
      .trim()
    if (name === '' || name === '.' || name === '..') return null
    return name
  }

  /** 协作工作区：优先用面板选中的 DSH 工作区（id 指向 registry 里的真实目录），
   * 其次用绝对路径的协作目录。相对路径一律忽略——它会被 DSH 按进程 cwd 解析成
   * profiles\desktop 下的临时目录，协作会话就跑出工作区了。
   */
  function collabWorkspace() {
    const id = typeof settings.collabWorkspaceId === 'string' ? settings.collabWorkspaceId.trim() : ''
    if (id !== '') {
      const found = workspaceList().find((workspace) => workspace?.id === id)
      if (found !== undefined && typeof found.path === 'string' && found.path !== '') {
        return { id, path: resolve(found.path) }
      }
    }
    const value = typeof settings.collabRoot === 'string' ? settings.collabRoot.trim() : ''
    if (value !== '' && isAbsolute(value)) return { id: null, path: resolve(value) }
    return null
  }

  /** 协作目录白名单：为空表示不限，设了就把对端可写/可读的目录锁在根下。 */
  function collabRoot() {
    const workspace = collabWorkspace()
    return workspace === null ? null : workspace.path
  }

  function assertInCollabRoot(dir) {
    const root = collabRoot()
    if (root === null) return
    const rel = relative(root, dir)
    if (rel !== '' && (rel.startsWith('..') || isAbsolute(rel))) {
      throw new BridgeError('collab/forbidden', `协作工作区之外的目录不能读写：必须位于 ${root} 之内`, 403)
    }
  }

  /**
   * 组密钥派来的任务只能落在协作工作区之内。
   * 文件接口早就锁在协作目录里，如果建会话不锁，对端等于绕过白名单在任意目录跑 agent。
   */
  function assertPeerWorkspace(identity, request) {
    if (identity?.kind !== 'peer') return
    if (collabRoot() === null) return
    if (typeof request.workspaceId === 'string' && request.workspaceId !== '') {
      const found = workspaceList().find((workspace) => workspace?.id === request.workspaceId)
      if (found === undefined || typeof found.path !== 'string' || found.path === '') {
        throw new BridgeError('collab/forbidden', '协作工作区不存在，用 /api/workspaces 看对端有哪几个', 403)
      }
      assertInCollabRoot(resolve(found.path))
      return
    }
    if (typeof request.cwd === 'string' && request.cwd !== '') assertInCollabRoot(resolve(request.cwd))
  }

  function assertPeerSession(identity, summary) {
    if (identity?.kind !== 'peer') return
    if (collabRoot() === null) return
    if (typeof summary?.cwd === 'string' && summary.cwd !== '') assertInCollabRoot(resolve(summary.cwd))
  }

  async function setupState() {
    return {
      ...auth.setupState(),
      port: config.port,
      addresses: lanAddresses(),
      endpoints: allEndpoints(),
      tailscale: tailscale?.status?.() ?? null,
      clients: broadcast.count(),
      csrf,
      version,
      group: group?.snapshot?.() ?? { group: null, peers: [], invite: null },
      update: updater?.snapshot?.() ?? null,
      collabRoot: collabRoot(),
      collabWorkspaceId: collabWorkspace()?.id ?? null,
      workspaces: workspaceList().map((workspace) => ({
        id: workspace.id,
        title: typeof workspace.title === 'string' ? workspace.title : workspace.id,
        path: typeof workspace.path === 'string' ? resolve(workspace.path) : ''
      }))
    }
  }

  // 本机要告诉对端的回连地址：对端走 tailnet 就给 tailnet 地址，
  // 否则给局域网地址——否则跨网络组起来的组，心跳会打到一个对端连不上的 IP 上。
  function advertisedBaseUrl(peerUrl, explicit) {
    const given = normalizeBaseUrl(explicit)
    if (given !== null) return given
    const endpoints = allEndpoints()
    const tailnet = endpoints.filter((endpoint) => endpoint.kind === 'tailscale')
    const pool = tailnet.length > 0 && isTailnetHost(peerUrl) ? tailnet : endpoints
    const picked = pool.find((endpoint) => typeof endpoint.url === 'string' && endpoint.url !== '')
    if (picked !== undefined) return picked.url
    return `http://${lanAddresses()[0]?.address ?? '127.0.0.1'}:${config.port}`
  }

  function service(name) {
    return typeof ctx.get === 'function' ? ctx.get(name) : ctx[name]
  }

  async function route(req, res) {
    const url = new URL(req.url ?? '/', 'http://bridge.local')
    const path = url.pathname
    const method = req.method ?? 'GET'

    applyCors(req, res)
    if (method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    if (method === 'GET' && path === '/health') {
      sendJson(res, 200, { ok: true, version, deviceId: state.deviceId })
      return
    }

    // Same non-secret payload as the UDP discovery reply, for hosts that sit
    // behind NAT and cannot receive/forward UDP from the LAN.
    if (method === 'GET' && path === '/api/discovery') {
      sendJson(res, 200, {
        type: 'dsh-remote-bridge',
        version: 1,
        bridgeVersion: version,
        deviceId: state.deviceId,
        hostName: state.hostName,
        port: config.port,
        tls: false,
        endpoints: allEndpoints()
      })
      return
    }

    if (method === 'GET' && path === '/') {
      throw new BridgeError('not-found', 'PC 控制端已改为 DSH 插件：请在 DSH 侧栏打开「手机远控」', 404)
    }

    if (path.startsWith('/api/setup/')) {
      if (!isLoopback(req)) throw new BridgeError('setup/forbidden', '设置接口仅允许本机访问', 403)
      if (method === 'GET' && path === '/api/setup/state') {
        sendJson(res, 200, await setupState())
        return
      }
      if (method === 'GET' && path === '/api/setup/tailscale') {
        sendJson(res, 200, { tailscale: tailscale?.status?.() ?? null })
        return
      }
      if (method !== 'POST') throw new BridgeError('method/not-allowed', '方法不允许', 405)
      checkCsrf(req)
      if (path === '/api/setup/tailscale') {
        if (tailscale === null) throw new BridgeError('tailscale/unavailable', '内置 Tailscale 节点不可用', 503)
        const body = await readJson(req)
        const action = typeof body.action === 'string' ? body.action : ''
        if (action === 'enable') await tailscale.setEnabled(true)
        else if (action === 'disable') await tailscale.setEnabled(false)
        else if (action === 'authkey') await tailscale.setAuthKey(typeof body.value === 'string' ? body.value : '')
        else if (action === 'hostname') await tailscale.setHostname(typeof body.value === 'string' ? body.value : '')
        else if (action === 'statedir') await tailscale.setStateDir(typeof body.value === 'string' ? body.value : '')
        else if (action === 'restart') await tailscale.restart()
        else throw new BridgeError('setup/bad-request', '未知的 Tailscale 操作', 400)
        try {
          onDiscoveryChange?.()
        } catch (error) {
          logger?.warn?.(`[mobile-bridge] discovery notify failed: ${String(error)}`)
        }
        sendJson(res, 200, { ok: true, tailscale: tailscale.status() })
        return
      }
      if (path === '/api/setup/update') {
        if (updater === null) throw new BridgeError('update/unavailable', '当前版本不支持检查更新', 503)
        const body = await readJson(req)
        const update = await updater.check({ force: body.force === true })
        sendJson(res, 200, { ok: true, update })
        return
      }
      if (path === '/api/setup/code') {
        const pairing = auth.rotateCode()
        sendJson(res, 200, { code: pairing.code, expiresAt: new Date(pairing.expiresAt).toISOString() })
        return
      }
      if (path === '/api/setup/revoke') {
        const body = await readJson(req)
        if (typeof body.deviceId !== 'string') throw new BridgeError('setup/bad-request', '缺少 deviceId', 400)
        const revoked = auth.revoke(body.deviceId)
        if (!revoked) throw new BridgeError('setup/not-found', '设备不存在', 404)
        broadcast.closeDevice(body.deviceId)
        approvals.revalidate()
        sendJson(res, 200, { ok: true })
        return
      }
      if (path === '/api/setup/settings') {
        const body = await readJson(req)
        const next = auth.updateSettings(body)
        try {
          onDiscoveryChange?.()
        } catch (error) {
          logger?.warn?.(`[mobile-bridge] discovery toggle failed: ${String(error)}`)
        }
        sendJson(res, 200, { settings: next })
        return
      }
      if (path === '/api/setup/group') {
        if (group === null) throw new BridgeError('group/unavailable', '绑定组功能不可用', 503)
        const body = await readJson(req)
        const action = typeof body.action === 'string' ? body.action : ''
        if (action === 'create') {
          sendJson(res, 200, group.create({ name: body.name }))
          return
        }
        if (action === 'invite') {
          sendJson(res, 200, { invite: group.rotateInvite(), ...group.snapshot() })
          return
        }
        if (action === 'join') {
          const selfBaseUrl = advertisedBaseUrl(body.baseUrl, body.selfBaseUrl)
          sendJson(res, 200, await group.joinRemote({ baseUrl: body.baseUrl, code: body.code, selfBaseUrl, collabRoot: collabRoot(), collabWorkspaceId: collabWorkspace()?.id ?? null }))
          return
        }
        if (action === 'leave') {
          sendJson(res, 200, group.leave())
          return
        }
        if (action === 'forget') {
          const removed = group.removePeer(typeof body.deviceId === 'string' ? body.deviceId : '')
          sendJson(res, 200, { removed, ...group.snapshot() })
          return
        }
        if (action === 'refresh') {
          await group.refresh()
          sendJson(res, 200, group.snapshot())
          return
        }
        throw new BridgeError('setup/bad-request', '未知的绑定组操作', 400)
      }
      if (path === '/api/setup/reset') {
        auth.revokeAll()
        auth.rotateCode()
        broadcast.closeAll()
        approvals.revalidate()
        sendJson(res, 200, { ok: true })
        return
      }
      throw new BridgeError('not-found', '未知的设置接口', 404)
    }

    if (method === 'POST' && path === '/api/pair') {
      const body = await readJson(req)
      const result = auth.pair({
        code: body.code,
        installId: body.installId,
        deviceName: body.deviceName,
        model: body.model,
        appVersion: body.appVersion,
        ip: req.socket.remoteAddress
      })
      sendJson(res, 200, {
        ...result,
        host: {
          ...result.host,
          version,
          endpoints: allEndpoints()
        }
      })
      return
    }

    // 组内握手：邀请码换共享密钥，以及 peer 之间探活。都不走手机 token。
    if (method === 'POST' && path === '/api/group/join') {
      if (group === null) throw new BridgeError('group/unavailable', '绑定组功能不可用', 503)
      const body = await readJson(req)
      sendJson(
        res,
        200,
        group.acceptJoin(
          {
            code: body.code,
            baseUrl: body.baseUrl,
            deviceId: body.deviceId,
            name: body.name,
            version: typeof body.version === 'string' ? body.version : null,
            collabRoot: typeof body.collabRoot === 'string' ? body.collabRoot : null,
            collabWorkspaceId: typeof body.collabWorkspaceId === 'string' ? body.collabWorkspaceId : null,
            selfCollabRoot: collabRoot(),
            selfCollabWorkspaceId: collabWorkspace()?.id ?? null
          },
          req.socket.remoteAddress
        )
      )
      return
    }

    if (method === 'POST' && path === '/api/group/hello') {
      if (group === null) throw new BridgeError('group/unavailable', '绑定组功能不可用', 503)
      const header = req.headers.authorization
      const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : ''
      if (!group.secretMatches(token)) throw new BridgeError('auth/unauthorized', '绑定组密钥不正确', 401)
      sendJson(res, 200, {
        groupId: state.group?.id ?? null,
        name: state.group?.name ?? null,
        deviceId: state.deviceId,
        hostName: state.hostName,
        version,
        port: config.port,
        endpoints: allEndpoints(),
        collabRoot: collabRoot(),
        collabWorkspaceId: collabWorkspace()?.id ?? null,
        peers: group.snapshot().peers
      })
      return
    }

    const identity = requireIdentity(req)
    const device = identity.device

    if (method === 'GET' && path === '/api/info') {
      sendJson(res, 200, {
        bridge: {
          version,
          deviceId: state.deviceId,
          hostName: state.hostName,
          port: config.port,
          discoveryPort: config.discoveryPort,
          addresses: lanAddresses(),
          endpoints: allEndpoints(),
          workspaceRoot: workspaceRoot(),
          clients: broadcast.count()
        },
        device: { id: device.id, name: device.name },
        settings: publicSettings()
      })
      return
    }

    if (method === 'GET' && path === '/api/workspaces') {
      const list = typeof ctx.workspaceRegistry?.list === 'function' ? ctx.workspaceRegistry.list() : []
      sendJson(res, 200, {
        root: workspaceRoot(),
        workspaces: list.map((workspace) => ({
          id: workspace.id,
          path: workspace.path,
          title: workspace.title,
          updatedAt: toEpochMillis(workspace.updatedAt),
          sessionIds: workspace.sessionIds ?? []
        }))
      })
      return
    }

    // 手机端新建工作区：在默认工作区目录下建一个子目录，并登记成 DSH 工作区。
    if (method === 'POST' && path === '/api/workspaces') {
      const root = workspaceRoot()
      if (root === null) {
        throw new BridgeError(
          'workspace/no-root',
          '电脑端还没设置默认工作区目录，先在「手机桥接」设置里填一个文件夹',
          409
        )
      }
      const body = await readJson(req)
      const name = cleanFolderName(body.name)
      if (name === null) throw new BridgeError('workspace/bad-name', '文件夹名不合法', 400)
      const target = resolve(root, name)
      const rel = relative(root, target)
      if (rel === '' || rel.startsWith('..') || isAbsolute(rel) || rel.includes(sep)) {
        throw new BridgeError('workspace/bad-name', '文件夹名不合法', 400)
      }
      const registry = ctx.workspaceRegistry
      if (typeof registry?.create !== 'function') {
        throw new BridgeError('workspace/unavailable', '当前 Host 不能创建工作区', 503)
      }
      let workspace = typeof registry.resolveByPath === 'function' ? registry.resolveByPath(target) : undefined
      if (workspace === undefined || workspace === null) {
        if (existsSync(target)) {
          if (!statSync(target).isDirectory()) throw new BridgeError('workspace/exists', '已有同名文件', 409)
        } else {
          try {
            mkdirSync(target)
          } catch (error) {
            throw new BridgeError('workspace/create-failed', `建目录失败：${String(error?.message ?? error)}`, 409)
          }
        }
        workspace = await registry.create(target, name)
      }
      sendJson(res, 200, {
        root,
        workspace: {
          id: workspace.id,
          path: workspace.path,
          title: workspace.title,
          updatedAt: toEpochMillis(workspace.updatedAt),
          sessionIds: workspace.sessionIds ?? []
        }
      })
      return
    }

    if (method === 'GET' && path === '/api/group') {
      sendJson(res, 200, { ...(group?.snapshot?.() ?? { group: null, peers: [], invite: null }), collabRoot: collabRoot() })
      return
    }

    // 手机端组队：同一部手机绑定过的电脑，由手机牵线组成同一个绑定组。
    if (method === 'POST' && path === '/api/group/invite') {
      if (group === null) throw new BridgeError('group/unavailable', '绑定组功能不可用', 503)
      if (group.group === null) group.create({ name: null })
      const invite = group.rotateInvite()
      sendJson(res, 200, {
        invite,
        ...group.snapshot(),
        endpoints: allEndpoints(),
        collabRoot: collabRoot()
      })
      return
    }

    if (method === 'POST' && path === '/api/group/link') {
      if (group === null) throw new BridgeError('group/unavailable', '绑定组功能不可用', 503)
      const body = await readJson(req)
      const selfBaseUrl = advertisedBaseUrl(body.peerBaseUrl, body.selfBaseUrl)
      const result = await group.joinRemote({
        baseUrl: body.peerBaseUrl,
        code: body.code,
        selfBaseUrl,
        collabRoot: collabRoot()
      })
      sendJson(res, 200, { ...result, endpoints: allEndpoints(), collabRoot: collabRoot() })
      return
    }

    if (method === 'GET' && path === '/api/collab/files') {
      const dir = absoluteDir(url.searchParams.get('cwd'))
      assertInCollabRoot(dir)
      const since = Number(url.searchParams.get('since'))
      sendJson(res, 200, { cwd: dir, files: listWorkspaceFiles(dir, since) })
      return
    }

    if (method === 'GET' && path === '/api/collab/file') {
      const dir = absoluteDir(url.searchParams.get('cwd'))
      assertInCollabRoot(dir)
      const { target, info } = resolveWorkspaceFile(dir, url.searchParams.get('path') ?? '')
      const body = readFileSync(target)
      res.writeHead(200, {
        'content-type': mediaTypeFor(target),
        'content-length': info.size,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'content-disposition': `attachment; filename="${relative(dir, target).split(sep).join('_')}"`
      })
      res.end(body)
      return
    }

    if (method === 'GET' && path === '/api/permission-presets') {
      const presets = service('permissionPresets')
      const catalog = presets?.catalog?.() ?? { options: [], defaultPreset: null }
      sendJson(res, 200, catalog)
      return
    }

    if (method === 'GET' && path === '/api/sessions') {
      const query = (url.searchParams.get('q') ?? '').trim().toLowerCase()
      let items = await listSummaries(new AbortController().signal)
      if (query !== '') {
        items = items.filter((item) => `${item.title ?? ''} ${item.cwd ?? ''}`.toLowerCase().includes(query))
      }
      sendJson(res, 200, { sessions: items })
      return
    }

    if (method === 'POST' && path === '/api/sessions') {
      const body = await readJson(req)
      const request = {}
      const continueId = typeof body.sessionId === 'string' ? body.sessionId.trim() : ''
      if (continueId !== '') request.sessionId = continueId
      if (typeof body.workspaceId === 'string' && body.workspaceId !== '') request.workspaceId = body.workspaceId
      if (typeof body.cwd === 'string' && body.cwd !== '') request.cwd = body.cwd
      if (request.workspaceId !== undefined && request.cwd !== undefined) {
        throw new BridgeError('session/bad-request', 'workspaceId 与 cwd 只能二选一', 400)
      }
      if (continueId !== '' && (request.workspaceId !== undefined || request.cwd !== undefined)) {
        throw new BridgeError('session/bad-request', 'sessionId 与 workspaceId/cwd 只能二选一', 400)
      }
      if (continueId === '' && request.workspaceId === undefined && request.cwd === undefined) {
        throw new BridgeError('session/bad-request', '需要 workspaceId、cwd 或 sessionId', 400)
      }
      // cwd 落在已登记的工作区里时改走 workspaceId：否则 DSH 会把会话挂到「未分组」。
      if (continueId === '' && request.workspaceId === undefined) {
        const matched = matchWorkspace(request.cwd)
        if (matched !== null) {
          request.workspaceId = matched.id
          delete request.cwd
        }
      }
      if (typeof body.agentPreset === 'string' && body.agentPreset !== '') request.agentPreset = body.agentPreset
      if (continueId === '') assertPeerWorkspace(identity, request)
      const warnings = []
      const resumed = continueId !== ''
      let session
      if (resumed) {
        const summary = await findSummary(continueId)
        if (summary === null) throw new BridgeError('session/not-found', '会话不存在', 404)
        if (summary.running) throw new BridgeError('session/active', '该会话正在运行，请等这一轮结束再派任务', 409)
        assertPeerSession(identity, summary)
        session = { sessionId: continueId, agentPreset: null }
      } else {
        session = await ctx.sessionController.create(request)
      }
      const sessionId = session.sessionId

      if (typeof body.permission === 'string' && body.permission !== '') {
        try {
          const loaded = service('sessions')?.get?.(sessionId)
          if (loaded === undefined) throw new Error('session is not materialized yet')
          service('permissionPresets')?.set?.(loaded, body.permission)
        } catch (error) {
          warnings.push(`permission: ${String(error?.message ?? error)}`)
        }
      }
      if (body.plan === true) {
        try {
          const agent = await ensureAgent(sessionId)
          agentService(agent, 'planMode')?.set?.(agent, true)
        } catch (error) {
          warnings.push(`plan: ${String(error?.message ?? error)}`)
        }
      }
      const text = typeof body.prompt === 'string' ? body.prompt.trim() : ''
      if (text.length > MAX_PROMPT_CHARS) throw new BridgeError('prompt/too-long', '内容过长', 400)
      const hasPrompt = text !== '' || (Array.isArray(body.images) && body.images.length > 0)
      if (hasPrompt) {
        try {
          await ctx.sessionController.prompt(
            {
              requestId: randomUUID(),
              sessionId,
              mode: body.mode === 'steer' ? 'steer' : 'queue',
              content: promptContent(text, body.images),
              clientTimeZone: validTimeZone(body.clientTimeZone)
            },
            new AbortController().signal
          )
        } catch (error) {
          // 派发失败就别把一个空会话留在列表里——这是会话越堆越多的主要原因。
          const discarded = resumed ? false : await discardSession(sessionId)
          const hint = discarded
            ? '（已清理这次刚建的会话）'
            : `（会话 ${sessionId} 已保留，可以用 sessionId 续跑）`
          const message = `${String(error?.message ?? error)}${hint}`
          throw new BridgeError('session/prompt-failed', message, error instanceof BridgeError ? error.status : 500)
        }
      }
      sendJson(res, 200, { sessionId, agentPreset: session.agentPreset ?? null, resumed, warnings })
      return
    }

    // 历史图片的原始字节：手机按 (seq, 图片序号) 取，序号与时间线里的 images[].index 一致。
    // 单独匹配，是因为下面那条会话正则只允许一段 action。
    const imageMatch = /^\/api\/sessions\/([^/]+)\/images\/(\d+)\/(\d+)$/.exec(path)
    if (imageMatch !== null) {
      if (method !== 'GET') throw new BridgeError('method/not-allowed', '不支持的方法', 405)
      const imageSessionId = decodeURIComponent(imageMatch[1])
      const imageSeq = Number(imageMatch[2])
      const imageIndex = Number(imageMatch[3])
      const refs = await loadImageRefs(imageSessionId, imageSeq)
      const ref = refs[imageIndex]
      if (ref === undefined) throw new BridgeError('image/not-found', '这条消息里没有这张图片', 404)
      const attachments = attachmentsService()
      if (attachments === null || typeof attachments.readImage !== 'function') {
        throw new BridgeError('image/unavailable', 'Host 没有附件服务，读不了历史图片', 503)
      }
      let stored
      try {
        stored = await attachments.readImage(ref, new AbortController().signal)
      } catch (error) {
        throw new BridgeError('image/unavailable', `图片已不可读：${String(error?.message ?? error)}`, 404)
      }
      const bytes = Buffer.from(stored.data)
      res.writeHead(200, {
        'content-type': typeof stored.ref?.mediaType === 'string' ? stored.ref.mediaType : 'application/octet-stream',
        'content-length': String(bytes.length),
        'cache-control': 'private, max-age=86400',
        'x-content-type-options': 'nosniff'
      })
      res.end(bytes)
      return
    }

    const sessionMatch = /^\/api\/sessions\/([^/]+)(?:\/([a-z]+))?$/.exec(path)
    if (sessionMatch !== null) {
      const sessionId = decodeURIComponent(sessionMatch[1])
      const action = sessionMatch[2] ?? null

      if (method === 'GET' && action === null) {
        const summary = await findSummary(sessionId)
        if (summary === null) throw new BridgeError('session/not-found', '会话不存在', 404)
        const records = await inspectRecords(sessionId)
        if (summary.running || summary.agentAvailable) void hub.ensureFollow(sessionId)
        sendJson(res, 200, {
          session: summary,
          records: records.slice(-MAX_HISTORY * 2),
          pending: approvals.pendingSnapshot()
        })
        return
      }

      if (method === 'DELETE' && action === null) {
        const summary = await findSummary(sessionId)
        if (summary === null) throw new BridgeError('session/not-found', '会话不存在', 404)
        if (summary.running) {
          throw new BridgeError('session/active', '请先停止运行中的任务，再彻底删除', 409)
        }
        if (summary.agentAvailable) {
          throw new BridgeError('session/loaded', '该会话仍驻留在 DSH 内存中，请重启 DSH 后再彻底删除', 409)
        }
        const removed = await purgeSession(sessionId)
        broadcast.broadcast('session.removed', { sessionId })
        logger?.info?.(`[mobile-bridge] deleted session ${sessionId} (${removed.length} dirs)`)
        sendJson(res, 200, { deleted: true, filesRemoved: removed.length })
        return
      }

      if (method === 'GET' && action === 'history') {
        const beforeSeq = Number(url.searchParams.get('beforeSeq'))
        const maxMessages = Math.min(200, Math.max(1, Number(url.searchParams.get('maxMessages')) || MAX_HISTORY))
        let records = await inspectRecords(sessionId)
        if (Number.isFinite(beforeSeq) && beforeSeq > 0) records = records.filter((item) => item.seq < beforeSeq)
        const hasMore = records.length > maxMessages
        sendJson(res, 200, {
          records: hasMore ? records.slice(-maxMessages) : records,
          hasMore
        })
        return
      }

      if (method === 'POST' && action === 'prompt') {
        const body = await readJson(req)
        const text = typeof body.text === 'string' ? body.text.trim() : ''
        const hasImages = Array.isArray(body.images) && body.images.length > 0
        if (text === '' && !hasImages) throw new BridgeError('prompt/empty', '内容不能为空', 400)
        if (text.length > MAX_PROMPT_CHARS) throw new BridgeError('prompt/too-long', '内容过长', 400)
        await ctx.sessionController.prompt(
          {
            requestId: randomUUID(),
            sessionId,
            mode: body.mode === 'steer' ? 'steer' : 'queue',
            content: promptContent(text, body.images),
            clientTimeZone: validTimeZone(body.clientTimeZone)
          },
          new AbortController().signal
        )
        sendJson(res, 200, { accepted: true })
        return
      }

      if (method === 'POST' && action === 'cancel') {
        await ctx.sessionController.cancel({ sessionId })
        sendJson(res, 200, { accepted: true })
        return
      }

      if (method === 'POST' && action === 'rename') {
        const body = await readJson(req)
        const title = cleanTitle(body.title)
        const value = await ctx.sessionController.rename({ sessionId, title })
        sendJson(res, 200, value)
        return
      }

      if (method === 'POST' && action === 'permission') {
        const body = await readJson(req)
        const presets = service('permissionPresets')
        if (presets === undefined) {
          throw new BridgeError('permission/unavailable', '当前 Host 未提供权限预设服务', 501)
        }
        if (typeof body.preset !== 'string') throw new BridgeError('permission/bad-request', '缺少 preset', 400)
        const catalog = presets.catalog()
        if (!catalog.options.some((option) => option.value === body.preset)) {
          throw new BridgeError('permission/unknown', '未知的权限预设', 400)
        }
        await ensureAgent(sessionId)
        const session = service('sessions')?.get?.(sessionId)
        if (session === undefined) throw new BridgeError('session/not-found', '会话不存在或未激活', 404)
        presets.set(session, body.preset)
        sendJson(res, 200, { current: body.preset })
        return
      }

      if (method === 'POST' && action === 'plan') {
        const body = await readJson(req)
        if (typeof body.active !== 'boolean') throw new BridgeError('plan/bad-request', 'active 必须是布尔值', 400)
        const agent = await ensureAgent(sessionId)
        const commands = agentService(agent, 'commands') ?? service('commands')
        if (commands !== undefined && typeof commands.execute === 'function') {
          const execution = await commands.execute(agent, body.active ? '/plan' : '/plan off', [], new AbortController().signal)
          if (execution === undefined) throw new BridgeError('plan/unavailable', '当前会话无法执行 /plan 命令', 501)
          sendJson(res, 200, { active: body.active, status: execution?.result?.kind ?? 'ok' })
          return
        }
        if (typeof agent.session?.append === 'function') {
          agent.session.append('plan/mode', { active: body.active })
          sendJson(res, 200, { active: body.active, status: 'appended', via: 'event' })
          return
        }
        throw new BridgeError('plan/unavailable', '当前 Host 未提供计划模式服务', 501)
        return
      }

      throw new BridgeError('not-found', '未知的会话接口', 404)
    }

    if (method === 'POST' && path === '/api/subscribe') {
      const body = await readJson(req)
      if (typeof body.sessionId !== 'string') throw new BridgeError('subscribe/bad-request', '缺少 sessionId', 400)
      await hub.subscribe(body.sessionId)
      sendJson(res, 200, { subscribed: true })
      return
    }

    if (method === 'POST' && path === '/api/unsubscribe') {
      const body = await readJson(req)
      if (typeof body.sessionId !== 'string') throw new BridgeError('subscribe/bad-request', '缺少 sessionId', 400)
      hub.unsubscribe(body.sessionId)
      sendJson(res, 200, { subscribed: false })
      return
    }

    if (method === 'GET' && path === '/api/pending') {
      sendJson(res, 200, approvals.pendingSnapshot())
      return
    }

    const approvalMatch = /^\/api\/approvals\/([^/]+)$/.exec(path)
    if (method === 'POST' && approvalMatch !== null) {
      const body = await readJson(req)
      const result = approvals.resolveApproval(decodeURIComponent(approvalMatch[1]), body.action)
      if (!result.ok) throw new BridgeError(result.code, result.message, result.code === 'NOT_FOUND' ? 404 : 400)
      sendJson(res, 200, result)
      return
    }

    const questionMatch = /^\/api\/questions\/([^/]+)$/.exec(path)
    if (method === 'POST' && questionMatch !== null) {
      const body = await readJson(req)
      const result = approvals.resolveQuestion(decodeURIComponent(questionMatch[1]), body.answers)
      if (!result.ok) throw new BridgeError(result.code, result.message, result.code === 'NOT_FOUND' ? 404 : 400)
      sendJson(res, 200, result)
      return
    }

    if (method === 'GET' && path === '/api/events') {
      if (identity.kind === 'peer') throw new BridgeError('auth/forbidden', '绑定组成员不使用事件流', 403)
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
        'x-content-type-options': 'nosniff'
      })
      res.flushHeaders?.()
      const client = broadcast.attach(res, { deviceId: device.id })
      broadcast.send(client, 'hello', {
        deviceId: state.deviceId,
        hostName: state.hostName,
        clients: broadcast.count(),
        version
      })
      res.on('close', () => {
        approvals.revalidate()
      })
      return
    }

    throw new BridgeError('not-found', '接口不存在', 404)
  }

  function handler(req, res) {
    void route(req, res).catch((error) => {
      if (res.headersSent) {
        try {
          res.end()
        } catch {
          // client already gone
        }
        return
      }
      if (error instanceof BridgeError) {
        sendError(res, error.status, error.code, error.message)
        return
      }
      logger?.error?.(`[mobile-bridge] request failed: ${error?.stack ?? String(error)}`)
      sendError(res, 500, 'internal', '桥接服务内部错误')
    })
  }

  async function listen() {
    if (server !== null) throw new Error('server already listening')
    server = http.createServer(handler)
    server.setTimeout(0)
    server.keepAliveTimeout = 65_000
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen({ port: config.port, host: config.bindHost }, () => {
        server.off('error', reject)
        resolve()
      })
    })
    const address = server.address()
    const actualPort = typeof address === 'object' && address !== null ? address.port : config.port
    return actualPort
  }

  async function close() {
    if (server === null) return
    broadcast.closeAll()
    await new Promise((resolve) => {
      server.close(() => resolve())
      setTimeout(resolve, 1_500).unref?.()
    })
    server = null
  }

  return { listen, close, csrf, handler }
}
