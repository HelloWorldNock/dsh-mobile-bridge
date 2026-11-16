/**
 * 宿主工作区适配层（R23）。
 *
 * 这一层的价值全在「读不到就当没有」：`list()` 抛错、`archivedSessionIds` 是拿不到的
 * getter（老宿主的只读扩展）、`resolveByPath` 在 0.2.x 变成 async——每种都在这里收口，
 * 调用方（server / events / history）不必各写一遍 `typeof === 'function'` 与 try/catch。
 *
 * 写操作（create / archive / unarchive / detach）**不吞异常**：
 *   `WorkspaceActiveSessionError` / `WorkspaceUnknownSessionError` 是 server 用来映射
 *   409 / 404 的依据，吞掉就变成「归档没反应」。
 */

export function createWorkspaceAdapter(ctx) {
  const registry = () => (ctx !== null && typeof ctx === 'object' ? ctx.workspaceRegistry : undefined)

  function method(name) {
    const target = registry()
    const fn = target?.[name]
    return typeof fn === 'function' ? fn.bind(target) : null
  }

  return {
    registry,
    supports(name) {
      return method(name) !== null
    },

    /** 工作区列表；读不到（或宿主没实现）就返回空数组，绝不让列表接口整体失败。 */
    list() {
      const fn = method('list')
      if (fn === null) return []
      try {
        const value = fn()
        return Array.isArray(value) ? value : []
      } catch {
        return []
      }
    },

    /**
     * 按路径找已登记的工作区。
     * 0.2.x 是 async，0.1.x 是同步——统一 await，两种情况都对。
     */
    async resolveByPath(path) {
      const fn = method('resolveByPath')
      if (fn === null) return undefined
      const value = await fn(path)
      return value ?? undefined
    },

    async create(path, title) {
      const fn = method('create')
      if (fn === null) {
        const error = new Error('宿主缺少 workspaceRegistry.create')
        error.code = 'adapter/unsupported'
        throw error
      }
      return await fn(path, title)
    },

    /**
     * 归档集合。它是读内存的同步 getter，取不到时按「没有归档」处理——
     * 绝不能因为读不到就把整个会话列表清空。
     */
    archivedIds() {
      try {
        const value = registry()?.archivedSessionIds
        return new Set(Array.isArray(value) ? value : [])
      } catch {
        return new Set()
      }
    },

    /**
     * 归档集合的原始数组版本，读不到时返回 null。
     * 事件轮询要用它区分「这一轮读不到」（保持基线不动）与「确实没有归档」（空数组）。
     */
    archivedIdsOrNull() {
      try {
        const value = registry()?.archivedSessionIds
        return Array.isArray(value) ? value : null
      } catch {
        return null
      }
    },

    async archive(sessionId) {
      const fn = method('archiveSession')
      if (fn === null) {
        const error = new Error('宿主缺少 workspaceRegistry.archiveSession')
        error.code = 'adapter/unsupported'
        throw error
      }
      return await fn(sessionId)
    },

    async unarchive(sessionId) {
      const fn = method('unarchiveSession')
      if (fn === null) {
        const error = new Error('宿主缺少 workspaceRegistry.unarchiveSession')
        error.code = 'adapter/unsupported'
        throw error
      }
      return await fn(sessionId)
    },

    /** 把会话从某个工作区里摘掉（彻底删除时用）。 */
    async detach(workspace, sessionId) {
      if (workspace === null || typeof workspace !== 'object') return
      if (typeof workspace.detachSession !== 'function') return
      await workspace.detachSession(sessionId)
    }
  }
}
