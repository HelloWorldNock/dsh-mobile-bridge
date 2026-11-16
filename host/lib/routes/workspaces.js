/**
 * 工作区路由族（R21：从 server.js 拆出的第一个路由模块）。
 *
 * 两条接口：
 *   GET  /api/workspaces   → 工作区列表 + 归档集合（手机据此分组与显示「取消归档」）
 *   POST /api/workspaces    → 在桌面端配置的默认根目录下建子目录并登记成工作区
 *
 * 约定：本模块**不做鉴权**（身份已在 server 里解析完），只拿到 `api` 里那些
 * 已经收口过的能力；抛 `BridgeError` 由 server 的统一 catch 映射成 HTTP。
 */
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { BridgeError } from '../auth.js'
import { cleanFolderName, toEpochMillis } from '../services/format.js'

/**
 * @param {object} api
 * @param {(res, status, body) => void} api.sendJson
 * @param {(req) => Promise<object>} api.readJson
 * @param {() => object[]} api.workspaceList
 * @param {() => string|null} api.workspaceRoot
 * @param {() => Set<string>} api.archivedSessionIdSet
 * @param {{supports:(n:string)=>boolean, resolveByPath:(p:string)=>Promise<any>, create:(p:string,t?:string)=>Promise<any>}} api.workspaces
 * @returns {(ctx: {req: any, res: any, url: URL, method: string, path: string}) => Promise<boolean>} 处理了就返回 true
 */
export function createWorkspaceRoutes(api) {
  return async function handleWorkspaceRoutes({ req, res, url, method, path }) {
    if (path === '/api/workspaces' && method === 'GET') {
      const archives = api.archivedSessionIdSet()
      api.sendJson(res, 200, {
        root: api.workspaceRoot(),
        // 归档会话不参与分组：App 按 sessionIds 归组，留着它只会得到空分组。
        workspaces: api.workspaceList().map((workspace) => ({
          id: workspace.id,
          path: workspace.path,
          title: workspace.title,
          updatedAt: toEpochMillis(workspace.updatedAt),
          sessionIds: (workspace.sessionIds ?? []).filter((sessionId) => !archives.has(sessionId))
        })),
        archivedSessionIds: [...archives]
      })
      return true
    }

    if (path === '/api/workspaces' && method === 'POST') {
      const root = api.workspaceRoot()
      if (root === null) {
        throw new BridgeError(
          'workspace/no-root',
          '电脑端还没设置默认工作区目录，先在「手机桥接」设置里填一个文件夹',
          409
        )
      }
      const body = await api.readJson(req)
      const name = cleanFolderName(body.name)
      if (name === null) throw new BridgeError('workspace/bad-name', '文件夹名不合法', 400)
      const target = resolve(root, name)
      const rel = relative(root, target)
      if (rel === '' || rel.startsWith('..') || isAbsolute(rel) || rel.includes(sep)) {
        throw new BridgeError('workspace/bad-name', '文件夹名不合法', 400)
      }
      if (!api.workspaces.supports('create')) {
        throw new BridgeError('workspace/unavailable', '当前 Host 不能创建工作区', 503)
      }
      // resolveByPath 在 0.2.x 是 async：适配层已经统一 await，这里不必再判类型。
      let workspace = await api.workspaces.resolveByPath(target)
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
        workspace = await api.workspaces.create(target, name)
      }
      api.sendJson(res, 200, {
        root,
        workspace: {
          id: workspace.id,
          path: workspace.path,
          title: workspace.title,
          updatedAt: toEpochMillis(workspace.updatedAt),
          sessionIds: workspace.sessionIds ?? []
        }
      })
      return true
    }

    return false
  }
}
