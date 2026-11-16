/**
 * 会话路由族（R21 第四刀）。
 *
 * 承接任务列表/新建、会话详情与动作（prompt / cancel / rename / permission / plan /
 * archive / 彻底删除）、历史分页与历史图片、权限预设、订阅、待办队列、审批与提问回填、
 * SSE 事件流。
 *
 * 从 server.js 原样搬出：函数体没有改写，只把原来靠闭包拿到的能力改成经 `api` 注入，
 * 因此错误码、边界与副作用顺序与拆分前完全一致。
 */
import { randomUUID } from 'node:crypto'
import { BridgeError } from '../auth.js'
import { imageRefsOf, projectRecords, serializeSummary } from '../dto.js'
import { readSessionRecords } from '../history.js'
import { MAX_PROMPT_CHARS, cleanTitle, promptContent, validTimeZone } from '../services/prompt.js'

const MAX_HISTORY = 80

/**
 * @param {object} api server 注入的能力集合（适配层、审批、广播、宿主辅助函数）
 */
export function createSessionRoutes(api) {
  const {
    sendJson,
    sendText,
    readJson,
    sessions,
    workspaces,
    approvals,
    broadcast,
    hub,
    logger,
    service,
    archivedSessionIdSet,
    removeSessionFiles,
    matchWorkspace,
    ensureAgent,
    agentService,
    inspectRecords,
    rememberImageRefs,
    loadImageRefs,
    attachmentsService,
    assertPeerWorkspace,
    assertPeerSession,
    state
  } = api

  async function allSummaries(signal) {
    const items = await sessions.list(signal)
    return items.map((summary) => serializeSummary(summary)).filter((item) => item !== null)
  }

  function visibleSessionIds() {
    if (!workspaces.supports('list')) return null
    const ids = new Set()
    for (const workspace of workspaces.list()) {
      for (const sessionId of workspace.sessionIds ?? []) ids.add(sessionId)
    }
    return ids
  }

  async function listSummaries(signal) {
    const items = await allSummaries(signal)
    const visible = visibleSessionIds()
    const archived = archivedSessionIdSet()
    return items.filter((item) => (visible === null || visible.has(item.id)) && !archived.has(item.id))
  }

  async function findSummary(sessionId) {
    const items = await allSummaries(new AbortController().signal)
    return items.find((item) => item.id === sessionId) ?? null
  }

  /** 把会话从工作区里摘掉并删除落盘文件；返回被删掉的目录列表。 */
  async function purgeSession(sessionId) {
    if (workspaces.supports('list')) {
      try {
        if (workspaces.supports('unarchiveSession')) await workspaces.unarchive(sessionId)
      } catch {
        // not archived
      }
      for (const workspace of workspaces.list()) {
        try {
          await workspaces.detach(workspace, sessionId)
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

  return async function handleSessionRoutes({ req, res, url, method, path, identity }) {
    const device = identity.device

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
        session = await sessions.create(request)
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
          await sessions.prompt(
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
        const history = await inspectRecords(sessionId)
        if (summary.running || summary.agentAvailable) void hub.ensureFollow(sessionId)
        sendJson(res, 200, {
          session: summary,
          records: history.records.slice(-MAX_HISTORY * 2),
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

      // 归档 / 取消归档：和 PC 端共用 registry 的全局归档集合，手机不再各存一份。
      if (method === 'POST' && (action === 'archive' || action === 'unarchive')) {
        const archiving = action === 'archive'
        const op = archiving ? 'archiveSession' : 'unarchiveSession'
        if (!workspaces.supports(op)) {
          throw new BridgeError('session/archive-unavailable', '当前 Host 不支持归档会话', 501)
        }
        const summary = await findSummary(sessionId)
        if (summary === null) throw new BridgeError('session/not-found', '会话不存在', 404)
        try {
          if (archiving) await workspaces.archive(sessionId)
          else await workspaces.unarchive(sessionId)
        } catch (error) {
          if (error?.name === 'WorkspaceActiveSessionError') {
            throw new BridgeError('session/active', '会话正在运行，先停止再归档', 409)
          }
          if (error?.name === 'WorkspaceUnknownSessionError') {
            throw new BridgeError('session/not-found', '会话不存在', 404)
          }
          throw new BridgeError('session/archive-failed', String(error?.message ?? error), 500)
        }
        // 归档集合本身不发事件，让 hub 立刻对一次账，手机端不用等下一轮轮询。
        hub.syncArchive?.()
        sendJson(res, 200, { archived: archiving })
        return
      }

      if (method === 'GET' && action === 'history') {
        const beforeSeq = Number(url.searchParams.get('beforeSeq'))
        const maxMessages = Math.min(200, Math.max(1, Number(url.searchParams.get('maxMessages')) || MAX_HISTORY))
        const hasBefore = Number.isFinite(beforeSeq) && beforeSeq > 0
        // 多要一条只为判断 hasMore，真实返回仍是最近 maxMessages 条。
        const page = await inspectRecords(sessionId, {
          maxMessages: maxMessages + 1,
          beforeSeq: hasBefore ? beforeSeq : undefined
        })
        const hasMore = page.hasMore || page.records.length > maxMessages
        sendJson(res, 200, {
          records: page.records.slice(-maxMessages),
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
        await sessions.prompt(
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
        await sessions.cancel(sessionId)
        sendJson(res, 200, { accepted: true })
        return
      }

      if (method === 'POST' && action === 'rename') {
        const body = await readJson(req)
        const title = cleanTitle(body.title)
        const value = await sessions.rename(sessionId, title)
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
  }
}
