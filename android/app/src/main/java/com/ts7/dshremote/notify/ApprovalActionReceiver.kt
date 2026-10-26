package com.ts7.dshremote.notify

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

class ApprovalActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val id = intent.getStringExtra(Alerts.EXTRA_ID) ?: return
        val action = when (intent.action) {
            Alerts.ACTION_ALLOW -> "allow-once"
            Alerts.ACTION_REJECT -> "reject"
            else -> return
        }
        val pending = goAsync()
        val appContext = context.applicationContext
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val prefs = appContext.getSharedPreferences("dsh_remote", Context.MODE_PRIVATE)
                val baseUrl = prefs.getString("baseUrl", "").orEmpty().trimEnd('/')
                val token = prefs.getString("token", "").orEmpty()
                if (baseUrl.isNotBlank() && token.isNotBlank()) {
                    val client = OkHttpClient.Builder()
                        .connectTimeout(8, TimeUnit.SECONDS)
                        .readTimeout(8, TimeUnit.SECONDS)
                        .build()
                    val body = """{"action":"$action"}"""
                        .toRequestBody("application/json; charset=utf-8".toMediaType())
                    val request = Request.Builder()
                        .url("$baseUrl/api/approvals/$id")
                        .header("Authorization", "Bearer $token")
                        .post(body)
                        .build()
                    client.newCall(request).execute().use { response ->
                        // The phone UI will reconcile from SSE; nothing else to do here.
                    }
                }
            } catch (_: Exception) {
                // Keep the notification; the user can retry from the app.
            } finally {
                Alerts.cancelApproval(appContext, id)
                pending.finish()
            }
        }
    }
}
