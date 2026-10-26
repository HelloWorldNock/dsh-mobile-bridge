package com.ts7.dshremote.data

import android.content.Context
import android.os.Build
import java.util.UUID
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

class BridgeRepository(context: Context) {
    private val prefs = context.getSharedPreferences("dsh_remote", Context.MODE_PRIVATE)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val _state = MutableStateFlow(AppState())
    val state: StateFlow<AppState> = _state.asStateFlow()

    private var client: BridgeClient? = null
    private var eventJob: Job? = null
    private var started = false

    val installId: String
        get() = prefs.getString("installId", null)
            ?: UUID.randomUUID().toString().also { prefs.edit().putString("installId", it).apply() }

    val savedBaseUrl: String get() = prefs.getString("baseUrl", "").orEmpty()
    val hasSavedPair: Boolean get() = savedBaseUrl.isNotBlank() && prefs.getString("token", "").orEmpty().isNotBlank()

    fun start() {
        if (started) return
        started = true
        if (!hasSavedPair) {
            _state.update { it.copy(restored = true) }
            return
        }
        _state.update { it.copy(baseUrl = savedBaseUrl, connection = ConnectionState.Connecting, restored = true) }
        scope.launch { runCatching { connectOnce() } }
    }

    fun retry() {
        scope.launch { runCatching { connectOnce() } }
    }

    fun refreshCatalog() {
        scope.launch {
            refreshWorkspaces()
            refreshPresets()
        }
    }

    suspend fun pair(baseUrl: String, code: String): Result<Unit> = runCatching {
        val install = installId
        val result = BridgeClient.pair(
            rawBaseUrl = baseUrl,
            code = code,
            installId = install,
            deviceName = Build.MODEL ?: "Android",
            model = Build.MODEL ?: "Android",
            appVersion = "0.1.0"
        )
        prefs.edit()
            .putString("baseUrl", normalizeBaseUrl(baseUrl))
            .putString("token", result.token)
            .putString("deviceId", result.device?.id)
            .apply()
        _state.update { it.copy(baseUrl = normalizeBaseUrl(baseUrl), connection = ConnectionState.Connecting, error = null) }
        connectOnce()
    }

    private suspend fun connectOnce() {
        val base = savedBaseUrl
        val token = prefs.getString("token", "").orEmpty()
        if (base.isBlank() || token.isBlank()) error("尚未配对")
        eventJob?.cancel()
        val next = BridgeClient(base, token)
        client = next
        _state.update { it.copy(connection = ConnectionState.Connecting, baseUrl = base, error = null) }
        val info = next.info()
        _state.update { it.copy(connection = ConnectionState.Connected, info = info, error = null) }
        refreshSessions()
        refreshWorkspaces()
        refreshPresets()
        refreshPending()
        startEvents(next)
    }

    private fun startEvents(active: BridgeClient) {
        eventJob = scope.launch {
            while (isActive) {
                try {
                    active.events().collect { event -> handleEvent(event) }
                } catch (error: Throwable) {
                    if (!isActive) break
                    _state.update {
                        it.copy(
                            connection = ConnectionState.Connecting,
                            error = error.message?.takeIf { message -> message.isNotBlank() }
                        )
                    }
                }
                if (!isActive) break
                delay(2_000)
            }
        }
    }

    fun disconnect() {
        eventJob?.cancel()
        client = null
        _state.update { it.copy(connection = ConnectionState.Disconnected) }
    }

    fun forget() {
        eventJob?.cancel()
        client = null
        prefs.edit().remove("baseUrl").remove("token").remove("deviceId").apply()
        _state.value = AppState(restored = true)
    }

    fun clearNotice() {
        _state.update { it.copy(notice = null, error = null) }
    }

    fun refreshSessions() {
        val active = client ?: return
        scope.launch {
            runCatching { active.sessions() }.onSuccess { sessions ->
                _state.update { state -> state.copy(sessions = sort(sessions)) }
            }
        }
    }

    fun refreshPending() {
        val active = client ?: return
        scope.launch {
            runCatching { active.pending() }.onSuccess { pending ->
                _state.update { it.copy(pending = pending) }
            }
        }
    }

