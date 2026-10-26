package com.ts7.dshremote.notify

import android.app.ActivityManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import com.ts7.dshremote.DshApp
import com.ts7.dshremote.data.AppState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

class BridgeService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var collecting = false
    private val seenApprovals = mutableSetOf<String>()
    private val seenQuestions = mutableSetOf<String>()
    private var previousRunning: Set<String> = emptySet()
    private var previousConnected = false

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
                repository.state.collect { state -> onState(state) }
            }
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        collecting = false
        scope.cancel()
        super.onDestroy()
    }

    private fun onState(state: AppState) {
        val wasConnected = previousConnected
        if (!state.connected && wasConnected) {
            Alerts.connectionLost(this)
        }
        if (state.connected != previousConnected) {
            previousConnected = state.connected
            val detail = if (state.connected) {
                "已连接 ${state.info?.bridge?.hostName ?: "电脑"}"
            } else {
                "连接已断开，点按重试"
            }
            startForeground(Alerts.FOREGROUND_ID, Alerts.foreground(this, detail))
        }

        val approvals = state.pending.approvals
        for (approval in approvals) {
            if (seenApprovals.add(approval.id)) Alerts.approval(this, approval)
        }
        seenApprovals.retainAll(approvals.map { it.id }.toSet())

        val questions = state.pending.questions
        for (question in questions) {
            if (seenQuestions.add(question.id)) Alerts.question(this, question)
        }
        seenQuestions.retainAll(questions.map { it.id }.toSet())

        val running = state.sessions.filter { it.running }.map { it.id }.toSet()
        val finished = previousRunning - running
        previousRunning = running
        if (finished.isNotEmpty() && !isAppForeground()) {
            for (sessionId in finished) {
                val session = state.sessions.firstOrNull { it.id == sessionId } ?: continue
                val text = if (state.activeSessionId == sessionId) {
                    state.timeline.lastOrNull { it.kind == "assistant" }?.text.orEmpty()
                } else {
                    ""
                }
                Alerts.turnEnd(this, sessionId, session.title ?: "任务", text)
            }
        }
    }

    private fun isAppForeground(): Boolean {
        val manager = getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager ?: return false
        val importance = manager.runningAppProcesses
            ?.firstOrNull { it.processName == packageName }
            ?.importance
        return importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
    }
}
