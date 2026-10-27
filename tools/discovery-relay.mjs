#!/usr/bin/env node
/**
 * LAN discovery relay for a DSH bridge that runs inside a VM behind NAT.
 *
 * The VM's UDP broadcast never reaches the phone. This relay listens on the
 * Windows host (port 48126, next to the direct 48124 used by DSH instances on
 * the LAN), asks the bridge for its discovery payload over HTTP, and rewrites
 * the reply so the phone sees the host's LAN address and forwarded TCP port
 * instead of the VM's private address. It falls back to the original UDP probe
 * when the HTTP endpoint is unavailable.
 *
 * Usage:
 *   node tools/discovery-relay.mjs ^
 *     --target 203.0.113.20:48124 ^
 *     --public-host 203.0.113.10 ^
 *     --public-port 48125 ^
 *     --tailscale-host 100.x.x.x
 */
import dgram from 'node:dgram'
import os from 'node:os'
import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const CONFIG_PATH = join(dirname(fileURLToPath(import.meta.url)), 'discovery-relay.json')

function loadConfig() {
  if (!existsSync(CONFIG_PATH)) return {}
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))
  } catch (error) {
    throw new Error(`cannot read ${CONFIG_PATH}: ${error.message}`)
  }
}

function parseArgs(argv) {
  const options = {
    listenPort: 48126,
    target: '203.0.113.20:48124',
    httpUrl: '',
    hostName: '',
    publicHost: '',
    publicPort: 48123,
    tailscaleHost: '',
    logPath: process.env.DSH_RELAY_LOG || '',
    ...loadConfig()
  }
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i]
    const value = argv[i + 1]
    if (!key.startsWith('--')) continue
    i += 1
    switch (key) {
      case '--target': options.target = value; break
      case '--http-url': options.httpUrl = value; break
      case '--host-name': options.hostName = value; break
      case '--public-host': options.publicHost = value; break
      case '--public-port': options.publicPort = Number(value); break
      case '--tailscale-host': options.tailscaleHost = value; break
      case '--listen-port': options.listenPort = Number(value); break
      case '--log': options.logPath = value; break
      default: throw new Error(`unknown option ${key}`)
    }
  }
  return options
}

function parseHostPort(value) {
  const index = value.lastIndexOf(':')
  if (index <= 0) throw new Error(`expected host:port, got ${value}`)
  const port = Number(value.slice(index + 1))
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error(`bad port in ${value}`)
  return { address: value.slice(0, index), port }
}

function firstLanAddress() {
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4' || entry.internal) continue
      if (entry.address.startsWith('169.254.')) continue
      if (entry.address.startsWith('100.')) continue
      return entry.address
    }
  }
  return '127.0.0.1'
}

function rewrite(reply, options, publicHost) {
  const port = options.publicPort
  const endpoints = []
  const add = (kind, host) => {
    if (!host) return
    const url = `http://${host}:${port}`
    if (!endpoints.some((item) => item.url === url)) endpoints.push({ kind, url })
  }
  add('lan', publicHost)
  if (options.tailscaleHost) add('tailscale', options.tailscaleHost)
  for (const item of Array.isArray(reply.endpoints) ? reply.endpoints : []) {
    if (item?.kind === 'lan') continue
    if (item?.kind === 'tailscale') continue
    if (typeof item?.url === 'string' && !endpoints.some((known) => known.url === item.url)) {
      endpoints.push({ kind: item.kind, url: item.url })
    }
  }
  return { ...reply, port, endpoints }
}

const options = parseArgs(process.argv.slice(2))

/**
 * When the relay is started hidden at logon there is no console to read, so the
 * two startup lines and any socket error are mirrored into a log file.
 */
if (options.logPath) {
  const logPath = options.logPath
  try {
    if (existsSync(logPath) && statSync(logPath).size > 1_000_000) writeFileSync(logPath, '')
  } catch { /* a broken log must not stop the relay */ }
  for (const level of ['log', 'error']) {
    const forward = console[level].bind(console)
    console[level] = (...args) => {
      forward(...args)
      try {
        appendFileSync(logPath, `${new Date().toISOString()} ${args.map((item) => String(item)).join(' ')}\n`)
      } catch { /* ignore */ }
    }
  }
}

const target = parseHostPort(options.target)
const publicHost = options.publicHost || firstLanAddress()
const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })

function relayOverUdp(message, remote) {
  const upstream = dgram.createSocket('udp4')
  const timer = setTimeout(() => {
    try { upstream.close() } catch { /* closed */ }
  }, 1_500)
  upstream.on('message', (reply) => {
    clearTimeout(timer)
    let payload
    try {
      payload = JSON.parse(reply.toString('utf8'))
    } catch {
      try { upstream.close() } catch { /* closed */ }
      return
    }
    if (payload?.type !== 'dsh-remote-bridge') {
      try { upstream.close() } catch { /* closed */ }
      return
    }
    socket.send(Buffer.from(JSON.stringify(rewrite(payload, options, publicHost))), remote.port, remote.address)
    try { upstream.close() } catch { /* closed */ }
  })
  upstream.on('error', () => {
    clearTimeout(timer)
    try { upstream.close() } catch { /* closed */ }
  })
  upstream.send(message, target.port, target.address)
}

async function getJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(1_500) })
  if (!response.ok) return null
  return response.json()
}

async function relayOverHttp(remote) {
  if (!options.httpUrl) return false
  try {
    const discoveryUrl = new URL(options.httpUrl)
    let payload = await getJson(discoveryUrl)
    if (payload?.type !== 'dsh-remote-bridge') {
      // Older bridges have /health but not /api/discovery. That still gives us
      // the device id and version needed for pairing; the display name comes
      // from the relay config.
      const health = await getJson(new URL('/health', discoveryUrl))
      if (!health?.ok || !health.deviceId) return false
      payload = {
        type: 'dsh-remote-bridge',
        version: 1,
        bridgeVersion: health.version,
        deviceId: health.deviceId,
        hostName: options.hostName || 'DSH-VM',
        port: options.publicPort,
        tls: false,
        endpoints: []
      }
    }
    socket.send(Buffer.from(JSON.stringify(rewrite(payload, options, publicHost))), remote.port, remote.address)
    return true
  } catch {
    return false
  }
}

socket.on('message', (message, remote) => {
  if (message.length > 2_048) return
  let probe
  try {
    probe = JSON.parse(message.toString('utf8'))
  } catch {
    return
  }
  if (probe?.type !== 'dsh-remote-discover') return
  relayOverHttp(remote).then((sent) => {
    if (!sent) relayOverUdp(message, remote)
  })
})

socket.on('listening', () => {
  console.log(`[discovery-relay] udp/${options.listenPort} -> ${target.address}:${target.port}`)
  console.log(`[discovery-relay] advertising http://${publicHost}:${options.publicPort}`)
})
socket.on('error', (error) => {
  console.error(`[discovery-relay] ${error.message}`)
  process.exitCode = 1
})
socket.bind(options.listenPort, '0.0.0.0')
