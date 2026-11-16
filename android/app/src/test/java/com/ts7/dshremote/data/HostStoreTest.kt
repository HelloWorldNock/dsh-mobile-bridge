package com.ts7.dshremote.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 配对记录：读写、老版本迁移、id 规则。全部跑在内存 store 上，不依赖 Android 运行时。
 */
class HostStoreTest {
    private fun host(id: String = "HOSTA@48123", url: String = "http://192.168.1.5:48123") = PairedHost(
        id = id,
        baseUrl = url,
        token = "dshm_token_$id",
        deviceId = "HOSTA",
        hostName = "书桌 PC",
        addedAt = 1_700_000_000_000L,
        endpoints = listOf(BridgeEndpoint(kind = Endpoints.LAN, url = url))
    )

    @Test
    fun `saves and loads hosts in order`() {
        val store = InMemoryKeyValueStore()
        val first = host("HOSTA@48123")
        val second = host("HOSTB@48123", "http://100.100.1.7:48123")

        HostStore.save(store, listOf(first, second))
        val loaded = HostStore.load(store)

        assertEquals(listOf(first, second), loaded)
    }

    @Test
    fun `empty store loads nothing`() {
        assertTrue(HostStore.load(InMemoryKeyValueStore()).isEmpty())
    }

    @Test
    fun `corrupt json falls back to an empty list instead of crashing`() {
        val store = InMemoryKeyValueStore(mapOf(HostStore.KEY_HOSTS to "{not json"))
        assertTrue(HostStore.load(store).isEmpty())
    }

    @Test
    fun `active host id round trips and can be cleared`() {
        val store = InMemoryKeyValueStore()
        assertNull(HostStore.activeId(store))

        HostStore.setActive(store, "HOSTA@48123")
        assertEquals("HOSTA@48123", HostStore.activeId(store))

        HostStore.setActive(store, null)
        assertNull(HostStore.activeId(store))
    }

    @Test
    fun `migrates the single host layout from 0_1_x`() {
        val store = InMemoryKeyValueStore(
            mapOf(
                HostStore.KEY_LEGACY_BASE_URL to "192.168.1.9:48123/",
                HostStore.KEY_LEGACY_TOKEN to "dshm_legacy",
                HostStore.KEY_LEGACY_DEVICE_ID to "LEGACY"
            )
        )

        val migrated = HostStore.load(store) { 42L }

        assertEquals(1, migrated.size)
        val host = migrated.first()
        assertEquals("http://192.168.1.9:48123", host.baseUrl)
        assertEquals("dshm_legacy", host.token)
        assertEquals("LEGACY@48123", host.id)
        assertEquals(42L, host.addedAt)
        assertEquals(Endpoints.LAN, host.endpoints.single().kind)
        // 迁移结果要落盘，并且设为当前主机，否则下次启动又要迁一次。
        assertEquals(listOf(host), HostStore.load(store) { 99L })
        assertEquals("LEGACY@48123", HostStore.activeId(store))
    }

    @Test
    fun `legacy layout without token is ignored and writes nothing`() {
        val store = InMemoryKeyValueStore(mapOf(HostStore.KEY_LEGACY_BASE_URL to "192.168.1.9:48123"))
        assertTrue(HostStore.load(store).isEmpty())
        assertNull(store.snapshot()[HostStore.KEY_HOSTS])
    }

    @Test
    fun `host id keeps the port so two instances stay separate`() {
        assertEquals("DEV1@48123", HostStore.hostId("DEV1", "http://192.168.1.5:48123"))
        assertEquals("DEV1@48124", HostStore.hostId("DEV1", "http://192.168.1.5:48124"))
        assertEquals("DEV1@443", HostStore.hostId("DEV1", "https://pc.example.com"))
        // 没有 device id 时退回地址本身。
        assertEquals("http://192.168.1.5:48123", HostStore.hostId(null, "http://192.168.1.5:48123/"))
        assertEquals("http://192.168.1.5:48123", HostStore.hostId("   ", "http://192.168.1.5:48123"))
    }

    @Test
    fun `port falls back to the scheme default`() {
        assertEquals(48123, HostStore.portOf("http://192.168.1.5:48123"))
        assertEquals(80, HostStore.portOf("http://192.168.1.5"))
        assertEquals(443, HostStore.portOf("https://pc.example.com"))
        assertEquals(-1, HostStore.portOf(""))
    }
}
