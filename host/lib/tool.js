const MAX_REPLY_CHARS = 4_000

function clip(text, max = MAX_REPLY_CHARS) {
  if (typeof text !== 'string') return ''
  return text.length > max ? `${text.slice(0, max)}\n…（已截断，共 ${text.length} 字）` : text
}

function formatFiles(files) {
  if (!Array.isArray(files) || files.length === 0) return ['（对端工作区里没有新增文件）']
  return files.slice(0, 40).map((file) => {
    const size = Number.isFinite(file?.size) ? `${Math.max(1, Math.round(file.size / 1024))}KB` : '?'
    return `· ${file?.rel ?? file?.name ?? '?'}（${size}）`
  })
}

function renderPeers(peers) {
  if (!Array.isArray(peers) || peers.length === 0) {
    return '绑定组里还没有其它 PC。在另一台 PC 的「手机远控」面板里创建绑定组，用邀请码把本机加入。'
  }
  const lines = [`绑定组共 ${peers.length} 台 PC：`]
  for (const peer of peers) {
    lines.push(`· ${peer.name}（${peer.deviceId}） ${peer.status === 'online' ? '在线' : '离线'} ${peer.baseUrl}`)
  }
  return lines.join('\n')
}

function renderValue(args, value) {
  if (value === null || typeof value !== 'object') return String(value)
  const action = typeof args?.action === 'string' ? args.action : ''
  if (action === 'peers') return renderPeers(value.peers)
  if (action === 'delegate' || action === 'status') {
    const lines = [
      `${value.peer ?? '?'} 上的会话 ${value.sessionId ?? '?'}：${value.status ?? (value.running ? 'running' : 'idle')}`,
      `工作区：${value.workspace ?? '(未记录)'}`,
      `耗时：${Number.isFinite(value.elapsedMs) ? `${Math.round(value.elapsedMs / 1000)}s` : '?'}`,
      '',
      clip(value.reply ?? '')
    ]
    if (Array.isArray(value.files)) {
      lines.push('', `新增产物 ${value.files.length} 个：`, ...formatFiles(value.files))
    }
    if (value.running === true) {
      lines.push('', '任务还在跑，可以稍后用 action=status 查看，或 action=files 直接看产物。')
    }
    return lines.join('\n')
  }
  if (action === 'files') {
    return [`${value.peer} 的 ${value.workspace} 下新增 ${Array.isArray(value.files) ? value.files.length : 0} 个文件：`, ...formatFiles(value.files)].join('\n')
  }
  if (action === 'fetch') {
    return `已把 ${value.source} 拉回本机：${value.saveAs}（${value.bytes} 字节）`
  }
  return JSON.stringify(value, null, 2)
}

/**
 * `collab` 工具：让本机 Agent 把活派给绑定组里的另一台 PC，并把产物只留在约定工作区。
 */
export function createCollabTool({ collab }) {
  return {
    name: 'collab',
    description:
      '与绑定组里的其它 PC 协作。action=peers 列出组内节点及其在线状态；action=delegate 在指定 peer 的某个工作区目录里新建 DSH 会话并执行 prompt，等待回合结束后返回回复与新增产物文件；action=status 查询已派工会话的进度；action=files 列出对端工作区里指定时间之后新增的文件；action=fetch 把对端工作区里的文件下载到本机（saveAs 用绝对路径）。产物只会落在 workspace 指定的目录里。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: {
          type: 'string',
          enum: ['peers', 'delegate', 'status', 'files', 'fetch'],
          description: '要执行的动作'
        },
        peer: { type: 'string', description: '目标 PC 的名字或 deviceId（action=peers 里能看到）' },
        workspace: { type: 'string', description: '对端工作区目录的绝对路径；产物只会写在这里' },
        prompt: { type: 'string', description: '派给对端 Agent 的完整任务描述（action=delegate）' },
        sessionId: { type: 'string', description: 'action=status 时的会话 id' },
        waitSeconds: { type: 'number', description: 'action=delegate 最多等多少秒，默认 240，上限 900' },
        since: { type: 'number', description: 'action=files 的时间下界（毫秒时间戳），默认 0 表示全部' },
        path: { type: 'string', description: 'action=fetch 时对端工作区内的相对路径' },
        saveAs: { type: 'string', description: 'action=fetch 时本机保存的绝对路径' }
      },
      required: ['action']
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render(args, value) {
        return [{ type: 'text', text: renderValue(args, value) }]
      }
    },
    async execute(args) {
      const action = typeof args?.action === 'string' ? args.action : ''
      if (action === 'peers') return { peers: await collab.listPeers() }
      if (action === 'delegate') {
        return await collab.delegate({
          peer: args.peer,
          workspace: args.workspace,
          prompt: args.prompt,
          waitMs: Number.isFinite(args.waitSeconds) ? args.waitSeconds * 1_000 : undefined
        })
      }
      if (action === 'status') return await collab.status({ peer: args.peer, sessionId: args.sessionId })
      if (action === 'files') {
        return await collab.files({ peer: args.peer, workspace: args.workspace, since: args.since })
      }
      if (action === 'fetch') {
        return await collab.fetchArtifact({
          peer: args.peer,
          workspace: args.workspace,
          path: args.path,
          saveAs: args.saveAs
        })
      }
      return { error: `未知的 action：${action}` }
    }
  }
}

/** 把工具挂到 Host 上：`tools` 服务不一定在，所以两种注册路径都试。 */
export function registerCollabTool({ ctx, tool, logger }) {
  const attempt = (scope) => {
    if (typeof scope?.tools?.register !== 'function') return false
    try {
      scope.tools.register(tool)
      return true
    } catch (error) {
      logger?.warn?.(`[mobile-bridge] collab tool registration failed: ${String(error?.message ?? error)}`)
      return false
    }
  }
  if (attempt(ctx)) return true
  if (typeof ctx?.inject === 'function') {
    try {
      ctx.inject(['tools'], (scope) => {
        if (!attempt(scope)) logger?.warn?.('[mobile-bridge] collab tool: tools service without register()')
      })
      return true
    } catch (error) {
      logger?.warn?.(`[mobile-bridge] collab tool inject failed: ${String(error?.message ?? error)}`)
    }
  }
  logger?.warn?.('[mobile-bridge] collab tool not registered: tools service unavailable')
  return false
}
