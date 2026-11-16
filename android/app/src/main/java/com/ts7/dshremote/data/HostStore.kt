package com.ts7.dshremote.data

import android.content.Context
import java.net.URI
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString

/** One paired desktop, persisted independently so several hosts can share this phone. */
@Serializable
data class PairedHost(
    val id: String,
    val baseUrl: String,
    val token: String,
    val deviceId: String? = null,
    val hostName: String? = null,
    val addedAt: Long = 0L,
    val lastConnectedAt: Long? = null,
    val endpoints: List<BridgeEndpoint> = emptyList()
) {
    val label: String get() = hostName?.takeIf { it.isNotBlank() } ?: baseUrl
    val candidates: List<BridgeEndpoint> get() = Endpoints.candidates(this)
}

/**
 * 配对记录。逻辑全部落在 [KeyValueStore] 上，Context 版本只是便捷包装，
 * 这样 `HostStoreTest` 能在纯 JVM 里覆盖读写、老版本迁移与 id 规则。
 */
object HostStore {
    const val PREFS = "dsh_remote"
    internal const val KEY_HOSTS = "hosts"
    internal const val KEY_ACTIVE = "activeHostId"

    /** 0.1.x 的单主机布局，只在 [load] 里读一次并迁移。 */
    internal const val KEY_LEGACY_BASE_URL = "baseUrl"
    internal const val KEY_LEGACY_TOKEN = "token"
    internal const val KEY_LEGACY_DEVICE_ID = "deviceId"

    fun load(context: Context): List<PairedHost> = load(KeyValueStore.of(context))

    /** @param now 迁移时写 `addedAt`；单测传入固定值。 */
    fun load(store: KeyValueStore, now: () -> Long = { System.currentTimeMillis() }): List<PairedHost> {
        val raw = store.getString(KEY_HOSTS)
        if (raw != null) {
            return runCatching { JsonConfig.json.decodeFromString<List<PairedHost>>(raw) }.getOrDefault(emptyList())
        }

        // Migrate the single-host layout written by 0.1.x.
        val baseUrl = normalizeBaseUrl(store.getString(KEY_LEGACY_BASE_URL).orEmpty())
        val token = store.getString(KEY_LEGACY_TOKEN).orEmpty()
        if (baseUrl.isBlank() || token.isBlank()) return emptyList()
        val deviceId = store.getString(KEY_LEGACY_DEVICE_ID)
        val migrated = PairedHost(
            id = hostId(deviceId, baseUrl),
            baseUrl = baseUrl,
            token = token,
            deviceId = deviceId,
            addedAt = now(),
            endpoints = listOf(BridgeEndpoint(kind = Endpoints.kindOf(baseUrl), url = baseUrl))
        )
        save(store, listOf(migrated))
        setActive(store, migrated.id)
        return listOf(migrated)
    }

    fun save(context: Context, hosts: List<PairedHost>) = save(KeyValueStore.of(context), hosts)

    fun save(store: KeyValueStore, hosts: List<PairedHost>) {
        store.putString(KEY_HOSTS, JsonConfig.json.encodeToString(hosts))
    }

    fun activeId(context: Context): String? = activeId(KeyValueStore.of(context))

    fun activeId(store: KeyValueStore): String? = store.getString(KEY_ACTIVE)

    fun setActive(context: Context, id: String?) = setActive(KeyValueStore.of(context), id)

    fun setActive(store: KeyValueStore, id: String?) {
        store.putString(KEY_ACTIVE, id)
    }

    /**
     * A DSH install is identified by its bridge device id. Including the port lets
     * two DSH instances that share one state file (same device id, different ports)
     * stay separate hosts on the phone.
     */
    fun hostId(deviceId: String?, baseUrl: String): String {
        val dev = deviceId?.takeIf { it.isNotBlank() } ?: return normalizeBaseUrl(baseUrl)
        val port = portOf(baseUrl)
        return if (port > 0) "$dev@$port" else dev
    }

    fun portOf(baseUrl: String): Int = runCatching {
        val uri = URI(normalizeBaseUrl(baseUrl))
        when {
            uri.port > 0 -> uri.port
            uri.scheme.equals("https", ignoreCase = true) -> 443
            uri.scheme.equals("http", ignoreCase = true) -> 80
            else -> -1
        }
    }.getOrDefault(-1)
}
