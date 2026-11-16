/**
 * 启动兼容性探针。
 *
 * 桥接不是「装上就一直能用」：宿主 DSH 升级时，`sessionController` / `workspaceRegistry`
 * 的方法会改名、改签名、改同步异步。这些变化不会报错，只会让某些按钮点了没反应
 * （0.2.x 那次就是 `resolveByPath` 变 async、`settings.plugin.item` 换插槽）。
 *
 * 这里在启动时把桥接真正用到的那一层接口逐个点一遍，结果写运行日志、也给面板一份，
 * 让「装上了但某块功能是坏的」变成一句能读懂的警告。
 *
 * 只读、无副作用：只查属性与 `Function.length`，不调用任何宿主方法。
 */

/** 期望的宿主接口。required=false 的缺失只降级、不影响主链路。 */
const HOST_SURFACE = [
  // 会话控制器：任务列表 / 发 prompt / 停止 / 重命名 / 新建
  { id: 'sessionController', path: ['sessionController'], kind: 'object', required: true },
  { id: 'sessionController.list', path: ['sessionController', 'list'], kind: 'function', required: true, minArgs: 0, maxArgs: 1 },
  { id: 'sessionController.prompt', path: ['sessionController', 'prompt'], kind: 'function', required: true, minArgs: 2, maxArgs: 4 },
  { id: 'sessionController.cancel', path: ['sessionController', 'cancel'], kind: 'function', required: true, minArgs: 1, maxArgs: 2 },
  { id: 'sessionController.rename', path: ['sessionController', 'rename'], kind: 'function', required: true, minArgs: 2, maxArgs: 3 },
  { id: 'sessionController.create', path: ['sessionController', 'create'], kind: 'function', required: false, minArgs: 0, maxArgs: 3 },
  { id: 'sessionController.resolveAgent', path: ['sessionController', 'resolveAgent'], kind: 'function', required: false },
  { id: 'sessionController.follow', path: ['sessionController', 'follow'], kind: 'function', required: false, minArgs: 1, maxArgs: 3 },

  // 工作区注册表：工作区列表 / 新建 / 按路径解析 / 归档
  { id: 'workspaceRegistry', path: ['workspaceRegistry'], kind: 'object', required: true },
  { id: 'workspaceRegistry.list', path: ['workspaceRegistry', 'list'], kind: 'function', required: true },
  { id: 'workspaceRegistry.create', path: ['workspaceRegistry', 'create'], kind: 'function', required: false },
  { id: 'workspaceRegistry.resolveByPath', path: ['workspaceRegistry', 'resolveByPath'], kind: 'function', required: false, minArgs: 1 },
  { id: 'workspaceRegistry.unarchiveSession', path: ['workspaceRegistry', 'unarchiveSession'], kind: 'function', required: false },
  { id: 'workspaceRegistry.archivedSessionIds', path: ['workspaceRegistry', 'archivedSessionIds'], kind: 'property', required: false },

  // 宿主总线：审批/提问靠它挂 waterfall，服务定位靠 ctx.get
  { id: 'on', path: ['on'], kind: 'function', required: true },
  { id: 'get', path: ['get'], kind: 'function', required: true },
  { id: 'effect', path: ['effect'], kind: 'function', required: false },
  { id: 'logger', path: ['logger'], kind: 'object', required: false },
  { id: 'slots', path: ['slots'], kind: 'object', required: false },
  { id: 'attachments', path: ['attachments'], kind: 'object', required: false }
]

/** 桥接通过 ctx.get(名称) 取的可选服务；缺哪个就少哪块功能。 */
const OPTIONAL_SERVICES = [
  { name: 'typertGateway', impact: '审批/提问的事件投影退化（手机卡片仍可用，但计划正文可能为空）' },
  { name: 'commands', impact: '计划模式开关（/plan）不可用' },
  { name: 'permissionPresets', impact: '新建任务页的权限预设列表为空' },
  { name: 'sessions', impact: '会话元数据的补充字段缺失' }
]

function readPath(ctx, path) {
  let cursor = ctx
  for (const key of path) {
    if (cursor === null || cursor === undefined) return { found: false, value: undefined, at: key }
    cursor = cursor[key]
  }
  return { found: cursor !== undefined && cursor !== null, value: cursor }
}

