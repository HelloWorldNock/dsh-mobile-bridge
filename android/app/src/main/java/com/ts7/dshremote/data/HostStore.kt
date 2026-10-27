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

object HostStore {
    const val PREFS = "dsh_remote"
    private const val KEY_HOSTS = "hosts"
    private const val KEY_ACTIVE = "activeHostId"

    fun load(context: Context): List<PairedHost> {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val raw = prefs.getString(KEY_HOSTS, null)
        if (raw != null) {
            return runCatching {
                JsonConfig.json.decodeFromString<List<PairedHost>>(raw)
            }.getOrDefault(emptyList())
        }

        // Migrate the single-host layout written by 0.1.x.
        val baseUrl = normalizeBaseUrl(prefs.getString("baseUrl", "").orEmpty())
        val token = prefs.getString("token", "").orEmpty()
        if (baseUrl.isBlank() || token.isBlank()) return emptyList()
        val deviceId = prefs.getString("deviceId", null)
        val migrated = PairedHost(
            id = hostId(deviceId, baseUrl),
            baseUrl = baseUrl,
            token = token,
            deviceId = deviceId,
            addedAt = System.currentTimeMillis(),
            endpoints = listOf(BridgeEndpoint(kind = Endpoints.kindOf(baseUrl), url = baseUrl))
        )
        save(context, listOf(migrated))
        prefs.edit().putString(KEY_ACTIVE, migrated.id).apply()
        return listOf(migrated)
    }

    fun save(context: Context, hosts: List<PairedHost>) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(KEY_HOSTS, JsonConfig.json.encodeToString(hosts))
            .apply()
    }

    fun activeId(context: Context): String? =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_ACTIVE, null)

    fun setActive(context: Context, id: String?) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(KEY_ACTIVE, id)
            .apply()
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
