package com.ts7.dshremote.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlinx.serialization.encodeToString

/**
 * 明文 → 加密存储的迁移。`migrate` 是纯函数（两个 KeyValueStore），所以能在 JVM 上测；
 * Keystore 本身要真机才能验证，见 docs/STAGE2-2026-11-17.md。
 */
class SecureStorageTest {
    private fun host(id: String = "HOSTA@48123") = PairedHost(
        id = id,
        baseUrl = "http://192.168.1.5:48123",
        token = "dshm_secret",
        deviceId = "HOSTA",
        endpoints = listOf(BridgeEndpoint(kind = Endpoints.LAN, url = "http://192.168.1.5:48123"))
    )

    @Test
    fun `moves legacy plaintext keys into the secure store and clears them`() {
        val plain = InMemoryKeyValueStore(
            mapOf(
                HostStore.KEY_HOSTS to JsonConfig.json.encodeToString(listOf(host())),
                HostStore.KEY_ACTIVE to "HOSTA@48123",
                HostStore.KEY_LEGACY_TOKEN to "dshm_old"
            )
        )
        val secure = InMemoryKeyValueStore()

        val moved = SecureStorage.migrate(plain, secure)

        assertEquals(3, moved)
        assertEquals("HOSTA@48123", secure.getString(HostStore.KEY_ACTIVE))
        assertEquals("dshm_old", secure.getString(HostStore.KEY_LEGACY_TOKEN))
        assertEquals(1, HostStore.load(secure).size)
        // 明文侧必须一个都不剩，否则等于没加密。
        assertNull(plain.getString(HostStore.KEY_HOSTS))
        assertNull(plain.getString(HostStore.KEY_ACTIVE))
        assertNull(plain.getString(HostStore.KEY_LEGACY_TOKEN))
    }

    @Test
    fun `is idempotent and never overwrites the secure copy`() {
        val secure = InMemoryKeyValueStore(mapOf(HostStore.KEY_ACTIVE to "NEW"))
        val plain = InMemoryKeyValueStore(mapOf(HostStore.KEY_ACTIVE to "OLD"))

        val moved = SecureStorage.migrate(plain, secure)

        assertEquals(0, moved)
        assertEquals("NEW", secure.getString(HostStore.KEY_ACTIVE))
        assertNull(plain.getString(HostStore.KEY_ACTIVE))
    }

    @Test
    fun `nothing to migrate is a no-op`() {
        val plain = InMemoryKeyValueStore()
        val secure = InMemoryKeyValueStore()
        assertEquals(0, SecureStorage.migrate(plain, secure))
        assertTrue(secure.snapshot().isEmpty())
    }
}
