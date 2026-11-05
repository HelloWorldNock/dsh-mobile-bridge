package com.ts7.dshremote.data

import java.net.URI

/**
 * Endpoint ordering and merge rules for one paired desktop.
 *
 * A host may be reachable over several addresses. The stored order decides
 * which one a reconnect dials first; [preferLan] is the order used when the
 * phone picks a transport on its own, so a phone that comes back to the same
 * LAN returns to the direct route instead of staying on the tailnet.
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

    /**
     * Probe order for one host: the stored order, unchanged.
     *
     * A pairing sorts LAN first, so the phone uses the LAN at home and the
     * tailnet address elsewhere. A host that was explicitly paired over
     * Tailscale keeps its tailnet address in front, because the LAN address of
     * such a host (typically a NAT'd VM) is unreachable from the phone and
     * probing it first would only add a timeout to every reconnect. [preferLan]
     * overrides that order when the phone is the one choosing the route.
     */
    fun candidates(host: PairedHost): List<BridgeEndpoint> =
        merge(host.baseUrl, host.endpoints, emptyList(), sort = false)

    /**
     * The same endpoints with every LAN address in front, each group keeping
     * its stored order.
     *
     * Route selection uses this rather than [candidates]: a stored order that
     * leads with the tailnet address (a host paired over Tailscale, or an
     * address picked by hand) may say which address to dial first, but it must
     * not stop the phone from switching back to the LAN it is standing on.
     */
    fun preferLan(endpoints: List<BridgeEndpoint>): List<BridgeEndpoint> =
        endpoints.sortedBy { if (it.kind == LAN) 0 else 1 }

    /**
     * Split an address into the host/port a tailnet dial needs.
     * Returns null when the URL carries no usable host.
     */
    fun target(rawUrl: String): Pair<String, Int>? {
        val uri = runCatching { URI(normalizeBaseUrl(rawUrl)) }.getOrNull() ?: return null
        val host = uri.host?.trim('[', ']')?.takeIf { it.isNotBlank() } ?: return null
        val port = uri.port.takeIf { it in 1..65535 } ?: 80
        return host to port
    }

    /**
     * Pin the transport of one address. [merge] re-classifies every URL by its
     * literal shape, so a user who says "this one goes over Tailscale" (a
     * MagicDNS name, or a host-side port forward) needs the answer to stick.
     * With [first] the address also leads the probe order, so an explicit
     * tailnet pairing does not spend every reconnect on an unreachable LAN
     * endpoint first.
     */
    fun withKind(
        endpoints: List<BridgeEndpoint>,
        rawUrl: String,
        kind: String,
        first: Boolean = false
    ): List<BridgeEndpoint> {
        val target = normalizeBaseUrl(rawUrl)
        if (target.isBlank()) return endpoints
        val pinned = endpoints.map { if (normalizeBaseUrl(it.url) == target) it.copy(kind = kind) else it }
        if (!first) return pinned
        val match = pinned.firstOrNull { normalizeBaseUrl(it.url) == target } ?: return pinned
        return listOf(match) + pinned.filterNot { normalizeBaseUrl(it.url) == target }
    }

    /**
     * Merge endpoints reported by pairing/info with the ones already stored.
     * Invalid/blank URLs are dropped; duplicates collapse to the first URL.
     *
     * [sort] puts LAN endpoints first, which is the right default when a pairing
     * establishes the order. Callers that re-merge an already stored list pass
     * `false`: the stored order carries the user's intent (a host paired over
     * Tailscale must not fall back to probing a LAN address that the phone can
     * never reach).
     */
    fun merge(
        baseUrl: String?,
        existing: List<BridgeEndpoint>,
        incoming: List<BridgeEndpoint>,
        sort: Boolean = true
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
        return if (sort) ordered.values.sortedBy { if (it.kind == LAN) 0 else 1 } else ordered.values.toList()
    }
}
