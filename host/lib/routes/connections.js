/**
 * 绑定组与协作路由族（R21 第三刀）。
 *
 * 这一族横跨两种鉴权阶段，所以它被挂在**身份解析之前**，需要身份的接口在用到时
 * 才惰性调用 `api.requireIdentity(req)`：
 *
 *   - 未鉴权/组密钥：`POST /api/group/join`（一次性邀请码换组密钥）、
 *     `POST /api/group/hello`（只认 `dshg_` 组密钥，设备 token 一律 401）
 *   - 设备或组密钥：`GET /api/group`、`POST /api/group/{invite,link}`、
 *     `GET /api/collab/files`、`GET /api/collab/file`
 *
 * 协作读写仍受「只能落在协作工作区内部」约束，越界一律 403（`assertInCollabRoot` 负责）。
 */
import { readFileSync } from 'node:fs'
import { relative, sep } from 'node:path'
import { BridgeError } from '../auth.js'

/**
 * @param {object} api
 * @param {(req) => Promise<object>} api.readJson
 * @param {(res, status, body) => void} api.sendJson
 * @param {(req) => {kind: string, device: object}} api.requireIdentity
 * @param {any|null} api.group
 * @param {{snapshot: Function}} api.collab
 * @param {object} api.state
 * @param {string} api.version
 * @param {number} api.port
 * @param {() => object[]} api.allEndpoints
 * @param {() => string|null} api.collabRoot
 * @param {() => {id: string}|null} api.collabWorkspace
 * @param {(peerUrl: string, explicitUrl?: string) => string} api.advertisedBaseUrl
 * @param {(raw: string|null) => string} api.absoluteDir
 * @param {(dir: string) => void} api.assertInCollabRoot
 * @param {(dir: string, since: number) => object[]} api.listWorkspaceFiles
 * @param {(dir: string, rel: string) => {target: string, info: {size: number}}} api.resolveWorkspaceFile
 * @param {(path: string) => string} api.mediaTypeFor
 */
export function createConnectionRoutes(api) {
  return async function handleConnectionRoutes({ req, res, url, method, path }) {
    // ---- 身份解析之前：握手 ----
    if (method === 'POST' && path === '/api/group/join') {
      if (api.group === null || api.group === undefined) {
        throw new BridgeError('group/unavailable', '绑定组功能不可用', 503)
      }
      const body = await api.readJson(req)
      api.sendJson(
        res,
        200,
        api.group.acceptJoin(
          {
            code: body.code,
            baseUrl: body.baseUrl,
            deviceId: body.deviceId,
            name: body.name,
            version: typeof body.version === 'string' ? body.version : null,
            collabRoot: typeof body.collabRoot === 'string' ? body.collabRoot : null,
            collabWorkspaceId: typeof body.collabWorkspaceId === 'string' ? body.collabWorkspaceId : null,
            selfCollabRoot: api.collabRoot(),
            selfCollabWorkspaceId: api.collabWorkspace()?.id ?? null
          },
          req.socket?.remoteAddress
        )
      )
      return true
    }

    if (method === 'POST' && path === '/api/group/hello') {
      if (api.group === null || api.group === undefined) {
        throw new BridgeError('group/unavailable', '绑定组功能不可用', 503)
      }
      const header = req.headers.authorization
      const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : ''
      if (!api.group.secretMatches(token)) throw new BridgeError('auth/unauthorized', '绑定组密钥不正确', 401)
      api.sendJson(res, 200, {
        groupId: api.state.group?.id ?? null,
        name: api.state.group?.name ?? null,
        deviceId: api.state.deviceId,
        hostName: api.state.hostName,
        version: api.version,
        port: api.port,
        endpoints: api.allEndpoints(),
        collabRoot: api.collabRoot(),
        collabWorkspaceId: api.collabWorkspace()?.id ?? null,
        peers: api.group.snapshot().peers
      })
      return true
    }

    // ---- 身份解析之后：组状态、邀请、牵线、协作文件 ----
    const isGroupPath = path === '/api/group' || path === '/api/group/invite' || path === '/api/group/link'
    const isCollabPath = path === '/api/collab/files' || path === '/api/collab/file'
    if (!isGroupPath && !isCollabPath) return false

    api.requireIdentity(req)

    if (method === 'GET' && path === '/api/group') {
      api.sendJson(res, 200, {
        ...(api.group?.snapshot?.() ?? { group: null, peers: [], invite: null }),
        collabRoot: api.collabRoot()
      })
      return true
    }

    // 手机端组队：同一部手机绑定过的电脑，由手机牵线组成同一个绑定组。
    if (method === 'POST' && path === '/api/group/invite') {
      if (api.group === null || api.group === undefined) {
        throw new BridgeError('group/unavailable', '绑定组功能不可用', 503)
      }
      if (api.group.group === null) api.group.create({ name: null })
      const invite = api.group.rotateInvite()
      api.sendJson(res, 200, {
        invite,
        ...api.group.snapshot(),
        endpoints: api.allEndpoints(),
        collabRoot: api.collabRoot()
      })
      return true
    }

    if (method === 'POST' && path === '/api/group/link') {
      if (api.group === null || api.group === undefined) {
        throw new BridgeError('group/unavailable', '绑定组功能不可用', 503)
      }
      const body = await api.readJson(req)
      const selfBaseUrl = api.advertisedBaseUrl(body.peerBaseUrl, body.selfBaseUrl)
      const result = await api.group.joinRemote({
        baseUrl: body.peerBaseUrl,
        code: body.code,
        selfBaseUrl,
        collabRoot: api.collabRoot()
      })
      api.sendJson(res, 200, { ...result, endpoints: api.allEndpoints(), collabRoot: api.collabRoot() })
      return true
    }

    if (method === 'GET' && path === '/api/collab/files') {
      const dir = api.absoluteDir(url.searchParams.get('cwd'))
      api.assertInCollabRoot(dir)
      const since = Number(url.searchParams.get('since'))
      api.sendJson(res, 200, { cwd: dir, files: api.listWorkspaceFiles(dir, since) })
      return true
    }

    if (method === 'GET' && path === '/api/collab/file') {
      const dir = api.absoluteDir(url.searchParams.get('cwd'))
      api.assertInCollabRoot(dir)
      const { target, info } = api.resolveWorkspaceFile(dir, url.searchParams.get('path') ?? '')
      const body = readFileSync(target)
      res.writeHead(200, {
        'content-type': api.mediaTypeFor(target),
        'content-length': info.size,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'content-disposition': `attachment; filename="${relative(dir, target).split(sep).join('_')}"`
      })
      res.end(body)
      return true
    }

    return false
  }
}
