package com.ts7.dshremote.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** 选路：地址分类、局域网优先、合并去重、显式钉住传输方式。 */
class EndpointsTest {
    @Test
    fun `classifies tailnet addresses by their literal`() {
        assertEquals(Endpoints.TAILSCALE, Endpoints.kindOf("http://100.100.1.7:48123"))
        assertEquals(Endpoints.TAILSCALE, Endpoints.kindOf("100.64.0.1:48123"))
        assertEquals(Endpoints.LAN, Endpoints.kindOf("http://192.168.1.5:48123"))
        assertEquals(Endpoints.LAN, Endpoints.kindOf("http://10.0.2.2:48123"))
        // 主机名无法从字面判断，按局域网处理（旧主机也只报 kind，不报地址段）。
        assertEquals(Endpoints.LAN, Endpoints.kindOf("http://desk-pc:48123"))
    }

    @Test
    fun `preferLan puts every LAN address first and keeps the rest in order`() {
        val endpoints = listOf(
            BridgeEndpoint(kind = Endpoints.TAILSCALE, url = "http://100.100.1.7:48123"),
            BridgeEndpoint(kind = Endpoints.LAN, url = "http://192.168.1.5:48123"),
            BridgeEndpoint(kind = Endpoints.TAILSCALE, url = "http://100.100.1.8:48123"),
            BridgeEndpoint(kind = Endpoints.LAN, url = "http://10.0.2.2:48123")
        )

        val ordered = Endpoints.preferLan(endpoints)

        assertEquals(
            listOf("http://192.168.1.5:48123", "http://10.0.2.2:48123", "http://100.100.1.7:48123", "http://100.100.1.8:48123"),
            ordered.map { it.url }
        )
    }

    @Test
    fun `merge dedupes by url, reclassifies, and can keep the stored order`() {
        val stored = listOf(
            BridgeEndpoint(kind = Endpoints.LAN, url = "http://192.168.1.5:48123"),
            BridgeEndpoint(kind = Endpoints.TAILSCALE, url = "http://100.100.1.7:48123")
        )
        val incoming = listOf(
            BridgeEndpoint(kind = "lan", url = "http://100.100.1.7:48123/"),
            BridgeEndpoint(kind = "lan", url = "http://192.168.1.5:48123"),
            BridgeEndpoint(kind = "lan", url = "   ")
        )

        val unsorted = Endpoints.merge("http://192.168.1.5:48123", stored, incoming, sort = false)
        assertEquals(2, unsorted.size)
        assertEquals(Endpoints.TAILSCALE, unsorted[1].kind)
        assertEquals("http://100.100.1.7:48123", unsorted[1].url)

        val sorted = Endpoints.merge("http://192.168.1.5:48123", stored, incoming, sort = true)
        assertEquals(2, sorted.size)
        assertEquals(Endpoints.LAN, sorted.first().kind)
    }

    @Test
    fun `a stored tailnet-first order survives a re-merge`() {
        val stored = listOf(
            BridgeEndpoint(kind = Endpoints.TAILSCALE, url = "http://100.100.1.7:48123"),
            BridgeEndpoint(kind = Endpoints.LAN, url = "http://192.168.1.5:48123")
        )
        val merged = Endpoints.merge(null, stored, emptyList(), sort = false)
        assertEquals("http://100.100.1.7:48123", merged.first().url)
    }

    @Test
    fun `withKind pins a hostname to tailscale and can move it to the front`() {
        val endpoints = listOf(
            BridgeEndpoint(kind = Endpoints.LAN, url = "http://192.168.1.5:48123"),
            BridgeEndpoint(kind = Endpoints.LAN, url = "http://desk-pc:48123")
        )

        val pinned = Endpoints.withKind(endpoints, "http://desk-pc:48123", Endpoints.TAILSCALE, first = true)

        assertEquals("http://desk-pc:48123", pinned.first().url)
        assertEquals(Endpoints.TAILSCALE, pinned.first().kind)
        assertEquals(Endpoints.LAN, pinned[1].kind)
        // 未知地址不改变任何东西。
        assertEquals(pinned, Endpoints.withKind(pinned, "http://nope:1", Endpoints.LAN, first = true))
    }

    @Test
    fun `target splits host and port with the scheme default`() {
        assertEquals("192.168.1.5" to 48123, Endpoints.target("192.168.1.5:48123"))
        assertEquals("100.100.1.7" to 48123, Endpoints.target("http://100.100.1.7:48123/"))
        assertEquals("pc" to 80, Endpoints.target("http://pc"))
        assertNull(Endpoints.target(""))
    }

    @Test
    fun `candidates follow the stored order`() {
        val host = PairedHost(
            id = "DEV@48123",
            baseUrl = "http://100.100.1.7:48123",
            token = "t",
            endpoints = listOf(
                BridgeEndpoint(kind = Endpoints.TAILSCALE, url = "http://100.100.1.7:48123"),
                BridgeEndpoint(kind = Endpoints.LAN, url = "http://192.168.1.5:48123")
            )
        )
        val candidates = host.candidates
        assertEquals(2, candidates.size)
        assertEquals("http://100.100.1.7:48123", candidates.first().url)
        assertFalse(candidates.isEmpty())
    }
}
