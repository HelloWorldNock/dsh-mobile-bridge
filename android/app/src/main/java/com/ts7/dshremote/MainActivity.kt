package com.ts7.dshremote

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.ui.Modifier
import androidx.core.content.ContextCompat
import com.ts7.dshremote.notify.Alerts
import com.ts7.dshremote.notify.BridgeService
import com.ts7.dshremote.ui.AppRoot
import com.ts7.dshremote.ui.theme.DshTheme

class MainActivity : ComponentActivity() {
    private val notificationPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT)
        )
        Alerts.createChannels(this)
        consumeDeepLink(intent)
        ContextCompat.startForegroundService(this, Intent(this, BridgeService::class.java))
        requestNotificationPermission()
        val repository = (application as DshApp).repository
        setContent {
            DshTheme {
                Box(Modifier.fillMaxSize().systemBarsPadding().imePadding()) {
                    AppRoot(repository)
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        consumeDeepLink(intent)
    }

    private fun consumeDeepLink(intent: Intent?) {
        if (intent == null) return
        val extra = intent.getStringExtra("session_id")
        val fromUri = if (intent.data?.scheme == "dshremote" && intent.data?.host == "session") {
            intent.data?.lastPathSegment
        } else {
            null
        }
        DeepLinks.open(extra ?: fromUri)
    }

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT < 33) return
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
        ) {
            return
        }
        notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
    }
}
