package com.ts7.dshremote.data

import android.content.Context
import android.os.Build
import gobridge.Gobridge
import gobridge.StatusCallback
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Embedded Tailscale node.
 *
 * This is NOT a VpnService: tsnet runs a userspace tailnet and exposes only a
 * loopback proxy, so just the DSH traffic of this app is routed. It can coexist
 * with the official Tailscale app or any other VPN.
 */
class EmbeddedTailscale(private val context: Context) {
    enum class Phase { Off, Starting, NeedsLogin, Connected, Error }

    data class UiState(
        val enabled: Boolean = false,
        val phase: Phase = Phase.Off,
        val authUrl: String? = null,
        val error: String? = null,
        val hostname: String = ""
    )

    private val prefs = context.getSharedPreferences("dsh_remote", Context.MODE_PRIVATE)
    private val _state = MutableStateFlow(
        UiState(enabled = prefs.getBoolean(KEY_ENABLED, false), hostname = hostname())
    )
    val state: StateFlow<UiState> = _state.asStateFlow()

    private val starting = AtomicBoolean(false)
    @Volatile private var generation: Int = 0
    @Volatile private var proxyHost: String? = null
    @Volatile private var proxyPort: Int = 0
    @Volatile private var localPort: Int = 0

    fun setEnabled(enabled: Boolean) {
        prefs.edit().putBoolean(KEY_ENABLED, enabled).apply()
        _state.value = _state.value.copy(enabled = enabled)
        if (enabled) start() else stop()
    }

    fun setAuthKey(key: String) {
        prefs.edit().putString(KEY_AUTH_KEY, key.trim()).apply()
        if (_state.value.enabled) {
            stop()
            start()
        }
    }

    fun authKey(): String = prefs.getString(KEY_AUTH_KEY, "").orEmpty()

    fun startIfEnabled() {
        if (_state.value.enabled) start()
    }

    @Synchronized
    fun start() {
        val current = _state.value
        if (!current.enabled) return
        if (current.phase == Phase.Starting || current.phase == Phase.Connected || current.phase == Phase.NeedsLogin) return
        if (!starting.compareAndSet(false, true)) return
        proxyHost = null
        proxyPort = 0
        localPort = 0
        val gen = ++generation
        _state.value = current.copy(phase = Phase.Starting, authUrl = null, error = null)
        val dir = File(context.filesDir, "tailscale").apply { mkdirs() }
        try {
            Gobridge.start(
                dir.absolutePath,
                hostname(),
                authKey(),
                object : StatusCallback {
                    override fun onAuthURL(url: String?) {
                        if (gen != generation || url.isNullOrBlank()) return
                        _state.value = _state.value.copy(phase = Phase.NeedsLogin, authUrl = url)
                    }

                    override fun onConnected() {
                        if (gen != generation) return
                        starting.set(false)
                        _state.value = _state.value.copy(phase = Phase.Connected, error = null, authUrl = null)
                    }

                    override fun onError(err: String?) {
                        if (gen != generation) return
                        starting.set(false)
                        _state.value = _state.value.copy(
                            phase = Phase.Error,
                            error = err?.takeIf { it.isNotBlank() } ?: "Tailscale 启动失败"
                        )
                    }
                }
            )
        } catch (error: Throwable) {
            if (gen == generation) {
                starting.set(false)
                _state.value = _state.value.copy(phase = Phase.Error, error = error.message ?: "Tailscale 启动失败")
            }
        }
    }

    @Synchronized
    fun stop() {
        generation += 1
        runCatching { Gobridge.stop() }
        starting.set(false)
        proxyHost = null
        proxyPort = 0
        localPort = 0
        _state.value = _state.value.copy(phase = Phase.Off, authUrl = null, error = null)
    }

    /**
     * Returns a loopback port that forwards to [host]:[port] over the tailnet.
     * Returns null while the node is not connected, so the caller can retry.
     */
    @Synchronized
    fun proxyFor(host: String, port: Int): Int? {
        if (_state.value.phase != Phase.Connected) return null
        if (host == proxyHost && port == proxyPort && localPort > 0) return localPort
        return try {
            val opened = Gobridge.startProxy(host, port.toLong()).toInt()
            if (opened <= 0) {
                _state.value = _state.value.copy(phase = Phase.Error, error = "Tailscale 本地代理启动失败")
                null
            } else {
                proxyHost = host
                proxyPort = port
                localPort = opened
                opened
            }
        } catch (error: Throwable) {
            _state.value = _state.value.copy(
                phase = Phase.Error,
                error = error.message ?: "Tailscale 本地代理启动失败"
            )
            null
        }
    }

    private fun hostname(): String {
        val model = (Build.MODEL ?: "android")
            .lowercase()
            .replace(Regex("[^a-z0-9-]"), "-")
            .trim('-')
            .take(32)
            .ifBlank { "android" }
        return "ts7-$model"
    }

    companion object {
        private const val KEY_ENABLED = "tailscale_enabled"
        private const val KEY_AUTH_KEY = "tailscale_auth_key"
    }
}
