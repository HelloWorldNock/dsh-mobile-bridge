package com.ts7.dshremote.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** 重连节奏：建连退避与事件流退避是两套曲线，改一处不该动另一处。 */
class ReconnectPolicyTest {
    @Test
    fun `connect backoff steps by two seconds and caps at fifteen`() {
        assertEquals(2_000L, ReconnectPolicy.connectBackoffMs(1))
        assertEquals(4_000L, ReconnectPolicy.connectBackoffMs(2))
        assertEquals(6_000L, ReconnectPolicy.connectBackoffMs(3))
        assertEquals(12_000L, ReconnectPolicy.connectBackoffMs(6))
        assertEquals(14_000L, ReconnectPolicy.connectBackoffMs(7))
        assertEquals(15_000L, ReconnectPolicy.connectBackoffMs(8))
        assertEquals(15_000L, ReconnectPolicy.connectBackoffMs(100))
        // 0/负数按第一次失败处理，避免 busy loop。
        assertEquals(2_000L, ReconnectPolicy.connectBackoffMs(0))
        assertEquals(2_000L, ReconnectPolicy.connectBackoffMs(-3))
    }

    @Test
    fun `the first two stream failures retry in place`() {
        assertTrue(ReconnectPolicy.retriesInPlace(1))
        assertTrue(ReconnectPolicy.retriesInPlace(2))
        assertFalse(ReconnectPolicy.retriesInPlace(3))
        assertEquals(1_000L, ReconnectPolicy.streamRetryDelayMs(1))
        assertEquals(1_000L, ReconnectPolicy.streamRetryDelayMs(2))
    }

    @Test
    fun `stream backoff doubles from the third failure and caps at thirty seconds`() {
        assertEquals(2_000L, ReconnectPolicy.streamRetryDelayMs(3))
        assertEquals(4_000L, ReconnectPolicy.streamRetryDelayMs(4))
        assertEquals(8_000L, ReconnectPolicy.streamRetryDelayMs(5))
        assertEquals(16_000L, ReconnectPolicy.streamRetryDelayMs(6))
        assertEquals(30_000L, ReconnectPolicy.streamRetryDelayMs(7))
        assertEquals(30_000L, ReconnectPolicy.streamRetryDelayMs(50))
    }
}
