package com.ts7.dshremote.data

import java.net.URI

/**
 * 明文（http）白名单。
 *
 * 桥接本身不带 TLS：局域网和 tailnet 里跑的就是明文 HTTP，Tailscale 隧道负责加密。
 * 所以 App 不能对「任何地址」都允许明文——那样有人把主机名填成公网域名，token 就
 * 直接裸奔了。
 *
 * Android 的 `network_security_config.xml` 只能按域名逐条声明，表达不了「RFC1918
 * 整段允许」，所以在应用层补这道闸：只在私网字面量、tailnet、回环、链路本地、
 * 以及明确带内网后缀的主机名上允许明文，其余（公网 IP、公网域名）必须 https。
 */
object NetworkPolicy {
    /** 被拒时抛给上层看的错误码，手机端直接显示原因。 */
    const val BLOCKED_CODE = "network/cleartext-blocked"

    /** 内网专用的主机名后缀：这些名字只可能在局域网/tailnet 里解析。 */
    private val LAN_SUFFIXES = listOf(
        ".local",
        ".lan",
        ".home",
        ".home.arpa",
        ".internal",
        ".localdomain",
        ".intranet"
    )

    /**
     * 这个地址能不能走。
     * @return null 表示允许；否则返回一句可以直接显示给用户的原因。
     */
    fun check(rawUrl: String): String? {
        val url = normalizeBaseUrl(rawUrl)
        if (url.isBlank()) return "地址为空，先填电脑 IP 和端口"
        val uri = runCatching { URI(url) }.getOrNull() ?: return "地址格式不对：$rawUrl"
        val scheme = uri.scheme?.lowercase() ?: "http"
        if (scheme == "https") return null
        if (scheme != "http") return "只支持 http/https：$rawUrl"
        val host = uri.host?.trim('[', ']')?.takeIf { it.isNotBlank() } ?: return "地址里没有主机：$rawUrl"
        if (cleartextHostAllowed(host)) return null
        return "只允许局域网或 Tailscale 地址走明文：$host 是公网地址/域名。改用 https，或填电脑的 192.168/10/172.16-31 或 100.64-127 地址。"
    }

    /** 明文白名单判定（纯函数，方便单测）。 */
    fun cleartextHostAllowed(host: String): Boolean {
        val lower = host.trim().trim('[', ']').lowercase()
        if (lower.isEmpty()) return false
        if (lower == "localhost" || lower == "127.0.0.1" || lower == "::1") return true
        if (lower.contains(':')) return ipv6Allowed(lower)
        val octets = lower.split('.').map { it.toIntOrNull() }
        if (octets.size == 4 && octets.all { it != null }) return ipv4Allowed(octets.map { it!! })
        // 单标签主机名（如 `mypc`、`mumu-host`）只会在局域网里被解析。
        if (!lower.contains('.')) return true
        return LAN_SUFFIXES.any { lower.endsWith(it) }
    }

    private fun ipv4Allowed(octets: List<Int>): Boolean {
        if (octets.any { it !in 0..255 }) return false
        val first = octets[0]
        val second = octets[1]
        return first == 10 ||                       // 10.0.0.0/8
            first == 127 ||                         // 回环
            (first == 192 && second == 168) ||      // 192.168.0.0/16
            (first == 172 && second in 16..31) ||   // 172.16.0.0/12
            (first == 100 && second in 64..127) ||  // 100.64.0.0/10（tailnet / CGNAT）
            (first == 169 && second == 254) ||      // 链路本地
            first == 0                              // 0.0.0.0/8：本机语义
    }

    private fun ipv6Allowed(host: String): Boolean {
        val head = host.substringBefore('%')
        if (head == "::1") return true
        if (head.startsWith("fe80") || head.startsWith("fe8") || head.startsWith("fe9") ||
            head.startsWith("fea") || head.startsWith("feb")
        ) {
            return true // fe80::/10 链路本地
        }
        if (head.startsWith("fd") || head.startsWith("fc")) return true // fc00::/7 唯一本地
        // IPv4 映射地址 ::ffff:a.b.c.d
        if (head.startsWith("::ffff:")) {
            val tail = head.removePrefix("::ffff:")
            val octets = tail.split('.').mapNotNull { it.toIntOrNull() }
            if (octets.size == 4) return ipv4Allowed(octets)
        }
        return false
    }
}
