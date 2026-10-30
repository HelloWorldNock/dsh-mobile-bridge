package com.ts7.dshremote.notify

import android.content.Context
import android.net.wifi.WifiManager
import android.os.Build
import android.os.PowerManager
import com.ts7.dshremote.data.HostStore

/**
 * Keeps the SSE stream alive while the screen is off.
 *
 * A partial wake lock stops the CPU from suspending; the Wi-Fi lock stops the
 * Wi-Fi radio from dropping into power save between heartbeats. Both are held only
 * while the screen is off — with the screen on the device is already awake — and
 * only when the user left the feature enabled. Doze still ignores wake locks for
 * apps that are not battery-optimisation exempt, which is why the settings screen
 * also offers that exemption (see [Reliability]).
 */
class KeepAlive(context: Context) {
    private val appContext = context.applicationContext
    private val power = appContext.getSystemService(PowerManager::class.java)
    private val wifi = appContext.getSystemService(WifiManager::class.java)

    private var wakeLock: PowerManager.WakeLock? = null
    private var wifiLock: WifiManager.WifiLock? = null
    private var enabled: Boolean = KeepAlive.enabled(appContext)

    fun setEnabled(value: Boolean) {
        enabled = value
        KeepAlive.setEnabled(appContext, value)
        if (!value) release()
    }

    fun acquire() {
        enabled = KeepAlive.enabled(appContext)
        if (!enabled) {
            release()
            return
        }
        runCatching {
            val manager = power ?: return
            val lock = wakeLock ?: manager.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                "dshremote:connection"
            ).apply {
                setReferenceCounted(false)
                wakeLock = this
            }
            if (!lock.isHeld) lock.acquire()
        }
        runCatching {
            val manager = wifi ?: return
            val mode = if (Build.VERSION.SDK_INT >= 29) {
                WifiManager.WIFI_MODE_FULL_LOW_LATENCY
            } else {
                @Suppress("DEPRECATION")
                WifiManager.WIFI_MODE_FULL_HIGH_PERF
            }
            val lock = wifiLock ?: manager.createWifiLock(mode, "dshremote:wifi").apply {
                setReferenceCounted(false)
                wifiLock = this
            }
            if (!lock.isHeld) lock.acquire()
        }
    }

    fun release() {
        runCatching { if (wakeLock?.isHeld == true) wakeLock?.release() }
        runCatching { if (wifiLock?.isHeld == true) wifiLock?.release() }
    }

    companion object {
        private const val KEY_SCREEN_OFF_KEEPALIVE = "keepAliveOnScreenOff"

        fun enabled(context: Context): Boolean =
            prefs(context).getBoolean(KEY_SCREEN_OFF_KEEPALIVE, true)

        fun setEnabled(context: Context, value: Boolean) {
            prefs(context).edit().putBoolean(KEY_SCREEN_OFF_KEEPALIVE, value).apply()
        }

        private fun prefs(context: Context) =
            context.applicationContext.getSharedPreferences(HostStore.PREFS, Context.MODE_PRIVATE)
    }
}
