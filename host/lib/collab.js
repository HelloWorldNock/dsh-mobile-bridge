import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve, isAbsolute } from 'node:path'
import { BridgeError } from './auth.js'

const DEFAULT_WAIT_MS = 240_000
const MAX_WAIT_MS = 900_000
const MIN_POLL_MS = 100
const MAX_POLL_MS = 15_000
const REQUEST_TIMEOUT_MS = 20_000
const MAX_PROMPT_CHARS = 20_000

function clampWait(value, fallback = DEFAULT_WAIT_MS) {
  if (!Number.isFinite(value)) return fallback
  return Math.min(MAX_WAIT_MS, Math.max(1_000, Math.round(value)))
}

function sleep(ms) {
  return new Promise((done) => {
    const timer = setTimeout(done, ms)
    timer.unref?.()
  })
}

function absolutePath(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new BridgeError('collab/bad-request', `${label}不能为空`, 400)
  }
  const text = value.trim()
  if (!isAbsolute(text)) {
    throw new BridgeError('collab/bad-request', `${label}必须是绝对路径`, 400)
  }
  return resolve(text)
}

function lastAssistantText(records) {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const item = records[index]
    if (item?.type === 'assistant' && typeof item.text === 'string' && item.text.trim() !== '') {
      return item.text.trim()
    }
  }
  return ''
}

/**
 * 组内协作：把任务派给另一台 PC 上的 DSH 会话，等它跑完后回收回复与产物清单。
 * 产物只允许落在双方约定的工作区目录里（对端 /api/collab/files 只在该目录内枚举）。
 */
