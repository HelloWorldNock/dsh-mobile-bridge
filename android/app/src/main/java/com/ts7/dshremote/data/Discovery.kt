package com.ts7.dshremote.data

import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InterfaceAddress
import java.net.NetworkInterface
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable

@Serializable
data class DiscoveryPacket(
    val type: String? = null,
    val version: Int = 0,
    val bridgeVersion: String? = null,
    val deviceId: String? = null,
    val hostName: String? = null,
    val port: Int = 48123,
    val tls: Boolean = false
)

data class DiscoveredHost(
    val address: String,
    val port: Int,
    val deviceId: String?,
    val hostName: String?,
    val bridgeVersion: String?
) {
    val baseUrl: String get() = "http://$address:$port"
    val label: String get() = hostName?.takeIf { it.isNotBlank() } ?: address
}

object Discovery {
    private const val DISCOVERY_PORT = 48124

    suspend fun scan(timeoutMs: Long = 1_600): List<DiscoveredHost> = withContext(Dispatchers.IO) {
        val found = LinkedHashMap<String, DiscoveredHost>()
        val request = """{"type":"dsh-remote-discover"}""".toByteArray()
        val targets = broadcastTargets()
        DatagramSocket().use { socket ->
            socket.broadcast = true
            socket.soTimeout = 200
            for (target in targets) {
                try {
                    socket.send(DatagramPacket(request, request.size, target, DISCOVERY_PORT))
                } catch (_: Throwable) {
                    // try the next interface
                }
            }
            val deadline = System.currentTimeMillis() + timeoutMs
            val buffer = ByteArray(2_048)
            while (System.currentTimeMillis() < deadline) {
                val packet = DatagramPacket(buffer, buffer.size)
                try {
                    socket.receive(packet)
                } catch (_: java.net.SocketTimeoutException) {
                    continue
                } catch (_: Throwable) {
                    break
                }
                val text = String(packet.data, 0, packet.length)
                val parsed = runCatching {
                    JsonConfig.json.decodeFromString(DiscoveryPacket.serializer(), text)
                }.getOrNull() ?: continue
                if (parsed.type != "dsh-remote-bridge") continue
                val host = packet.address.hostAddress ?: continue
                val port = if (parsed.port in 1..65535) parsed.port else 48123
                found["$host:$port"] = DiscoveredHost(
                    address = host,
                    port = port,
                    deviceId = parsed.deviceId,
                    hostName = parsed.hostName,
                    bridgeVersion = parsed.bridgeVersion
                )
            }
        }
        found.values.toList()
    }

    private fun broadcastTargets(): List<InetAddress> {
        val targets = LinkedHashSet<InetAddress>()
        runCatching { targets += InetAddress.getByName("255.255.255.255") }
        runCatching {
            for (network in NetworkInterface.getNetworkInterfaces()) {
                if (!network.isUp || network.isLoopback) continue
                for (address: InterfaceAddress in network.interfaceAddresses) {
                    address.broadcast?.let { targets += it }
                }
            }
        }
        return targets.toList()
    }
}
