package com.ts7.dshremote.notify

/**
 * Whether any activity of this process is visible. The foreground service uses it
 * to skip notifications the user is already looking at. Tracking the lifecycle
 * directly is more reliable than ActivityManager importance, which returns null on
 * some OEM builds and counts a stopped-but-alive process as foreground.
 */
object AppVisibility {
    @Volatile
    var visible: Boolean = false
        private set

    private var started = 0

    @Synchronized
    fun onStart() {
        started += 1
        visible = started > 0
    }

    @Synchronized
    fun onStop() {
        started = (started - 1).coerceAtLeast(0)
        visible = started > 0
    }
}
