import http from 'node:http'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { existsSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { BridgeError } from './auth.js'
import { lanAddresses, resolveDshHome } from './state.js'
import { bridgeEndpoints } from './endpoints.js'
import { projectRecords, serializeSummary } from './dto.js'

const MAX_BODY_BYTES = 33_554_432
const MAX_PROMPT_CHARS = 20_000
const MAX_TITLE_CHARS = 200
const MAX_HISTORY = 80
const MAX_IMAGES = 4
const MAX_IMAGE_BYTES = 8_388_608
const MAX_IMAGE_TOTAL_BYTES = 16_777_216
const IMAGE_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const LOCAL_ORIGIN = /^(?:https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?|dsh-app:\/\/[^/]+)$/

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

export function createBridgeServer({ config, state, auth, broadcast, hub, approvals, settings, logger, version, ctx, onDiscoveryChange }) {
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
      return projectRecords(inspection.events)
    } catch (error) {
      logger?.warn?.(`[mobile-bridge] inspect ${sessionId} failed: ${String(error?.message ?? error)}`)
      return []
    }
  }

  async function setupState() {
    return {
      ...auth.setupState(),
      port: config.port,
      addresses: lanAddresses(),
      endpoints: bridgeEndpoints(config.port),
      clients: broadcast.count(),
      csrf,
      version
    }
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
        endpoints: bridgeEndpoints(config.port)
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
      if (method !== 'POST') throw new BridgeError('method/not-allowed', '方法不允许', 405)
      checkCsrf(req)
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
          endpoints: bridgeEndpoints(config.port)
        }
      })
      return
    }

    const device = requireAuth(req)

    if (method === 'GET' && path === '/api/info') {
      sendJson(res, 200, {
        bridge: {
          version,
          deviceId: state.deviceId,
          hostName: state.hostName,
          port: config.port,
          discoveryPort: config.discoveryPort,
          addresses: lanAddresses(),
          endpoints: bridgeEndpoints(config.port),
          clients: broadcast.count()
        },
        device: { id: device.id, name: device.name },
        settings: { ...settings }
      })
      return
    }

    if (method === 'GET' && path === '/api/workspaces') {
      const list = typeof ctx.workspaceRegistry?.list === 'function' ? ctx.workspaceRegistry.list() : []
      sendJson(res, 200, {
        workspaces: list.map((workspace) => ({
          id: workspace.id,
          path: workspace.path,
          title: workspace.title,
          updatedAt: workspace.updatedAt,
          sessionIds: workspace.sessionIds ?? []
        }))
      })
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
      if (typeof body.workspaceId === 'string' && body.workspaceId !== '') request.workspaceId = body.workspaceId
      if (typeof body.cwd === 'string' && body.cwd !== '') request.cwd = body.cwd
      if (request.workspaceId !== undefined && request.cwd !== undefined) {
        throw new BridgeError('session/bad-request', 'workspaceId 与 cwd 只能二选一', 400)
      }
      if (request.workspaceId === undefined && request.cwd === undefined) {
        throw new BridgeError('session/bad-request', '需要 workspaceId 或 cwd', 400)
      }
      if (typeof body.agentPreset === 'string' && body.agentPreset !== '') request.agentPreset = body.agentPreset
      const created = await ctx.sessionController.create(request)
      const warnings = []

      if (typeof body.permission === 'string' && body.permission !== '') {
        try {
          const session = service('sessions')?.get?.(created.sessionId)
          if (session === undefined) throw new Error('session is not materialized yet')
          service('permissionPresets')?.set?.(session, body.permission)
        } catch (error) {
          warnings.push(`permission: ${String(error?.message ?? error)}`)
        }
      }
      if (body.plan === true) {
        try {
          const agent = await ensureAgent(created.sessionId)
          agentService(agent, 'planMode')?.set?.(agent, true)
        } catch (error) {
          warnings.push(`plan: ${String(error?.message ?? error)}`)
        }
      }
      if (typeof body.prompt === 'string' && body.prompt.trim() !== '') {
        const text = body.prompt.trim()
        if (text.length > MAX_PROMPT_CHARS) throw new BridgeError('prompt/too-long', '内容过长', 400)
        await ctx.sessionController.prompt(
          {
            requestId: randomUUID(),
            sessionId: created.sessionId,
            mode: body.mode === 'steer' ? 'steer' : 'queue',
            content: promptContent(text, body.images),
            clientTimeZone: validTimeZone(body.clientTimeZone)
          },
          new AbortController().signal
        )
      } else if (Array.isArray(body.images) && body.images.length > 0) {
        await ctx.sessionController.prompt(
          {
            requestId: randomUUID(),
            sessionId: created.sessionId,
            mode: body.mode === 'steer' ? 'steer' : 'queue',
            content: promptContent('', body.images),
            clientTimeZone: validTimeZone(body.clientTimeZone)
          },
          new AbortController().signal
        )
      }
      sendJson(res, 200, { sessionId: created.sessionId, agentPreset: created.agentPreset ?? null, warnings })
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
        const removed = await removeSessionFiles(sessionId)
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
