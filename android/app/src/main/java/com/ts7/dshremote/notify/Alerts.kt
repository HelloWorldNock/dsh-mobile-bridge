package com.ts7.dshremote.notify

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.ts7.dshremote.MainActivity
import com.ts7.dshremote.R
import com.ts7.dshremote.data.PendingApproval
import com.ts7.dshremote.data.PendingQuestion
import com.ts7.dshremote.ui.theme.Amber

object Alerts {
    const val CHANNEL_CONNECTION = "dsh_connection"
    const val CHANNEL_ALERTS = "dsh_alerts"
    const val FOREGROUND_ID = 1001
    const val EXTRA_ID = "pending_id"
    const val ACTION_ALLOW = "com.ts7.dshremote.APPROVE"
    const val ACTION_REJECT = "com.ts7.dshremote.REJECT"

    fun createChannels(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        val connection = NotificationChannel(
            CHANNEL_CONNECTION,
            context.getString(R.string.channel_connection),
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = context.getString(R.string.channel_connection_desc)
            setShowBadge(false)
        }
        val alerts = NotificationChannel(
            CHANNEL_ALERTS,
            context.getString(R.string.channel_alerts),
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = context.getString(R.string.channel_alerts_desc)
            enableVibration(true)
        }
        manager.createNotificationChannels(listOf(connection, alerts))
    }

    fun foreground(context: Context, detail: String): Notification {
        val open = PendingIntent.getActivity(
            context, 10, Intent(context, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        return NotificationCompat.Builder(context, CHANNEL_CONNECTION)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(context.getString(R.string.app_name))
            .setContentText(detail)
            .setContentIntent(open)
            .setOngoing(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    fun approval(context: Context, approval: PendingApproval) {
        val title = approval.sessionTitle?.takeIf { it.isNotBlank() } ?: "DSH 任务"
        val body = approval.preview?.preview?.takeIf { it.isNotBlank() }
            ?: approval.reason?.takeIf { it.isNotBlank() }
            ?: approval.displayReason?.takeIf { it.isNotBlank() }
            ?: "请求执行 ${approval.toolName}"
        val allow = action(context, approval.id, ACTION_ALLOW, 1)
        val reject = action(context, approval.id, ACTION_REJECT, 2)
        val notification = NotificationCompat.Builder(context, CHANNEL_ALERTS)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("审批：${approval.toolName}")
            .setContentText(body)
            .setSubText(title)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(openIntent(context, approval.sessionId, approval.id, 3))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setAutoCancel(true)
            .addAction(0, context.getString(R.string.reject), reject)
            .addAction(0, context.getString(R.string.allow_once), allow)
            .build()
        notify(context, approvalNotificationId(approval.id), notification)
    }

    fun question(context: Context, question: PendingQuestion) {
        val title = question.sessionTitle?.takeIf { it.isNotBlank() } ?: "DSH 任务"
        val body = if (question.planReview) {
            "计划待审阅，点按查看并批准"
        } else {
            question.questions.firstOrNull()?.question ?: "DSH 需要你的选择"
        }
        val notification = NotificationCompat.Builder(context, CHANNEL_ALERTS)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(if (question.planReview) "计划待审阅" else "需要你的选择")
            .setContentText(body)
            .setSubText(title)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(openIntent(context, question.sessionId, question.id, 4))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .build()
        notify(context, questionNotificationId(question.id), notification)
    }

    fun turnEnd(context: Context, sessionId: String, title: String, text: String) {
        val body = text.replace(Regex("\\s+"), " ").trim().take(160).ifBlank { "任务已完成" }
        val notification = NotificationCompat.Builder(context, CHANNEL_ALERTS)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("任务完成 · ${title.ifBlank { "DSH" }}")
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(openIntent(context, sessionId, null, 5))
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .build()
        notify(context, ("turn:" + sessionId).hashCode() and 0x7fffffff, notification)
    }

    fun connectionLost(context: Context) {
        val notification = NotificationCompat.Builder(context, CHANNEL_CONNECTION)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("与电脑的连接已断开")
            .setContentText("点按返回应用重试")
            .setContentIntent(openIntent(context, null, null, 6))
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setAutoCancel(true)
            .build()
        notify(context, 20, notification)
    }

    fun cancelApproval(context: Context, id: String) = cancel(context, approvalNotificationId(id))
    fun cancelQuestion(context: Context, id: String) = cancel(context, questionNotificationId(id))

    fun approvalNotificationId(id: String): Int = ("approval:" + id).hashCode() and 0x7fffffff
    fun questionNotificationId(id: String): Int = ("question:" + id).hashCode() and 0x7fffffff

    private fun action(context: Context, id: String, action: String, slot: Int): PendingIntent {
        val intent = Intent(context, ApprovalActionReceiver::class.java).apply {
            this.action = action
            putExtra(EXTRA_ID, id)
        }
        val code = (("$id:$slot").hashCode() and 0x7fffffff)
        return PendingIntent.getBroadcast(
            context, code, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    private fun openIntent(context: Context, sessionId: String?, id: String?, slot: Int): PendingIntent {
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            if (sessionId != null) putExtra("session_id", sessionId)
            if (id != null) putExtra("pending_id", id)
        }
        val code = (("open:" + (sessionId ?: "") + ":" + (id ?: "") + ":" + slot).hashCode() and 0x7fffffff)
        return PendingIntent.getActivity(
            context, code, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    private fun notify(context: Context, id: Int, notification: Notification) {
        if (ContextCompat.checkSelfPermission(context, android.Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            return
        }
        try {
            NotificationManagerCompat.from(context).notify(id, notification)
        } catch (_: SecurityException) {
            // permission revoked between check and notify
        }
    }

    private fun cancel(context: Context, id: Int) {
        try {
            NotificationManagerCompat.from(context).cancel(id)
        } catch (_: SecurityException) {
            // ignore
        }
    }
}
