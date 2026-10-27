package com.ts7.dshremote.data

import java.net.URI

/**
 * Endpoint ordering and merge rules for one paired desktop.
 *
 * A host may be reachable over several addresses: LAN first, Tailscale second.
 * The repository probes them in this order every time it (re)connects, so the
 * phone automatically uses the LAN at home and the tailnet address elsewhere.
 */
object Endpoints {
    const val LAN = "lan"
    const val TAILSCALE = "tailscale"

    fun label(kind: String?): String = when (kind) {
        TAILSCALE -> "Tailscale"
        LAN -> "局域网"
        else -> "未知"
    }

    /** Classify an address without trusting the label reported by an old host. */
    fun kindOf(rawUrl: String): String {
        val url = normalizeBaseUrl(rawUrl)
        val host = runCatching { URI(url).host }.getOrNull()?.trim('[', ']') ?: return LAN
        val parts = host.split('.').mapNotNull { it.toIntOrNull() }
        if (parts.size != 4) return LAN
        return if (parts[0] == 100 && parts[1] in 64..127) TAILSCALE else LAN
    }

    fun candidates(host: PairedHost): List<BridgeEndpoint> =
        merge(host.baseUrl, host.endpoints, emptyList())

    /**
     * Merge endpoints reported by pairing/info with the ones already stored.
     * Invalid/blank URLs are dropped; duplicates collapse to the first URL.
     */
    fun merge(
        baseUrl: String?,
        existing: List<BridgeEndpoint>,
        incoming: List<BridgeEndpoint>
    ): List<BridgeEndpoint> {
        val ordered = LinkedHashMap<String, BridgeEndpoint>()
        fun add(endpoint: BridgeEndpoint) {
            val url = normalizeBaseUrl(
                endpoint.url.ifBlank {
                    endpoint.address?.takeIf { it.isNotBlank() }?.let { "http://$it" }.orEmpty()
                }
            )
            if (url.isBlank()) return
            val kind = kindOf(url)
            val merged = endpoint.copy(kind = kind, url = url)
            ordered.putIfAbsent(url, merged)
        }
        existing.forEach { add(it) }
        incoming.forEach { add(it) }
        if (!baseUrl.isNullOrBlank()) add(BridgeEndpoint(kind = kindOf(baseUrl), url = baseUrl))
        return ordered.values.sortedBy { if (it.kind == LAN) 0 else 1 }
    }
}