    private fun refreshWorkspaces() {
        val active = client ?: return
        scope.launch {
            runCatching { active.workspaces() }.onSuccess { workspaces ->
                _state.update { it.copy(workspaces = workspaces) }
            }
        }
    }

    private fun refreshPresets() {
        val active = client ?: return
        scope.launch {
            runCatching { active.presets() }.onSuccess { presets ->
                _state.update { it.copy(presets = presets) }
            }
        }
    }

    fun openSession(id: String) {
        val active = client ?: return
        _state.update { it.copy(activeSessionId = id, timeline = emptyList(), streamText = "", busy = true) }
        scope.launch {
            runCatching {
                active.subscribe(id)
                active.session(id)
            }.onSuccess { detail ->
                _state.update {
                    it.copy(
                        activeSessionId = id,
                        detail = detail,
                        timeline = detail.records,
                        pending = detail.pending,
                        busy = false
                    )
                }
                refreshSessions()
            }.onFailure { error ->
                _state.update { it.copy(busy = false, error = error.message ?: "无法打开任务") }
            }
        }
    }

    fun closeSession() {
        val id = _state.value.activeSessionId
        val active = client
        _state.update { it.copy(activeSessionId = null, detail = null, timeline = emptyList(), streamText = "") }
        if (id != null && active != null) {
            scope.launch { runCatching { active.unsubscribe(id) } }
        }
    }

    suspend fun sendPrompt(text: String, mode: String = "queue"): Result<Unit> {
        val id = _state.value.activeSessionId ?: return Result.failure(IllegalStateException("没有打开任务"))
        val active = client ?: return Result.failure(IllegalStateException("未连接"))
        if (text.isBlank()) return Result.failure(IllegalArgumentException("内容不能为空"))
        _state.update { it.copy(streamText = "") }
        return runCatching { active.prompt(id, text, mode) }
            .onSuccess { refreshPending() }
            .onFailure { error -> _state.update { it.copy(error = error.message ?: "发送失败") } }
    }

    suspend fun cancelSession(): Result<Unit> {
        val id = _state.value.activeSessionId ?: return Result.failure(IllegalStateException("没有打开任务"))
        val active = client ?: return Result.failure(IllegalStateException("未连接"))
        return runCatching { active.cancel(id) }
            .onFailure { error -> _state.update { it.copy(error = error.message ?: "停止失败") } }
    }

    suspend fun deleteActiveSession(): Result<Unit> {
        val id = _state.value.activeSessionId ?: return Result.failure(IllegalStateException("没有打开任务"))
        val active = client ?: return Result.failure(IllegalStateException("未连接"))
        return runCatching {
            active.deleteSession(id)
            runCatching { active.unsubscribe(id) }
            _state.update {
                it.copy(
                    sessions = it.sessions.filterNot { row -> row.id == id },
                    activeSessionId = null,
                    detail = null,
                    timeline = emptyList(),
                    streamText = ""
                )
            }
            refreshSessions()
        }.onFailure { error -> _state.update { it.copy(error = error.message ?: "删除失败") } }
    }

    suspend fun renameSession(title: String): Result<Unit> {
        val id = _state.value.activeSessionId ?: return Result.failure(IllegalStateException("没有打开任务"))
        val active = client ?: return Result.failure(IllegalStateException("未连接"))
        return runCatching {
            active.rename(id, title)
            refreshSessions()
            val detail = active.session(id)
            _state.update { it.copy(detail = detail) }
        }.onFailure { error -> _state.update { it.copy(error = error.message ?: "重命名失败") } }
    }

    suspend fun setPermission(preset: String): Result<Unit> {
        val id = _state.value.activeSessionId ?: return Result.failure(IllegalStateException("没有打开任务"))
        val active = client ?: return Result.failure(IllegalStateException("未连接"))
        return runCatching {
            active.setPermission(id, preset)
            val detail = active.session(id)
            _state.update { it.copy(detail = detail) }
            refreshSessions()
        }.onFailure { error -> _state.update { it.copy(error = error.message ?: "权限切换失败") } }
    }

