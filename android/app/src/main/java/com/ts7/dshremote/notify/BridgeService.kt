package com.ts7.dshremote.notify

import android.annotation.SuppressLint
import android.app.Notification
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.ts7.dshremote.DshApp
import com.ts7.dshremote.data.BridgeRepository
import com.ts7.dshremote.data.ConnectionState
import com.ts7.dshremote.data.HostSnapshot
import com.ts7.dshremote.data.RunLog
import com.ts7.dshremote.data.TurnNotice
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * Owns the connection while the UI is gone.
 *
 * The repository is started here, not only from the activity, so a service
 * restarted by the system (START_STICKY) or by [BootReceiver] reconnects without
 * anyone opening the app. With the screen off the stream is kept alive by a wake
 * lock ([KeepAlive]) and a periodic reconcile that repairs whatever SSE frames the
 * device dropped while dozing.
 */
class BridgeService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private lateinit var repository: BridgeRepository
    private lateinit var keepAlive: KeepAlive

    private var collecting = false
    private var announcing = false
    private var ticker: Job? = null
    private var screenReceiver: BroadcastReceiver? = null

    private val seenApprovals = mutableSetOf<Pair<String, String>>()
    private val seenQuestions = mutableSetOf<Pair<String, String>>()
    private var previousRunning: Map<String, Set<String>> = emptyMap()
    private var previousConnections: Map<String, ConnectionState> = emptyMap()
    private var foregroundText: String? = null
    private var lastHosts: List<HostSnapshot> = emptyList()
    private val announced = mutableMapOf<String, Long>()
    /** 掉线复核任务：key 是 host id。 */
    private val lostChecks = mutableMapOf<String, Job>()

    override fun onCreate() {
        super.onCreate()
        Alerts.createChannels(this)
        repository = (application as DshApp).repository
        keepAlive = KeepAlive(this)
        // The activity may never be created again after a system restart.
        repository.start()
        registerScreenReceiver()
        if (!announcing) {
            announcing = true
            scope.launch {
                repository.turnNotices.collect { notice -> onTurnNotice(notice) }
            }
        }
        startTicker()
        if (!isInteractive()) keepAlive.acquire()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForegroundCompat(foregroundText ?: "正在保持局域网连接")
        if (!collecting) {
            collecting = true
            scope.launch {
                repository.hosts.collect { hosts -> onHosts(hosts) }
            }
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        collecting = false
        announcing = false
        ticker?.cancel()
        screenReceiver?.let { runCatching { unregisterReceiver(it) } }
        screenReceiver = null
        keepAlive.release()
        scope.cancel()
        (application as DshApp).tailscale.stop()
        super.onDestroy()
    }

    private fun startForegroundCompat(detail: String) {
        val notification: Notification = Alerts.foreground(this, detail)
        val type = if (Build.VERSION.SDK_INT >= 29) {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING
        } else {
            0
        }
        runCatching {
            ServiceCompat.startForeground(this, Alerts.FOREGROUND_ID, notification, type)
        }.onFailure {
            // Starting a foreground service from the background can be refused on
            // Android 12+; retrying with the plain call keeps the service alive.
            runCatching { startForeground(Alerts.FOREGROUND_ID, notification) }
        }
    }

    private fun isInteractive(): Boolean {
        val power = getSystemService(PowerManager::class.java) ?: return true
        return power.isInteractive
    }

    /**
     * Screen state is what decides whether the wake lock is worth holding, and a
     * screen-off transition is also the best moment to resync: the device was very
     * likely asleep just before, so cached running flags and pending queues may be
     * stale.
     */
    @SuppressLint("UnspecifiedRegisterReceiverFlag")
    private fun registerScreenReceiver() {
        if (screenReceiver != null) return
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                when (intent.action) {
                    Intent.ACTION_SCREEN_OFF -> {
                        keepAlive.acquire()
                        repository.reconcile()
                    }
                    Intent.ACTION_SCREEN_ON -> {
                        keepAlive.release()
                        repository.reevaluateRoutes()
                    }
                }
            }
        }
        screenReceiver = receiver
        val filter = IntentFilter().apply {
            addAction(Intent.ACTION_SCREEN_OFF)
            addAction(Intent.ACTION_SCREEN_ON)
        }
        runCatching {
            ContextCompat.registerReceiver(this, receiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED)
        }.onFailure { screenReceiver = null }
    }

    /**
     * Heartbeat for the phone side. The host only reports a state change when it
     * sees the stream, so a stream that died during doze would otherwise look
     * healthy forever. Polling the two cheap endpoints once a minute repairs
     * running flags and surfaces approvals well inside their desktop timeout.
     */
    private fun startTicker() {
        if (ticker != null) return
        ticker = scope.launch {
            while (isActive) {
                delay(60_000)
                if (!isActive) break
                if (isInteractive()) {
                    keepAlive.release()
                } else {
                    keepAlive.acquire()
                }
                repository.reconcile()
            }
        }
    }

    private fun onTurnNotice(notice: TurnNotice) {
        if (AppVisibility.visible && repository.state.value.activeSessionId == notice.sessionId) return
        val host = lastHosts.firstOrNull { it.id == notice.hostId }
        val label = host?.label ?: notice.hostLabel
        val sessionTitle = host?.sessions?.firstOrNull { it.id == notice.sessionId }?.title
            ?: notice.title
        if (!dedupe(notice.hostId, notice.sessionId)) return
        if (notice.kind == "turn-error") {
            Alerts.turnFailed(this, notice.hostId, label, notice.sessionId, sessionTitle, notice.text)
        } else {
            Alerts.turnEnd(this, notice.hostId, label, notice.sessionId, sessionTitle, notice.text)
        }
    }

    /**
     * Completion can arrive twice: as a host `notice` frame and as a running flag
     * flipping back in a status frame. Both paths share this window so the user
     * still gets exactly one notification per finished turn.
     */
    private fun dedupe(hostId: String, sessionId: String, windowMs: Long = 15_000): Boolean {
        val key = "$hostId:$sessionId"
        val now = System.currentTimeMillis()
        val last = announced[key]
        if (last != null && now - last < windowMs) return false
        announced[key] = now
        if (announced.size > 64) {
            announced.entries.removeAll { now - it.value > 120_000 }
        }
        return true
    }

    private fun onHosts(hosts: List<HostSnapshot>) {
        lastHosts = hosts
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
            startForegroundCompat(detail)
        }

        for (host in hosts) {
            val previous = previousConnections[host.id]
            if (previous == ConnectionState.Connected && host.connection != ConnectionState.Connected) {
                scheduleLostCheck(host)
            } else if (previous != ConnectionState.Connected && host.connection == ConnectionState.Connected) {
                lostChecks.remove(host.id)?.cancel()
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
            if (seenQuestions.add(host.id to question.id)) {
                if (question.planReview) {
                    RunLog.info("notify", "${host.label} 计划待审阅 ${question.id}")
                }
                Alerts.question(this, host.id, host.label, question)
            }
        }
        val questionKeys = questions.map { it.first.id to it.second.id }.toSet()
        for (old in seenQuestions - questionKeys) {
            Alerts.cancelQuestion(this, old.first, old.second)
        }
        seenQuestions.retainAll(questionKeys)

        // Fallback for a lost `notice` frame: a session that was running and is not
        // any more has finished as far as the phone can tell.
        val runningByHost = hosts.associate { host ->
            host.id to host.sessions.filter { it.running }.map { it.id }.toSet()
        }
        if (!AppVisibility.visible) {
            for (host in hosts) {
                val finished = (previousRunning[host.id] ?: emptySet()) - (runningByHost[host.id] ?: emptySet())
                for (sessionId in finished) {
                    val session = host.sessions.firstOrNull { it.id == sessionId } ?: continue
                    if (!dedupe(host.id, sessionId)) continue
                    val text = host.assistantTexts[sessionId].orEmpty()
                    Alerts.turnEnd(this, host.id, host.label, sessionId, session.title ?: "任务", text)
                }
            }
        }
        previousRunning = runningByHost
    }

    /**
     * 掉线不立刻发通知。Wi-Fi 与移动数据来回切、进电梯、地铁出站这些场景都有一两秒的空窗，
     * 立刻弹一条「连接已断开」纯属噪音；这里等 20 秒复查，真没连回来才算断。
     */
    private fun scheduleLostCheck(host: HostSnapshot) {
        lostChecks.remove(host.id)?.cancel()
        lostChecks[host.id] = scope.launch {
            delay(LostCheckDelayMs)
            val current = lastHosts.firstOrNull { it.id == host.id }
            if (current == null || current.connection != ConnectionState.Connected) {
                Alerts.connectionLost(this@BridgeService, host.label, current?.error ?: host.error)
            }
            lostChecks.remove(host.id)
        }
    }

    private companion object {
        const val LostCheckDelayMs = 20_000L
    }
}
