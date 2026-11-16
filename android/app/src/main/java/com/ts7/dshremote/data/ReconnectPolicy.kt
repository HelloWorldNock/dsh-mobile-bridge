package com.ts7.dshremote.data

/**
 * 重连节奏。
 *
 * 两套退避是分开的，混在一起会出问题：
 *  - 建连失败（连不上、握手失败）：2s 起、每次 +2s、封顶 15s；401 直接放弃，不重试。
 *  - 事件流断开（SSE 掉了）：前两次只等 1s 原地重试同一条地址，避免一抖就整屏变
 *    「连接中」；从第三次起按 2/4/8/16/30s 退避并重新探路（Wi-Fi ↔ tailnet 可能换了）。
 */
object ReconnectPolicy {
    const val CONNECT_STEP_MS = 2_000L
    const val CONNECT_CAP_MS = 15_000L
    const val STREAM_GRACE_RETRY_MS = 1_000L
    const val STREAM_BACKOFF_STEP_MS = 2_000L
    const val STREAM_BACKOFF_CAP_MS = 30_000L
    /** 事件流连续失败到这个次数为止都原地重试同一地址。 */
    const val STREAM_GRACE_ATTEMPTS = 2

    /** 第 n 次建连失败后等多久（n 从 1 开始）。 */
    fun connectBackoffMs(attempt: Int): Long {
        val safe = if (attempt < 1) 1 else attempt
        return minOf(CONNECT_CAP_MS, CONNECT_STEP_MS * safe)
    }

    /** 事件流连续失败这么多次时，还值不值得原地重试。 */
    fun retriesInPlace(failures: Int): Boolean = failures <= STREAM_GRACE_ATTEMPTS

    /**
     * 连续失败 [failures] 次之后，重连前要等多久。
     * 前两次是 1s 原地重试，第三次起 2/4/8/16/30s。
     */
    fun streamRetryDelayMs(failures: Int): Long {
        if (retriesInPlace(failures)) return STREAM_GRACE_RETRY_MS
        val exponent = minOf(failures - STREAM_GRACE_ATTEMPTS - 1, 4).coerceAtLeast(0)
        return minOf(STREAM_BACKOFF_CAP_MS, STREAM_BACKOFF_STEP_MS * (1L shl exponent))
    }
}
