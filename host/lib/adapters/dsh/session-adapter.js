/**
 * 宿主会话适配层（R23）。
 *
 * 桥接原本到处直接摸 `ctx.sessionController.*`，宿主一改签名就要全仓找调用点。
 * 这一层只做两件事：
 *   1. 归一化返回形状（0.1.x 的 `{ items }` 与后来可能的裸数组都吃）；
 *   2. 参数形状集中在这里（`cancel`/`rename` 传的是对象，注册表那边是位置参数）。
 *
 * 它**不吞异常**：控制器抛什么就往上抛什么，由 server 映射成错误码——
 * 否则「会话运行中」「会话不存在」这类分支会失去依据。
 */

export function createSessionAdapter(ctx) {
  const controller = () => (ctx !== null && typeof ctx === 'object' ? ctx.sessionController : undefined)

  function requireMethod(name) {
    const target = controller()
    const fn = target?.[name]
    if (typeof fn !== 'function') {
      const error = new Error(`宿主缺少 sessionController.${name}`)
      error.code = 'adapter/unsupported'
      throw error
    }
    return fn.bind(target)
  }

  return {
    controller,
    supports(name) {
      return typeof controller()?.[name] === 'function'
    },
    /** 归一化成数组：`{ items: [...] }` 与 `[...]` 都返回数组。 */
    async list(signal, query = {}) {
      const value = await requireMethod('list')(query, signal)
      if (Array.isArray(value)) return value
      const items = value?.items
      return Array.isArray(items) ? items : []
    },
    async resolveAgent(sessionId) {
      return await requireMethod('resolveAgent')(sessionId)
    },
    async prompt(request, signal) {
      return await requireMethod('prompt')(request, signal)
    },
    async cancel(sessionId) {
      return await requireMethod('cancel')({ sessionId })
    },
    async rename(sessionId, title) {
      return await requireMethod('rename')({ sessionId, title })
    },
    async create(request) {
      return await requireMethod('create')(request)
    }
  }
}
