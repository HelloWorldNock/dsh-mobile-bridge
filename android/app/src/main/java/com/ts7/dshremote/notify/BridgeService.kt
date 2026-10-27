package com.ts7.dshremote.notify

import android.app.ActivityManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import com.ts7.dshremote.DshApp
import com.ts7.dshremote.data.ConnectionState
import com.ts7.dshremote.data.HostSnapshot
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

class BridgeService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var collecting = false
    private val seenApprovals = mutableSetOf<Pair<String, String>>()
    private val seenQuestions = mutableSetOf<Pair<String, String>>()
    private var previousRunning: Map<String, Set<String>> = emptyMap()
    private var previousConnections: Map<String, ConnectionState> = emptyMap()
    private var foregroundText: String? = null

    override fun onCreate() {
        super.onCreate()
        Alerts.createChannels(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForeground(Alerts.FOREGROUND_ID, Alerts.foreground(this, "正在保持局域网连接"))
        if (!collecting) {
            collecting = true
            val repository = (application as DshApp).repository
            scope.launch {
                repository.hosts.collect { hosts -> onHosts(hosts) }
            }
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        collecting = false
        scope.cancel()
        (application as DshApp).tailscale.stop()
        super.onDestroy()
    }

    private fun onHosts(hosts: List<HostSnapshot>) {
        val online = hosts.count { it.connection == ConnectionState.Connected }
        val running = hosts.sumOf { host -> host.sessions.count { it.running } }
        val detail = when {
            online > 0 && running > 0 -> "已连接 $online/${hosts.size} 台电脑 · $running 个任务运行中"
            online > 0 -> "已连接 $online/${hosts.size} 台电脑"
            hosts.isNotEmpty() -> "连接已断开，点按重试"
            else -> "尚未配对电脑"
        }
        if (detail != foregroundText) {
            foregroundText = detail
            startForeground(Alerts.FOREGROUND_ID, Alerts.foreground(this, detail))
        }

        for (host in hosts) {
            val previous = previousConnections[host.id]
            if (previous == ConnectionState.Connected && host.connection != ConnectionState.Connected) {
                Alerts.connectionLost(this, host.label)
            } else if (previous != ConnectionState.Connected && host.connection == ConnectionState.Connected) {
                Alerts.cancelConnectionLost(this, host.label)
            }
        }
        previousConnections = hosts.associate { it.id to it.connection }

        val approvals = hosts.flatMap { host -> host.pending.approvals.map { host to it } }
        for ((host, approval) in approvals) {
            if (seenApprovals.add(host.id to approval.id)) Alerts.approval(this, host.id, host.label, approval)
        }
        val approvalKeys = approvals.map { it.first.id to it.second.id }.toSet()
        for (old in seenApprovals - approvalKeys) {
            Alerts.cancelApproval(this, old.first, old.second)
        }
        seenApprovals.retainAll(approvalKeys)

        val questions = hosts.flatMap { host -> host.pending.questions.map { host to it } }
        for ((host, question) in questions) {
            if (seenQuestions.add(host.id to question.id)) Alerts.question(this, host.id, host.label, question)
        }
        val questionKeys = questions.map { it.first.id to it.second.id }.toSet()
        for (old in seenQuestions - questionKeys) {
            Alerts.cancelQuestion(this, old.first, old.second)
        }
        seenQuestions.retainAll(questionKeys)

        val runningByHost = hosts.associate { host ->
            host.id to host.sessions.filter { it.running }.map { it.id }.toSet()
        }
        if (!isAppForeground()) {
            for (host in hosts) {
                val finished = (previousRunning[host.id] ?: emptySet()) - (runningByHost[host.id] ?: emptySet())
                for (sessionId in finished) {
                    val session = host.sessions.firstOrNull { it.id == sessionId } ?: continue
                    val text = host.assistantTexts[sessionId].orEmpty()
                    Alerts.turnEnd(
                        this,
                        host.id,
                        host.label,
                        sessionId,
                        session.title ?: "任务",
                        text
                    )
                }
            }
        }
        previousRunning = runningByHost
    }

    private fun isAppForeground(): Boolean {
        val manager = getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager ?: return false
        val importance = manager.runningAppProcesses
            ?.firstOrNull { it.processName == packageName }
            ?.importance
        return importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
    }
}
