/**
 * 面板设置路由族（R21 第二刀）。
 *
 * 覆盖 `/api/setup/*`：状态、内嵌 Tailscale、导出日志、刷新配对码、撤销设备、
 * 改设置、绑定组操作、重置。
 *
 * 与其它路由族的差别：这里**自己**做两层把关——只允许 loopback，POST 还要 CSRF。
 * 这两条是面板的安全边界，不能因为「server 已经解析过身份」就省掉，所以检查写在模块里，
 * 由模块在进入任何具体动作前执行。
 */
import { BridgeError } from '../auth.js'
import { clampLogLines, fileStamp } from '../services/format.js'

/**
 * @param {object} api
 * @param {(req) => boolean} api.isLoopback
 * @param {(req) => void} api.checkCsrf
 * @param {(res, status, body) => void} api.sendJson
 * @param {(res, status, text, filename) => void} api.sendText
 * @param {(req) => Promise<object>} api.readJson
 * @param {() => Promise<object>} api.setupState
 * @param {(opts: {lines: number}) => string} api.logBundle
 * @param {any|null} api.tailscale
 * @param {any|null} api.updater
 * @param {any} api.auth
 * @param {any|null} api.group
 * @param {{closeDevice:(id:string)=>void, closeAll:()=>void}} api.broadcast
 * @param {{revalidate:()=>void}} api.approvals
 * @param {() => void} [api.onDiscoveryChange]
 * @param {{warn?: Function}} [api.logger]
 * @param {() => string|null} api.collabRoot
 * @param {() => {id:string}|null} api.collabWorkspace
 * @param {(peerUrl:string, explicitUrl?:string) => string} api.advertisedBaseUrl
 */
export function createSetupRoutes(api) {
  function notifyDiscovery(kind) {
    try {
      api.onDiscoveryChange?.()
    } catch (error) {
      api.logger?.warn?.(`[mobile-bridge] ${kind} notify failed: ${String(error)}`)
    }
  }

  return async function handleSetupRoutes({ req, res, url, method, path }) {
    if (!path.startsWith('/api/setup/')) return false
    if (!api.isLoopback(req)) throw new BridgeError('setup/forbidden', '设置接口仅允许本机访问', 403)

    if (method === 'GET' && path === '/api/setup/state') {
      api.sendJson(res, 200, await api.setupState())
      return true
    }
    if (method === 'GET' && path === '/api/setup/tailscale') {
      api.sendJson(res, 200, { tailscale: api.tailscale?.status?.() ?? null })
      return true
    }
    // PC 面板的「导出运行日志」：本机回环 + 只读，返回可直接保存的 .log。
    if (method === 'GET' && path === '/api/setup/logs') {
      api.sendText(
        res,
        200,
        api.logBundle({ lines: clampLogLines(url.searchParams.get('lines')) }),
        `dsh-remote-host-${fileStamp()}.log`
      )
      return true
    }
    if (method !== 'POST') throw new BridgeError('method/not-allowed', '方法不允许', 405)
    api.checkCsrf(req)

    if (path === '/api/setup/tailscale') {
      const tailscale = api.tailscale
      if (tailscale === null || tailscale === undefined) {
        throw new BridgeError('tailscale/unavailable', '内置 Tailscale 节点不可用', 503)
      }
      const body = await api.readJson(req)
      const action = typeof body.action === 'string' ? body.action : ''
      const value = typeof body.value === 'string' ? body.value : ''
      if (action === 'enable') await tailscale.setEnabled(true)
      else if (action === 'disable') await tailscale.setEnabled(false)
      else if (action === 'authkey') await tailscale.setAuthKey(value)
      else if (action === 'hostname') await tailscale.setHostname(value)
      else if (action === 'statedir') await tailscale.setStateDir(value)
      else if (action === 'restart') await tailscale.restart()
      else throw new BridgeError('setup/bad-request', '未知的 Tailscale 操作', 400)
      notifyDiscovery('discovery')
      api.sendJson(res, 200, { ok: true, tailscale: tailscale.status() })
      return true
    }

    if (path === '/api/setup/update') {
      if (api.updater === null || api.updater === undefined) {
        throw new BridgeError('update/unavailable', '当前版本不支持检查更新', 503)
      }
      const body = await api.readJson(req)
      const update = await api.updater.check({ force: body.force === true })
      api.sendJson(res, 200, { ok: true, update })
      return true
    }

    if (path === '/api/setup/code') {
      const pairing = api.auth.rotateCode()
      api.sendJson(res, 200, { code: pairing.code, expiresAt: new Date(pairing.expiresAt).toISOString() })
      return true
    }

    if (path === '/api/setup/revoke') {
      const body = await api.readJson(req)
      if (typeof body.deviceId !== 'string') throw new BridgeError('setup/bad-request', '缺少 deviceId', 400)
      const revoked = api.auth.revoke(body.deviceId)
      if (!revoked) throw new BridgeError('setup/not-found', '设备不存在', 404)
      api.broadcast.closeDevice(body.deviceId)
      api.approvals.revalidate()
      api.sendJson(res, 200, { ok: true })
      return true
    }

    if (path === '/api/setup/settings') {
      const body = await api.readJson(req)
      const next = api.auth.updateSettings(body)
      notifyDiscovery('discovery toggle')
      api.sendJson(res, 200, { settings: next })
      return true
    }

    if (path === '/api/setup/group') {
      const group = api.group
      if (group === null || group === undefined) throw new BridgeError('group/unavailable', '绑定组功能不可用', 503)
      const body = await api.readJson(req)
      const action = typeof body.action === 'string' ? body.action : ''
      if (action === 'create') {
        api.sendJson(res, 200, group.create({ name: body.name }))
        return true
      }
      if (action === 'invite') {
        api.sendJson(res, 200, { invite: group.rotateInvite(), ...group.snapshot() })
        return true
      }
      if (action === 'join') {
        const selfBaseUrl = api.advertisedBaseUrl(body.baseUrl, body.selfBaseUrl)
        api.sendJson(
          res,
          200,
          await group.joinRemote({
            baseUrl: body.baseUrl,
            code: body.code,
            selfBaseUrl,
            collabRoot: api.collabRoot(),
            collabWorkspaceId: api.collabWorkspace()?.id ?? null
          })
        )
        return true
      }
      if (action === 'leave') {
        api.sendJson(res, 200, group.leave())
        return true
      }
      if (action === 'forget') {
        const removed = group.removePeer(typeof body.deviceId === 'string' ? body.deviceId : '')
        api.sendJson(res, 200, { removed, ...group.snapshot() })
        return true
      }
      if (action === 'refresh') {
        await group.refresh()
        api.sendJson(res, 200, group.snapshot())
        return true
      }
      throw new BridgeError('setup/bad-request', '未知的绑定组操作', 400)
    }

    if (path === '/api/setup/reset') {
      api.auth.revokeAll()
      api.auth.rotateCode()
      api.broadcast.closeAll()
      api.approvals.revalidate()
      api.sendJson(res, 200, { ok: true })
      return true
    }

    throw new BridgeError('not-found', '未知的设置接口', 404)
  }
}