export function createCollab({ group, logger, fetchImpl = globalThis.fetch, now = () => Date.now() }) {
  async function call(peer, path, { method = 'GET', body = null, timeoutMs = REQUEST_TIMEOUT_MS, raw = false } = {}) {
    const secret = group.group?.secret
    if (typeof secret !== 'string' || secret === '') {
      throw new BridgeError('collab/no-group', '本机还没有加入绑定组', 409)
    }
    if (typeof fetchImpl !== 'function') {
      throw new BridgeError('collab/unavailable', '当前运行时不支持网络请求', 501)
    }
    const headers = { authorization: `Bearer ${secret}` }
    let payload
    if (body !== null) headers['content-type'] = 'application/json; charset=utf-8'
    let response
    try {
      response = await fetchImpl(`${peer.baseUrl}${path}`, {
        method,
        headers,
        body: body === null ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs)
      })
    } catch (error) {
      throw new BridgeError('collab/unreachable', `连接 ${peer.name}（${peer.baseUrl}）失败：${String(error?.message ?? error)}`, 502)
    }
    if (raw) {
      if (!response.ok) throw new BridgeError('collab/peer-error', `${peer.name} 返回 ${response.status}`, 502)
      return response
    }
    payload = await response.json().catch(() => null)
    if (!response.ok || payload === null) {
      const message = typeof payload?.error?.message === 'string' ? payload.error.message : `返回 ${response.status}`
      throw new BridgeError('collab/peer-error', `${peer.name}：${message}`, nearbyStatus(response.status))
    }
    return payload
  }

  function nearbyStatus(status) {
    return status >= 400 && status < 600 ? status : 502
  }

  function requirePeer(reference) {
    const peer = group.peerOf(reference)
    if (peer === null) {
      throw new BridgeError('collab/unknown-peer', `绑定组里没有 ${reference}，先用 action=peers 看看有哪些节点`, 404)
    }
    return peer
  }

  /**
   * 协作目录：显式 workspace 优先；否则用对端自报的「协作目录」。
   * 路径是对端机器上的路径，所以这里不做本机解析。
   */
  async function resolveWorkspace(target, workspace) {
    const value = typeof workspace === 'string' ? workspace.trim() : ''
    if (value !== '') return absolutePath(value, 'workspace')
    if (typeof target.collabRoot === 'string' && target.collabRoot !== '') return target.collabRoot
    await Promise.resolve()
      .then(() => group.refresh?.())
      .catch(() => {})
    const fresh = group.peerOf(target.deviceId) ?? target
    if (typeof fresh.collabRoot === 'string' && fresh.collabRoot !== '') return fresh.collabRoot
    throw new BridgeError(
      'collab/bad-request',
      `${target.name} 还没设置协作目录：给 workspace 传对端上的绝对路径，或在它对端面板里设置「协作目录」`,
      400
    )
  }

  async function listPeers() {
    return group.snapshot().peers
  }

  async function files({ peer, workspace, since = 0 }) {
    const target = requirePeer(peer)
    const dir = await resolveWorkspace(target, workspace)
    const query = new URLSearchParams({ cwd: dir, since: String(Number.isFinite(since) ? since : 0) })
    const payload = await call(target, `/api/collab/files?${query.toString()}`)
    return { peer: target.name, workspace: dir, files: payload.files ?? [] }
  }

  /** 把一个任务派给对端：在它的 workspace 目录里新建会话并等待回合结束。 */
  async function delegate({ peer, workspace, prompt, waitMs = DEFAULT_WAIT_MS, pollMs = 2_000 }) {
    const target = requirePeer(peer)
    const dir = await resolveWorkspace(target, workspace)
    const text = typeof prompt === 'string' ? prompt.trim() : ''
    if (text === '') throw new BridgeError('collab/bad-request', 'prompt 不能为空', 400)
    if (text.length > MAX_PROMPT_CHARS) throw new BridgeError('collab/bad-request', 'prompt 过长', 400)
    const budget = clampWait(waitMs)
    const interval = Math.min(MAX_POLL_MS, Math.max(MIN_POLL_MS, Number.isFinite(pollMs) ? Math.round(pollMs) : 2_000))
    const startedAt = now()

    const created = await call(target, '/api/sessions', {
      method: 'POST',
      body: { cwd: dir, prompt: text },
      timeoutMs: 30_000
    })
    const sessionId = typeof created.sessionId === 'string' ? created.sessionId : ''
    if (sessionId === '') throw new BridgeError('collab/peer-error', `${target.name} 没有返回会话 id`, 502)
    logger?.info?.(`[mobile-bridge] collab delegated to ${target.name}: session ${sessionId} in ${dir}`)

    let detail = null
    let status = 'timeout'
    while (now() - startedAt < budget) {
      await sleep(interval)
      try {
        detail = await call(target, `/api/sessions/${encodeURIComponent(sessionId)}`)
      } catch (error) {
        status = 'error'
        return { peer: target.name, sessionId, workspace: dir, status, reply: `轮询失败：${String(error?.message ?? error)}`, files: [], elapsedMs: now() - startedAt }
      }
      if (detail?.session?.running !== true) {
        status = 'done'
        break
      }
    }

    let artifacts = []
    try {
      const payload = await call(target, `/api/collab/files?${new URLSearchParams({ cwd: dir, since: String(startedAt) }).toString()}`)
      artifacts = payload.files ?? []
    } catch (error) {
      logger?.warn?.(`[mobile-bridge] collab artifact listing failed: ${String(error?.message ?? error)}`)
    }

    return {
      peer: target.name,
      peerId: target.deviceId,
      sessionId,
      workspace: dir,
      status,
      running: detail?.session?.running === true,
      reply: lastAssistantText(Array.isArray(detail?.records) ? detail.records : []),
      files: artifacts,
      elapsedMs: now() - startedAt
    }
  }

  async function status({ peer, sessionId }) {
    const target = requirePeer(peer)
    const id = typeof sessionId === 'string' ? sessionId.trim() : ''
    if (id === '') throw new BridgeError('collab/bad-request', 'sessionId 不能为空', 400)
    const detail = await call(target, `/api/sessions/${encodeURIComponent(id)}`)
    return {
      peer: target.name,
      sessionId: id,
      running: detail?.session?.running === true,
      reply: lastAssistantText(Array.isArray(detail?.records) ? detail.records : []),
      title: detail?.session?.title ?? null
    }
  }

  /** 把对端工作区里的产物文件拉回本机，落在 saveAs 指定的位置。 */
  async function fetchArtifact({ peer, workspace, path, saveAs }) {
    const target = requirePeer(peer)
    const dir = await resolveWorkspace(target, workspace)
    const file = typeof path === 'string' ? path.trim() : ''
    if (file === '') throw new BridgeError('collab/bad-request', 'path 不能为空', 400)
    const target2 = saveAs === undefined ? '' : String(saveAs).trim()
    if (target2 === '' || !isAbsolute(target2)) {
      throw new BridgeError('collab/bad-request', 'saveAs 必须是本机的绝对路径', 400)
    }
    const response = await call(
      target,
      `/api/collab/file?${new URLSearchParams({ cwd: dir, path: file }).toString()}`,
      { raw: true, timeoutMs: 120_000 }
    )
    const buffer = Buffer.from(await response.arrayBuffer())
    const destination = resolve(target2)
    await mkdir(dirname(destination), { recursive: true })
    await writeFile(destination, buffer)
    return { peer: target.name, source: file, saveAs: destination, bytes: buffer.byteLength }
  }

  return { listPeers, delegate, status, files, fetchArtifact }
}
