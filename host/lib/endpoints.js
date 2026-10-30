import os from 'node:os'

const VIRTUAL_NAMES = [
  /vmware/i,
  /virtualbox/i,
  /hyper-v/i,
  /vethernet/i,
  /loopback/i,
  /docker/i,
  /^br-/i,
  /^veth/i,
  /^virbr/i,
  /^vmnet/i,
  /^utun/i,
  /^tun\d/i,
  /^tap\d/i,
  /^zt/i
]

function isTailscale(name, address) {
  if (/tailscale/i.test(name)) return true
  const parts = address.split('.').map((part) => Number(part))
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false
  // Tailscale uses the 100.64.0.0/10 CGNAT range for its stable IPv4 addresses.
  return parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127
}

function isLinkLocal(address) {
  return address.startsWith('169.254.') || address === '0.0.0.0'
}

function isVirtual(name) {
  return VIRTUAL_NAMES.some((pattern) => pattern.test(name))
}

/**
 * Classify one IPv4 interface address for phone pairing.
 * "tailscale" addresses are reachable from outside the LAN through the tailnet.
 */
export function classifyAddress(name, address) {
  if (typeof address !== 'string' || isLinkLocal(address)) return null
  if (isTailscale(name, address)) return 'tailscale'
  if (isVirtual(name)) return null
  return 'lan'
}

/**
 * Build ordered connection candidates: LAN first, then Tailscale.
 * The phone probes candidates in order, so it uses the LAN at home and
 * falls back to the tailnet address when the phone leaves the network.
 *
 * `extra` carries endpoints that do not appear as a network interface — the
 * embedded tailnet node from lib/tailscale.js is the only current source.
 */
export function bridgeEndpoints(port, interfaces = os.networkInterfaces(), extra = []) {
  const seen = new Set()
  const lan = []
  const tailscale = []
  for (const [name, entries] of Object.entries(interfaces ?? {})) {
    for (const entry of entries ?? []) {
      if ((entry.family !== 'IPv4' && entry.family !== 4) || entry.internal) continue
      const kind = classifyAddress(name, entry.address)
      if (kind === null || seen.has(entry.address)) continue
      seen.add(entry.address)
      const endpoint = { kind, address: entry.address, url: `http://${entry.address}:${port}` }
      if (kind === 'tailscale') tailscale.push(endpoint)
      else lan.push(endpoint)
    }
  }
  for (const endpoint of extra ?? []) {
    if (endpoint === null || typeof endpoint !== 'object') continue
    const address = endpoint.address
    if (typeof address !== 'string' || address === '' || seen.has(address)) continue
    seen.add(address)
    tailscale.push({
      ...endpoint,
      kind: 'tailscale',
      address,
      url: typeof endpoint.url === 'string' && endpoint.url !== '' ? endpoint.url : `http://${address}:${port}`
    })
  }
  return [...lan, ...tailscale]
}

export function tailscaleEndpoints(port, interfaces = os.networkInterfaces(), extra = []) {
  return bridgeEndpoints(port, interfaces, extra).filter((endpoint) => endpoint.kind === 'tailscale')
}