    suspend fun setPlan(active: Boolean): Result<Unit> {
        val id = _state.value.activeSessionId ?: return Result.failure(IllegalStateException("没有打开任务"))
        val bridge = client ?: return Result.failure(IllegalStateException("未连接"))
        return runCatching {
            bridge.setPlan(id, active)
            val detail = bridge.session(id)
            _state.update { it.copy(detail = detail) }
            refreshSessions()
        }.onFailure { error -> _state.update { it.copy(error = error.message ?: "计划模式切换失败") } }
    }

    suspend fun approve(id: String, action: String): Result<Unit> {
        val active = client ?: return Result.failure(IllegalStateException("未连接"))
        return runCatching { active.approve(id, action) }
            .onSuccess { removeApproval(id) }
            .onFailure { error -> _state.update { it.copy(error = error.message ?: "审批提交失败") } }
    }

    suspend fun answer(id: String, answers: List<AnswerItem>): Result<Unit> {
        val active = client ?: return Result.failure(IllegalStateException("未连接"))
        return runCatching { active.answer(id, answers) }
            .onSuccess { removeQuestion(id) }
            .onFailure { error -> _state.update { it.copy(error = error.message ?: "回答提交失败") } }
    }

    suspend fun createSession(
        workspaceId: String?,
        cwd: String?,
        prompt: String,
        plan: Boolean,
        permission: String?
    ): Result<String> {
        val active = client ?: return Result.failure(IllegalStateException("未连接"))
        return runCatching {
            val created = active.createSession(workspaceId, cwd, prompt, plan, permission)
            refreshSessions()
            created.sessionId
        }.onFailure { error -> _state.update { it.copy(error = error.message ?: "创建任务失败") } }
    }

    private fun handleEvent(event: SseEvent) {
        try {
            when (event.name) {
                "hello" -> _state.update { it.copy(connection = ConnectionState.Connected) }
                "session.snapshot" -> handleSnapshot(event.data)
                "session.event" -> handleSessionEvent(event.data)
                "assistant.delta" -> handleDelta(event.data)
                "session.added", "session.updated" -> {
                    val envelope = JsonConfig.json.decodeFromString(SessionEnvelope.serializer(), event.data)
                    upsert(envelope.session)
                }
                "session.status" -> {
                    val envelope = JsonConfig.json.decodeFromString(StatusEnvelope.serializer(), event.data)
                    val replacement = envelope.session
                    _state.update { state ->
                        val sessions = if (replacement != null) {
                            upsertList(state.sessions, replacement)
                        } else {
                            state.sessions.map { if (it.id == envelope.sessionId) it.copy(running = envelope.running) else it }
                        }
                        val detail = state.detail?.let { current ->
                            if (current.session.id == envelope.sessionId) {
                                current.copy(session = current.session.copy(running = envelope.running))
                            } else current
                        }
                        state.copy(
                            sessions = sessions,
                            detail = detail,
                            streamText = if (!envelope.running && state.activeSessionId == envelope.sessionId) "" else state.streamText
                        )
                    }
                }
                "session.activity" -> {
                    val envelope = JsonConfig.json.decodeFromString(SessionIdEnvelope.serializer(), event.data)
                    _state.update { state ->
                        state.copy(
                            sessions = sort(state.sessions.map {
                                if (it.id == envelope.sessionId) it.copy(updatedAt = envelope.updatedAt) else it
                            })
                        )
                    }
                }
                "session.removed" -> {
                    val envelope = JsonConfig.json.decodeFromString(SessionIdEnvelope.serializer(), event.data)
                    _state.update { state ->
                        state.copy(
                            sessions = state.sessions.filterNot { it.id == envelope.sessionId },
                            activeSessionId = state.activeSessionId?.takeIf { it != envelope.sessionId },
                            detail = state.detail?.takeIf { it.session.id != envelope.sessionId }
                        )
                    }
                }
                "session.error" -> {
                    val envelope = JsonConfig.json.decodeFromString(SessionIdEnvelope.serializer(), event.data)
                    _state.update { it.copy(error = envelope.message) }
                }
                "approval.requested" -> {
                    val approval = JsonConfig.json.decodeFromString(PendingApproval.serializer(), event.data)
                    _state.update { state ->
                        state.copy(pending = state.pending.copy(approvals = upsertApproval(state.pending.approvals, approval)))
                    }
                }
                "question.requested" -> {
                    val question = JsonConfig.json.decodeFromString(PendingQuestion.serializer(), event.data)
                    _state.update { state ->
                        state.copy(pending = state.pending.copy(questions = upsertQuestion(state.pending.questions, question)))
                    }
                }
                "approval.closed" -> removeApproval(JsonConfig.json.decodeFromString(ClosedEnvelope.serializer(), event.data).id)
                "question.closed" -> removeQuestion(JsonConfig.json.decodeFromString(ClosedEnvelope.serializer(), event.data).id)
            }
        } catch (_: Throwable) {
            // Ignore unknown or malformed events; the stream keeps running.
        }
    }