function describe(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

function checkOne(ctx, spec) {
  const { found, value } = readPath(ctx, spec.path)
  const where = spec.path.join('.')
  if (!found) {
    return {
      id: spec.id,
      where,
      required: spec.required,
      status: spec.required ? 'missing' : 'degraded',
      detail: spec.required ? '宿主没有这个接口' : '宿主没有这个接口，相关功能降级'
    }
  }
  if (spec.kind === 'function' && typeof value !== 'function') {
    return { id: spec.id, where, required: spec.required, status: 'mismatch', detail: `期望 function，实际 ${describe(value)}` }
  }
  if (spec.kind === 'object' && (typeof value !== 'object' || value === null)) {
    return { id: spec.id, where, required: spec.required, status: 'mismatch', detail: `期望 object，实际 ${describe(value)}` }
  }
  if (spec.kind === 'function' && (spec.minArgs !== undefined || spec.maxArgs !== undefined)) {
    // Function.length 只数到第一个默认值/剩余参数为止，所以只做「明显不符」的判断：
    // 少于下限说明参数被合并/删除；正好为 0 且期望带参，说明签名漂了。
    const arity = value.length
    const belowMin = spec.minArgs !== undefined && arity < spec.minArgs
    const aboveMax = spec.maxArgs !== undefined && arity > spec.maxArgs
    if (belowMin || aboveMax) {
      return {
        id: spec.id,
        where,
        required: spec.required,
        status: spec.required ? 'mismatch' : 'degraded',
        detail: `签名可疑：声明 ${arity} 个参数，期望 ${spec.minArgs ?? 0}–${spec.maxArgs ?? '∞'}`
      }
    }
    if (spec.id === 'workspaceRegistry.resolveByPath' && value.constructor?.name !== 'AsyncFunction') {
      return {
        id: spec.id,
        where,
        required: false,
        status: 'degraded',
        detail: '同步实现：0.2.x 起应为 async，桥接已统一 await，能跑但建议核对'
      }
    }
    return { id: spec.id, where, required: spec.required, status: 'ok', detail: `${arity} 个参数` }
  }
  return { id: spec.id, where, required: spec.required, status: 'ok', detail: spec.kind }
}

function checkServices(ctx) {
  if (typeof ctx.get !== 'function') return []
  return OPTIONAL_SERVICES.map((service) => {
    let found = false
    try {
      const value = ctx.get(service.name)
      found = value !== undefined && value !== null
    } catch {
      found = false
    }
    return {
      id: `service.${service.name}`,
      where: `get('${service.name}')`,
      required: false,
      status: found ? 'ok' : 'degraded',
      detail: found ? '已注册' : service.impact
    }
  })
}

/**
 * @param {object} ctx 宿主插件上下文
 * @param {{version?: string}} [options] 插件自身版本，写进快照便于对照
 * @returns {{ok: boolean, version: string|null, checkedAt: string, checks: object[], problems: string[], warnings: string[], summary: string}}
 */
export function checkHostCompatibility(ctx, options = {}) {
  const target = ctx !== null && typeof ctx === 'object' ? ctx : {}
  const checks = HOST_SURFACE.map((spec) => checkOne(target, spec)).concat(checkServices(target))
  const problems = checks.filter((check) => check.status === 'missing' || check.status === 'mismatch').map((check) => `${check.where}：${check.detail}`)
  const warnings = checks.filter((check) => check.status === 'degraded').map((check) => `${check.where}：${check.detail}`)
  const ok = problems.length === 0
  const summary = ok
    ? warnings.length === 0
      ? '宿主接口齐全'
      : `主链路可用，${warnings.length} 项降级`
    : `${problems.length} 项必需接口不兼容，相关功能不可用`
  return {
    ok,
    version: typeof options.version === 'string' ? options.version : null,
    checkedAt: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    checks,
    problems,
    warnings,
    summary
  }
}

/** 把探针结果写进运行日志：有问题按 warn，只有降级按 info，全绿一行带过。 */
export function logCompatibility(report, logger) {
  if (report === null || typeof report !== 'object') return
  const tag = '[mobile-bridge] 宿主兼容性'
  if (!report.ok) {
    logger?.warn?.(`${tag}：${report.summary}`)
    for (const problem of report.problems) logger?.warn?.(`${tag} ✗ ${problem}`)
  }
  for (const warning of report.warnings) logger?.info?.(`${tag} · ${warning}`)
  if (report.ok && report.warnings.length === 0) logger?.info?.(`${tag}：${report.summary}`)
}
