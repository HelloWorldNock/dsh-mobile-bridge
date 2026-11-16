package com.ts7.dshremote.data

/**
 * 选路决策（R19 第一刀）：把「该不该切线路」「探哪里、等多久」「是不是同一台主机」这几条
 * 纯规则从 `BridgeRepository` 里拿出来，这样能在 JVM 上直接验，不必起协程或连真机。
 *
 * 仓库里剩下的是副作用部分：真的发请求、真的 promote、真的 restart。
 */
object ConnectionRouter {
    /** 连上 tailnet 后隔一会儿再探局域网：太早会和首次连接的探测抢同一条链路。 */
    const val LAN_PROBE_DELAY_MS = 1_500L

    /** 探测超时：局域网快，tailnet 要过隧道。 */
    const val LAN_PROBE_TIMEOUT_MS = 1_800L
    const val TAILSCALE_PROBE_TIMEOUT_MS = 3_500L

    fun probeTimeoutMs(kind: String?): Long =
        if (kind == Endpoints.TAILSCALE) TAILSCALE_PROBE_TIMEOUT_MS else LAN_PROBE_TIMEOUT_MS

    /**
     * 手机换网后要不要切线路。
     *
     * 只在「选出来的是另一条地址」或「当前根本没连上」时切；地址没变就不动，
     * 免得普通网络抖动把 SSE 打断。
     *
     * @param currentBaseUrl 当前 runtime 的地址（未归一化）
     * @param candidate 探测到可用的地址；null 表示没探到，维持现状
     * @param connected 当前是否处于已连接状态
     */
    fun shouldSwitch(currentBaseUrl: String, candidate: BridgeEndpoint?, connected: Boolean): Boolean {
        if (candidate == null) return false
        val current = normalizeBaseUrl(currentBaseUrl)
        val next = normalizeBaseUrl(candidate.url)
        return next != current || !connected
    }

    /** 只有「新地址在局域网、且和当前不同」才值得 promote（把 LAN 提到最前并持久化）。 */
    fun shouldPromoteLan(candidate: BridgeEndpoint?, currentBaseUrl: String): Boolean {
        if (candidate == null || candidate.kind != Endpoints.LAN) return false
        return normalizeBaseUrl(candidate.url) != normalizeBaseUrl(currentBaseUrl)
    }

    /**
     * 这个地址报上来的主机是不是我们配对的那台。
     *
     * 换机或重装会换 deviceId：App 必须拒绝，否则任务会被发到另一台 DSH。
     * 任一侧没有 deviceId 时不做判断（老版本桥接不报这个字段）。
     */
    fun deviceMatches(expected: String?, reported: String?): Boolean {
        val left = expected?.takeIf { it.isNotBlank() } ?: return true
        val right = reported?.takeIf { it.isNotBlank() } ?: return true
        return left == right
    }

    /**
     * 探活顺序：`preferLan` 时把局域网地址提到最前（其余保持存储顺序）。
     * 没有偏好就用存储顺序——那是用户配对时定下的意图。
     */
    fun probeOrder(endpoints: List<BridgeEndpoint>, preferLan: Boolean): List<BridgeEndpoint> =
        if (preferLan) Endpoints.preferLan(endpoints) else endpoints
}
