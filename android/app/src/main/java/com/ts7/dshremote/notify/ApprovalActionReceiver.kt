package com.ts7.dshremote.notify

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.ts7.dshremote.data.HostStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

class ApprovalActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val id = intent.getStringExtra(Alerts.EXTRA_ID) ?: return
        val hostId = intent.getStringExtra(Alerts.EXTRA_HOST)
        val action = when (intent.action) {
            Alerts.ACTION_ALLOW -> "allow-once"
            Alerts.ACTION_REJECT -> "reject"
            else -> return
        }
        val pending = goAsync()
        val appContext = context.applicationContext
        CoroutineScope(Dispatchers.IO).launch {
            var resolvedHostId: String? = null
            try {
                val hosts = HostStore.load(appContext)
                val host = hosts.firstOrNull { it.id == hostId }
                    ?: hosts.firstOrNull { it.id == HostStore.activeId(appContext) }
                if (host != null && host.baseUrl.isNotBlank() && host.token.isNotBlank()) {
                    resolvedHostId = host.id
                    val client = OkHttpClient.Builder()
                        .connectTimeout(8, TimeUnit.SECONDS)
                        .readTimeout(8, TimeUnit.SECONDS)
                        .build()
                    val body = """{"action":"$action"}"""
                        .toRequestBody("application/json; charset=utf-8".toMediaType())
                    val request = Request.Builder()
                        .url("${host.baseUrl}/api/approvals/${URLEncoder.encode(id, "UTF-8")}")
                        .header("Authorization", "Bearer ${host.token}")
                        .post(body)
                        .build()
                    client.newCall(request).execute().use { response ->
                        // The phone UI reconciles from SSE; nothing else to do here.
                    }
                }
            } catch (_: Exception) {
                // Keep the notification; the user can retry from the app.
            } finally {
                resolvedHostId?.let { Alerts.cancelApproval(appContext, it, id) }
                pending.finish()
            }
        }
    }
}
