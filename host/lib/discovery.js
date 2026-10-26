import dgram from 'node:dgram'

const DISCOVER_TYPE = 'dsh-remote-discover'
const ANNOUNCE_TYPE = 'dsh-remote-bridge'

/**
 * Answer LAN discovery probes from the Android app. The reply carries only
 * non-secret addressing data; pairing still needs the 6-digit code.
 */
export function createDiscovery({ port, bridgePort, deviceId, hostName, version, logger }) {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
  let closed = false

  socket.on('error', (error) => {
    logger?.warn?.(`[mobile-bridge] discovery socket error: ${String(error?.message ?? error)}`)
    try {
      socket.close()
    } catch {
      // already closed
    }
  })

  socket.on('message', (message, remote) => {
    if (message.length > 2_048) return
    let probe
    try {
      probe = JSON.parse(message.toString('utf8'))
    } catch {
      return
    }
    if (probe === null || typeof probe !== 'object' || probe.type !== DISCOVER_TYPE) return
    const reply = Buffer.from(
      JSON.stringify({
        type: ANNOUNCE_TYPE,
        version: 1,
        bridgeVersion: version ?? null,
        deviceId,
        hostName,
        port: bridgePort,
        tls: false
      })
    )
    socket.send(reply, remote.port, remote.address, (error) => {
      if (error !== undefined && error !== null) {
        logger?.warn?.(`[mobile-bridge] discovery reply failed: ${String(error.message ?? error)}`)
      }
    })
  })

  socket.bind(port, '0.0.0.0', () => {
    try {
      socket.setBroadcast(true)
    } catch {
      // broadcast is best effort
    }
    logger?.info?.(`[mobile-bridge] discovery listening on udp/${port}`)
  })

  function close() {
    if (closed) return
    closed = true
    try {
      socket.close()
    } catch {
      // already closed
    }
  }

  return { close }
}
