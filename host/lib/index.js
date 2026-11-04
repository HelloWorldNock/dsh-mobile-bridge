import os from 'node:os'
import { loadState, saveState, defaultStatePath } from './state.js'
import { createAuth } from './auth.js'
import { createBroadcaster, createSessionHub } from './events.js'
import { createApprovals } from './approvals.js'
import { createBridgeServer } from './server.js'
import { createDiscovery } from './discovery.js'
import { createTailscale } from './tailscale.js'
import { createGroup } from './group.js'
import { createCollab } from './collab.js'
import { createCollabTool, registerCollabTool } from './tool.js'

export const name = 'mobile-bridge'
export const inject = ['sessionController', 'workspaceRegistry']

const VERSION = '0.8.2'
const DEFAULTS = {
  port: 48123,
  discoveryPort: 48124,
  bindHost: '0.0.0.0',
  discovery: true,
  phoneFirst: true,
  approvalTimeoutMs: 30_000,
  questionTimeoutMs: 60_000,
  planReviewTimeoutMs: 120_000
}

function positivePort(value, fallback) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 65_535 ? value : fallback
}

function timeout(value, fallback) {
  return Number.isFinite(value) && value >= 1_000 && value <= 600_000 ? Math.round(value) : fallback
}

export function apply(ctx, config) {
  const raw = config !== null && typeof config === 'object' ? config : {}
  const logger = ctx.logger ?? console
  const cfg = {
    port: positivePort(raw.port, DEFAULTS.port),
    discoveryPort: positivePort(raw.discoveryPort, DEFAULTS.discoveryPort),
    bindHost: typeof raw.bindHost === 'string' && raw.bindHost !== '' ? raw.bindHost : DEFAULTS.bindHost,
    maxEventBytes: Number.isFinite(raw.maxEventBytes) ? raw.maxEventBytes : 32_768
  }

  let stopped = false
  let server = null
  let discovery = null
  let tailscale = null
  let hub = null
  let approvals = null
  let broadcast = null
  let group = null
  let collab = null
  let actualPort = cfg.port

  async function start() {
    const state = await loadState()
    const statePath = defaultStatePath()
    if (typeof raw.hostName === 'string' && raw.hostName.trim() !== '') state.hostName = raw.hostName.trim()
    if (typeof raw.phoneFirst === 'boolean') state.settings.phoneFirst = raw.phoneFirst
    if (typeof raw.discovery === 'boolean') state.settings.discovery = raw.discovery
    if (Number.isFinite(raw.approvalTimeoutMs)) state.settings.approvalTimeoutMs = timeout(raw.approvalTimeoutMs, DEFAULTS.approvalTimeoutMs)
    if (Number.isFinite(raw.questionTimeoutMs)) state.settings.questionTimeoutMs = timeout(raw.questionTimeoutMs, DEFAULTS.questionTimeoutMs)
    if (Number.isFinite(raw.planReviewTimeoutMs)) state.settings.planReviewTimeoutMs = timeout(raw.planReviewTimeoutMs, DEFAULTS.planReviewTimeoutMs)

    const auth = createAuth({
      state,
      save: () => saveState(state, statePath),
      settings: state.settings,
      logger
    })

    // 绑定组：同一部手机绑定过的 PC 端互相登记，形成可协作的小组。
    group = createGroup({
      state,
      save: () => saveState(state, statePath),
      logger,
      port: () => actualPort
    })
    collab = createCollab({ group, logger })

    // 嵌入式 userspace tailnet 节点：手机在没有系统 Tailscale 的 PC 上也能连。
    tailscale = createTailscale({
      settings: state.settings,
      save: () => saveState(state, statePath),
      logger,
      deviceId: state.deviceId
    })
    tailscale.onStatusChange(() => syncDiscovery())

    broadcast = createBroadcaster({ logger })
    hub = createSessionHub({
      ctx,
      controller: ctx.sessionController,
      broadcast,
      logger,
      onTurnEnd: (payload) => {
        broadcast.broadcast('notice', {
          kind: 'turn-end',
          sessionId: payload.sessionId,
          title: payload.title,
          text: payload.text,
          durationMs: payload.durationMs,
          reason: payload.reason
        })
      },
      onTurnError: (payload) => {
        broadcast.broadcast('notice', {
          kind: 'turn-error',
          sessionId: payload.sessionId,
          title: payload.title,
          text: payload.message
        })
      }
    })

    approvals = createApprovals({
      ctx,
      broadcast,
      settings: state.settings,
      logger,
      titleFor: (sessionId) => hub.summaries.get(sessionId)?.title ?? null,
      onAttention: (payload) => {
        broadcast.broadcast('notice', { kind: 'attention', ...payload })
      }
    })

    function syncDiscovery() {
      if (stopped) return
      if (state.settings.discovery === true && discovery === null) {
        discovery = createDiscovery({
          port: cfg.discoveryPort,
          bridgePort: actualPort,
          deviceId: state.deviceId,
          hostName: state.hostName,
          version: VERSION,
          logger,
          extraEndpoints: () => tailscale?.endpoints() ?? []
        })
      } else if (state.settings.discovery !== true && discovery !== null) {
        discovery.close()
        discovery = null
      }
    }

    server = createBridgeServer({
      config: { ...cfg, port: actualPort },
      state,
      auth,
      broadcast,
      hub,
      approvals,
      settings: state.settings,
      logger,
      version: VERSION,
      ctx,
      onDiscoveryChange: syncDiscovery,
      tailscale,
      group
    })

    actualPort = await server.listen()
    await tailscale.configure(actualPort)
    await tailscale.start()
    group.start()
    registerCollabTool({ ctx, tool: createCollabTool({ collab }), logger })
    syncDiscovery()
    logger.info?.(`[mobile-bridge] listening on http://${cfg.bindHost}:${actualPort} (discovery udp/${cfg.discoveryPort})`)
    logger.info?.(`[mobile-bridge] open http://127.0.0.1:${actualPort}/ on this PC to pair a phone`)
  }

  const ready = start().catch((error) => {
    logger.error?.(`[mobile-bridge] failed to start: ${error?.stack ?? String(error)}`)
  })

  ctx.effect(() => {
    return () => {
      stopped = true
      void (async () => {
        await ready
        try {
          discovery?.close()
          discovery = null
          group?.dispose()
          await tailscale?.dispose()
          await server?.close()
          approvals?.dispose()
          hub?.dispose()
          broadcast?.dispose()
        } catch (error) {
          logger.warn?.(`[mobile-bridge] shutdown failed: ${String(error)}`)
        }
      })()
    }
  })
}
