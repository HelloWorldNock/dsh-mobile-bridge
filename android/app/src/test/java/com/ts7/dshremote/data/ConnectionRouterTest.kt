package com.ts7.dshremote.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** 选路决策（R19 第一刀）：切不切、探多久、是不是同一台主机。 */
class ConnectionRouterTest {
    private fun endpoint(kind: String, url: String) = BridgeEndpoint(kind = kind, url = url)

    @Test
    fun `probe timeouts differ between lan and tailnet`() {
        assertEquals(1_800L, ConnectionRouter.probeTimeoutMs(Endpoints.LAN))
        assertEquals(3_500L, ConnectionRouter.probeTimeoutMs(Endpoints.TAILSCALE))
        // 未知/空类型按局域网处理，快一点没坏处。
        assertEquals(1_800L, ConnectionRouter.probeTimeoutMs(null))
        assertEquals(1_800L, ConnectionRouter.probeTimeoutMs("whatever"))
    }

    @Test
    fun `switches only when the route actually changes or the link is down`() {
        val lan = endpoint(Endpoints.LAN, "http://192.168.1.5:48123")
        assertFalse(ConnectionRouter.shouldSwitch("http://192.168.1.5:48123", lan, connected = true))
        // 尾部斜杠不影响判定，避免同一条地址被反复重连。
        assertFalse(ConnectionRouter.shouldSwitch("http://192.168.1.5:48123/", lan, connected = true))

        val tailnet = endpoint(Endpoints.TAILSCALE, "http://100.100.1.7:48123")
        assertTrue(ConnectionRouter.shouldSwitch("http://192.168.1.5:48123", tailnet, connected = true))
        // 没探到可用地址 -> 维持现状。
        assertFalse(ConnectionRouter.shouldSwitch("http://192.168.1.5:48123", null, connected = true))
        // 当前没连上，探到哪条都值得切。
        assertTrue(ConnectionRouter.shouldSwitch("http://192.168.1.5:48123", lan, connected = false))
    }

    @Test
    fun `only a different lan address is worth promoting`() {
        val lan = endpoint(Endpoints.LAN, "http://192.168.1.5:48123")
        val otherLan = endpoint(Endpoints.LAN, "http://10.0.2.2:48123")
        val tailnet = endpoint(Endpoints.TAILSCALE, "http://100.100.1.7:48123")

        assertTrue(ConnectionRouter.shouldPromoteLan(otherLan, "http://192.168.1.5:48123"))
        assertFalse(ConnectionRouter.shouldPromoteLan(lan, "http://192.168.1.5:48123"))
        // tailnet 不参与 promote（promote 的语义是「把局域网提到最前」）。
        assertFalse(ConnectionRouter.shouldPromoteLan(tailnet, "http://192.168.1.5:48123"))
        assertFalse(ConnectionRouter.shouldPromoteLan(null, "http://192.168.1.5:48123"))
    }

    @Test
    fun `device ids must match when both sides report one`() {
        assertTrue(ConnectionRouter.deviceMatches("DEV1", "DEV1"))
        assertFalse(ConnectionRouter.deviceMatches("DEV1", "DEV2"))
        // 任一侧没报（老桥接）就不拦。
        assertTrue(ConnectionRouter.deviceMatches(null, "DEV2"))
        assertTrue(ConnectionRouter.deviceMatches("DEV1", null))
        assertTrue(ConnectionRouter.deviceMatches("A", "A"))
    }

    @Test
    fun `probe order follows the stored list unless lan is preferred`() {
        val stored = listOf(
            endpoint(Endpoints.TAILSCALE, "http://100.100.1.7:48123"),
            endpoint(Endpoints.LAN, "http://192.168.1.5:48123")
        )
        assertEquals(stored, ConnectionRouter.probeOrder(stored, preferLan = false))
        assertEquals(
            listOf("http://192.168.1.5:48123", "http://100.100.1.7:48123"),
            ConnectionRouter.probeOrder(stored, preferLan = true).map { it.url }
        )
    }
}
