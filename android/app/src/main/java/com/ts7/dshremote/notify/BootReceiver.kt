package com.ts7.dshremote.notify

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.content.ContextCompat
import com.ts7.dshremote.data.HostStore

/**
 * Restores the maintainer connection after a reboot or an app update without the
 * user opening the UI. Silent no-op for users who never paired a host.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        if (action != Intent.ACTION_BOOT_COMPLETED &&
            action != Intent.ACTION_MY_PACKAGE_REPLACED
        ) {
            return
        }
        if (HostStore.load(context).isEmpty()) return
        runCatching {
            val service = Intent(context, BridgeService::class.java)
            if (Build.VERSION.SDK_INT >= 26) {
                ContextCompat.startForegroundService(context, service)
            } else {
                context.startService(service)
            }
        }
    }
}