    private fun handleSnapshot(raw: String) {
        val envelope = JsonConfig.json.decodeFromString(SnapshotEnvelope.serializer(), raw)
        _state.update {
            if (it.activeSessionId != envelope.sessionId) it
            else it.copy(timeline = envelope.records, streamText = "")
        }
    }

    private fun handleSessionEvent(raw: String) {
        val envelope = JsonConfig.json.decodeFromString(SessionEventEnvelope.serializer(), raw)
        val item = envelope.item ?: return
        _state.update { state ->
            if (state.activeSessionId != envelope.sessionId) return@update state
            val timeline = if (timelineContains(state.timeline, item.seq)) state.timeline else state.timeline + item
            val running = when {
                item.kind == "turn" && item.phase == "start" -> true
                item.kind == "turn" && item.phase == "end" -> false
                else -> state.activeSession?.running ?: state.detail?.session?.running ?: false
            }
            state.copy(
                timeline = timeline,
                streamText = if (item.kind == "turn" && item.phase == "end") "" else state.streamText,
                detail = state.detail?.let { detail ->
                    detail.copy(session = detail.session.copy(running = running))
                }
            )
        }
    }

    private fun handleDelta(raw: String) {
        val envelope = JsonConfig.json.decodeFromString(DeltaEnvelope.serializer(), raw)
        val item = envelope.item ?: return
        if (item.phase != "delta" || item.kind != "text") return
        val text = item.text ?: return
        _state.update { state ->
            if (state.activeSessionId != envelope.sessionId) state
            else state.copy(streamText = (state.streamText + text).takeLast(12_000))
        }
    }

    private fun removeApproval(id: String) {
        _state.update { state ->
            state.copy(pending = state.pending.copy(approvals = state.pending.approvals.filterNot { it.id == id }))
        }
    }

    private fun removeQuestion(id: String) {
        _state.update { state ->
            state.copy(pending = state.pending.copy(questions = state.pending.questions.filterNot { it.id == id }))
        }
    }

    private fun upsert(session: SessionSummary) {
        _state.update { state ->
            state.copy(
                sessions = upsertList(state.sessions, session),
                detail = state.detail?.let { if (it.session.id == session.id) it.copy(session = session) else it }
            )
        }
    }

    private fun upsertList(list: List<SessionSummary>, session: SessionSummary): List<SessionSummary> {
        val index = list.indexOfFirst { it.id == session.id }
        if (index < 0) return sort(list + session)
        val copy = list.toMutableList()
        copy[index] = session
        return sort(copy)
    }

    private fun upsertApproval(list: List<PendingApproval>, approval: PendingApproval): List<PendingApproval> {
        val index = list.indexOfFirst { it.id == approval.id }
        if (index < 0) return list + approval
        val copy = list.toMutableList()
        copy[index] = approval
        return copy
    }

    private fun upsertQuestion(list: List<PendingQuestion>, question: PendingQuestion): List<PendingQuestion> {
        val index = list.indexOfFirst { it.id == question.id }
        if (index < 0) return list + question
        val copy = list.toMutableList()
        copy[index] = question
        return copy
    }

    private fun timelineContains(items: List<TimelineItem>, seq: Long): Boolean {
        if (seq <= 0) return false
        return items.any { it.seq == seq }
    }

    private fun sort(items: List<SessionSummary>): List<SessionSummary> =
        items.sortedWith(compareByDescending<SessionSummary> { it.updatedAt ?: 0L }.thenByDescending { it.id })
}
