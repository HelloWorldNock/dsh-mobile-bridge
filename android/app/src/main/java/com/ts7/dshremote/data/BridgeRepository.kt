package com.ts7.dshremote.data

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Build
import com.ts7.dshremote.BuildConfig
import java.io.IOException
import java.util.UUID
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * Keeps one runtime per paired desktop. Every host keeps its own SSE stream,
 * session catalog and pending queue; the UI shows the active host.
 */
class BridgeRepository(
    context: Context,
    val tailscale: EmbeddedTailscale = EmbeddedTailscale(context.applicationContext)
) {
    private val appContext = context.applicationContext
    private val prefs = appContext.getSharedPreferences(HostStore.PREFS, Context.MODE_PRIVATE)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val _state = MutableStateFlow(AppState())
    val state: StateFlow<AppState> = _state.asStateFlow()

    private val _hostSnapshots = MutableStateFlow<List<HostSnapshot>>(emptyList())
    val hosts: StateFlow<List<HostSnapshot>> = _hostSnapshots.asStateFlow()

    private val _pendingHosts = MutableStateFlow<List<HostPending>>(emptyList())
    val pendingHosts: StateFlow<List<HostPending>> = _pendingHosts.asStateFlow()

    private class Runtime(var profile: PairedHost) {
        var connection: ConnectionState = ConnectionState.Disconnected
        var endpointKind: String? = null
        var info: BridgeInfo? = null
        var client: BridgeClient? = null
        var connectJob: Job? = null
        var eventJob: Job? = null
        var sessions: List<SessionSummary> = emptyList()
        var pending: PendingState = PendingState()
        var workspaces: List<Workspace> = emptyList()
        var presets: PresetCatalog = PresetCatalog()
        var activeSessionId: String? = null
        var pendingOpenSessionId: String? = null
        var detail: SessionDetail? = null
        var timeline: List<TimelineItem> = emptyList()
        var streamText: String = ""
        var busy: Boolean = false
        var error: String? = null
        var notice: String? = null
        var assistantTexts: MutableMap<String, String> = mutableMapOf()

        val pendingCount: Int get() = pending.approvals.size + pending.questions.size
        val label: String
            get() = info?.bridge?.hostName?.takeIf { it.isNotBlank() }
                ?: profile.hostName?.takeIf { it.isNotBlank() }
                ?: profile.baseUrl
    }

    private val runtimes = LinkedHashMap<String, Runtime>()
    private var activeId: String? = null
    private var started = false
    private var networkCallback: ConnectivityManager.NetworkCallback? = null
    private var routeCheckJob: Job? = null

    private data class OpenedEndpoint(
        val client: BridgeClient,
        val info: BridgeInfo,
        val endpoint: BridgeEndpoint
    )

    val installId: String
        get() = prefs.getString("installId", null)
            ?: UUID.randomUUID().toString().also { prefs.edit().putString("installId", it).apply() }

    val hasSavedPair: Boolean get() = runtimes.isNotEmpty()
    val savedBaseUrl: String get() = activeRuntime()?.profile?.baseUrl.orEmpty()

    init {
        val saved = HostStore.load(appContext)
        for (host in saved) runtimes[host.id] = Runtime(host)
        activeId = HostStore.activeId(appContext)?.takeIf { runtimes.containsKey(it) } ?: saved.lastOrNull()?.id
        sync()
        scope.launch {
            var previous: EmbeddedTailscale.Phase? = null
            tailscale.state.collect { snapshot ->
                val phase = snapshot.phase
                val settled = phase == EmbeddedTailscale.Phase.Connected ||
                    phase == EmbeddedTailscale.Phase.Off
                if (started && settled && phase != previous) {
                    runtimes.values.forEach { it.connectJob?.cancel() }
                    scheduleRouteCheck()
                }
                previous = phase
            }
        }
    }

    fun start() {
        if (started) return
        started = true
        registerNetworkMonitor()
        tailscale.startIfEnabled()
        if (runtimes.isNotEmpty()) {
            runtimes.values.forEach(::ensureConnected)
        }
        sync()
    }

    /** Re-probe LAN/Tailscale after the app returns to the foreground. */
    fun reevaluateRoutes() {
        if (started) scheduleRouteCheck()
    }

    private fun registerNetworkMonitor() {
        if (networkCallback != null) return
        val manager = appContext.getSystemService(ConnectivityManager::class.java) ?: return
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                scheduleRouteCheck()
            }

            override fun onLost(network: Network) {
                scheduleRouteCheck()
            }

            override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) {
                scheduleRouteCheck()
            }
        }
        networkCallback = callback
        runCatching { manager.registerDefaultNetworkCallback(callback) }
    }

    private fun scheduleRouteCheck() {
        routeCheckJob?.cancel()
        routeCheckJob = scope.launch {
            delay(1_200)
            runtimes.values.forEach { runtime -> reevaluateRoute(runtime) }
        }
    }

    /**
     * When the phone changes network, prefer a reachable LAN address; if the
     * LAN is gone, the tailnet address wins. Only reconnect when the chosen
     * route differs, so ordinary network chatter does not disturb SSE.
     */
    private suspend fun reevaluateRoute(runtime: Runtime) {
        if (runtimes[runtime.profile.id] !== runtime) return
        if (runtime.connectJob?.isActive == true) return
        if (runtime.profile.token.isBlank()) return
        if (runtime.connection == ConnectionState.Disconnected) return
        val best = pickReachable(runtime) ?: return
        if (normalizeBaseUrl(best.url) != normalizeBaseUrl(runtime.profile.baseUrl) ||
            runtime.connection != ConnectionState.Connected
        ) {
            restart(runtime)
        }
    }

    private fun probeTimeout(kind: String): Long = if (kind == Endpoints.TAILSCALE) 3_500L else 1_800L

    /**
     * Embedded Tailscale is a userspace node: tailnet targets are reached
     * through a loopback proxy. Direct tailnet addresses keep working when the
     * embedded node is off (system Tailscale VPN installed on the phone).
     */
    private fun clientFor(endpoint: BridgeEndpoint, token: String, timeoutMs: Long): BridgeClient {
        if (endpoint.kind == Endpoints.TAILSCALE && tailscale.state.value.enabled) {
            val host = runCatching { java.net.URI(endpoint.url).host }.getOrNull()
                ?.trim('[', ']')
                ?: error("Tailscale 地址无效")
            val port = runCatching { java.net.URI(endpoint.url).port }.getOrNull()
                ?.takeIf { it in 1..65535 }
                ?: 80
            val local = tailscale.proxyFor(host, port)
                ?: throw IOException("内嵌 Tailscale 正在连接")
            return BridgeClient("http://127.0.0.1:$local", token, timeoutMs)
        }
        return BridgeClient(endpoint.url, token, timeoutMs)
    }

    private fun matches(runtime: Runtime, info: BridgeInfo): Boolean {
        val expected = runtime.profile.deviceId?.takeIf { it.isNotBlank() } ?: return true
        val reported = info.bridge?.deviceId?.takeIf { it.isNotBlank() } ?: return true
        return expected == reported
    }

    private suspend fun pickReachable(runtime: Runtime): BridgeEndpoint? {
        val token = runtime.profile.token
        for (endpoint in runtime.profile.candidates) {
            try {
                val info = clientFor(endpoint, token, probeTimeout(endpoint.kind)).info()
                if (matches(runtime, info)) return endpoint
            } catch (failure: ApiException) {
                if (failure.status == 401) return null
            } catch (_: Throwable) {
                // Try the next route.
            }
        }
        return null
    }

    fun retry(hostId: String? = activeId) {
        val runtime = hostId?.let { runtimes[it] } ?: return
        restart(runtime)
    }

    /**
     * Adds a manually entered fallback address (for example a host-side
     * port-forward exposed on the tailnet). Route probing stays automatic.
     */
    fun addEndpoint(hostId: String, rawUrl: String): Result<Unit> = runCatching {
        val runtime = runtimes[hostId] ?: error("主机不存在")
        val normalized = normalizeBaseUrl(rawUrl)
        require(normalized.isNotBlank()) { "地址为空" }
        runtime.profile = runtime.profile.copy(
            endpoints = Endpoints.merge(
                baseUrl = runtime.profile.baseUrl,
                existing = runtime.profile.endpoints,
                incoming = listOf(BridgeEndpoint(kind = Endpoints.kindOf(normalized), url = normalized))
            )
        )
        persist()
        restart(runtime)
        sync()
    }

    fun refreshCatalog() {
        val runtime = activeRuntime() ?: return
        refreshWorkspaces(runtime)
        refreshPresets(runtime)
    }

    suspend fun pair(
        baseUrl: String,
        code: String,
        knownHostName: String? = null,
        knownDeviceId: String? = null
    ): Result<Unit> = runCatching {
        val base = normalizeBaseUrl(baseUrl)
        val result = BridgeClient.pair(
            rawBaseUrl = base,
            code = code,
            installId = installId,
            deviceName = Build.MODEL ?: "Android",
            model = Build.MODEL ?: "Android",
            appVersion = BuildConfig.VERSION_NAME
        )
        val hostDeviceId = result.host?.id?.takeIf { it.isNotBlank() }
            ?: knownDeviceId?.takeIf { it.isNotBlank() }
        val byBase = runtimes.values.firstOrNull {
            normalizeBaseUrl(it.profile.baseUrl) == base
        }
        val byDevice = runtimes.values.firstOrNull { runtime ->
            hostDeviceId != null &&
                runtime.profile.deviceId == hostDeviceId &&
                HostStore.portOf(runtime.profile.baseUrl) == HostStore.portOf(base)
        }
        val existing = byBase ?: byDevice
        val id = existing?.profile?.id ?: HostStore.hostId(hostDeviceId, base)
        val endpoints = Endpoints.merge(
            baseUrl = base,
            existing = existing?.profile?.endpoints.orEmpty(),
            incoming = result.host?.endpoints.orEmpty() + BridgeEndpoint(kind = Endpoints.kindOf(base), url = base)
        )
        val profile = PairedHost(
            id = id,
            baseUrl = base,
            token = result.token,
            deviceId = hostDeviceId,
            hostName = result.host?.name?.takeIf { it.isNotBlank() }
                ?: knownHostName?.takeIf { it.isNotBlank() }
                ?: existing?.profile?.hostName,
            addedAt = existing?.profile?.addedAt ?: System.currentTimeMillis(),
            lastConnectedAt = existing?.profile?.lastConnectedAt,
            endpoints = endpoints
        )
        val runtime = runtimes[id] ?: Runtime(profile)
        runtimes[id] = runtime
        runtime.profile = profile
        runtime.error = null
        activeId = id
        HostStore.setActive(appContext, id)
        persist()
        if (runtime.client != null || runtime.connection != ConnectionState.Disconnected) {
            restart(runtime)
        } else {
            ensureConnected(runtime)
        }
        sync()
    }

    fun selectHost(id: String, baseUrl: String? = null) {
        val runtime = runtimes[id] ?: return
        if (!baseUrl.isNullOrBlank()) {
            val normalized = normalizeBaseUrl(baseUrl)
            if (normalized.isNotBlank() && normalized != normalizeBaseUrl(runtime.profile.baseUrl)) {
                runtime.profile = runtime.profile.copy(
                    baseUrl = normalized,
                    endpoints = Endpoints.merge(
                        baseUrl = normalized,
                        existing = runtime.profile.endpoints,
                        incoming = listOf(BridgeEndpoint(kind = Endpoints.kindOf(normalized), url = normalized))
                    )
                )
                persist()
                activeId = id
                HostStore.setActive(appContext, id)
                restart(runtime)
                sync()
                return
            }
        }
        activeId = id
        HostStore.setActive(appContext, id)
        ensureConnected(runtime)
        sync()
    }

    fun forget(hostId: String? = activeId) {
        val id = hostId ?: return
        val runtime = runtimes.remove(id) ?: return
        runtime.connectJob?.cancel()
        runtime.eventJob?.cancel()
        runtime.activeSessionId?.let { sessionId ->
            runtime.client?.let { client -> scope.launch { runCatching { client.unsubscribe(sessionId) } } }
        }
        if (activeId == id) activeId = runtimes.keys.lastOrNull()
        HostStore.setActive(appContext, activeId)
        persist()
        sync()
    }

    fun clearNotice() {
        val runtime = activeRuntime() ?: return
        runtime.notice = null
        runtime.error = null
        sync()
    }

    fun refreshSessions(hostId: String? = activeId) {
        val runtime = hostId?.let { runtimes[it] } ?: return
        val client = runtime.client ?: return
        scope.launch {
            runCatching { client.sessions() }.onSuccess { sessions ->
                if (runtimes[runtime.profile.id] !== runtime) return@onSuccess
                runtime.sessions = sort(sessions)
                sync()
            }
        }
    }

    fun refreshPending(hostId: String? = activeId) {
        val runtime = hostId?.let { runtimes[it] } ?: return
        val client = runtime.client ?: return
        scope.launch {
            runCatching { client.pending() }.onSuccess { pending ->
                if (runtimes[runtime.profile.id] !== runtime) return@onSuccess
                runtime.pending = pending
                sync()
            }
        }
    }

    fun openSession(id: String) {
        val runtime = activeRuntime() ?: return
        openSessionInternal(runtime, id)
    }

    fun closeSession() {
        val runtime = activeRuntime() ?: return
        val id = runtime.activeSessionId ?: return
        runtime.activeSessionId = null
        runtime.pendingOpenSessionId = null
        runtime.detail = null
        runtime.timeline = emptyList()
        runtime.streamText = ""
        runtime.busy = false
        val client = runtime.client
        sync()
        if (client != null) scope.launch { runCatching { client.unsubscribe(id) } }
    }

    suspend fun sendPrompt(
        text: String,
        mode: String = "queue",
        images: List<PromptImage> = emptyList()
    ): Result<Unit> {
        val runtime = activeRuntime() ?: return Result.failure(IllegalStateException("未连接"))
        val id = runtime.activeSessionId ?: return Result.failure(IllegalStateException("没有打开任务"))
        val client = runtime.client ?: return Result.failure(IllegalStateException("未连接"))
        if (text.isBlank() && images.isEmpty()) return Result.failure(IllegalArgumentException("内容不能为空"))
        runtime.streamText = ""
        sync()
        return runCatching { client.prompt(id, text, mode, images) }
            .onSuccess { refreshPending(runtime.profile.id) }
            .onFailure { error ->
                runtime.error = error.message ?: "发送失败"
                sync()
            }
    }

    suspend fun cancelSession(): Result<Unit> {
        val runtime = activeRuntime() ?: return Result.failure(IllegalStateException("未连接"))
        val id = runtime.activeSessionId ?: return Result.failure(IllegalStateException("没有打开任务"))
        val client = runtime.client ?: return Result.failure(IllegalStateException("未连接"))
        return runCatching { client.cancel(id) }
            .onFailure { error ->
                runtime.error = error.message ?: "停止失败"
                sync()
            }
    }

    suspend fun deleteActiveSession(): Result<Unit> {
        val runtime = activeRuntime() ?: return Result.failure(IllegalStateException("未连接"))
        val id = runtime.activeSessionId ?: return Result.failure(IllegalStateException("没有打开任务"))
        val client = runtime.client ?: return Result.failure(IllegalStateException("未连接"))
        return runCatching {
            client.deleteSession(id)
            runCatching { client.unsubscribe(id) }
            runtime.sessions = runtime.sessions.filterNot { it.id == id }
            runtime.activeSessionId = null
            runtime.pendingOpenSessionId = null
            runtime.detail = null
            runtime.timeline = emptyList()
            runtime.streamText = ""
            runtime.assistantTexts.remove(id)
            sync()
            refreshSessions(runtime.profile.id)
        }.onFailure { error ->
            runtime.error = error.message ?: "删除失败"
            sync()
        }
    }

    suspend fun renameSession(title: String): Result<Unit> {
        val runtime = activeRuntime() ?: return Result.failure(IllegalStateException("未连接"))
        val id = runtime.activeSessionId ?: return Result.failure(IllegalStateException("没有打开任务"))
        val client = runtime.client ?: return Result.failure(IllegalStateException("未连接"))
        return runCatching {
            client.rename(id, title)
            refreshSessions(runtime.profile.id)
            runtime.detail = client.session(id)
            sync()
        }.onFailure { error ->
            runtime.error = error.message ?: "重命名失败"
            sync()
        }
    }

    suspend fun setPermission(preset: String): Result<Unit> {
        val runtime = activeRuntime() ?: return Result.failure(IllegalStateException("未连接"))
        val id = runtime.activeSessionId ?: return Result.failure(IllegalStateException("没有打开任务"))
        val client = runtime.client ?: return Result.failure(IllegalStateException("未连接"))
        return runCatching {
            client.setPermission(id, preset)
            runtime.detail = client.session(id)
            sync()
            refreshSessions(runtime.profile.id)
        }.onFailure { error ->
            runtime.error = error.message ?: "权限切换失败"
            sync()
        }
    }

    suspend fun setPlan(active: Boolean): Result<Unit> {
        val runtime = activeRuntime() ?: return Result.failure(IllegalStateException("未连接"))
        val id = runtime.activeSessionId ?: return Result.failure(IllegalStateException("没有打开任务"))
        val client = runtime.client ?: return Result.failure(IllegalStateException("未连接"))
        return runCatching {
            client.setPlan(id, active)
            runtime.detail = client.session(id)
            sync()
            refreshSessions(runtime.profile.id)
        }.onFailure { error ->
            runtime.error = error.message ?: "计划模式切换失败"
            sync()
        }
    }

    suspend fun approve(id: String, action: String, hostId: String? = activeId): Result<Unit> {
        val runtime = hostId?.let { runtimes[it] } ?: return Result.failure(IllegalStateException("未连接"))
        val client = runtime.client ?: return Result.failure(IllegalStateException("未连接"))
        return runCatching { client.approve(id, action) }
            .onSuccess { removeApproval(runtime, id) }
            .onFailure { error ->
                runtime.error = error.message ?: "审批提交失败"
                sync()
            }
    }

    suspend fun answer(id: String, answers: List<AnswerItem>, hostId: String? = activeId): Result<Unit> {
        val runtime = hostId?.let { runtimes[it] } ?: return Result.failure(IllegalStateException("未连接"))
        val client = runtime.client ?: return Result.failure(IllegalStateException("未连接"))
        return runCatching { client.answer(id, answers) }
            .onSuccess { removeQuestion(runtime, id) }
            .onFailure { error ->
                runtime.error = error.message ?: "回答提交失败"
                sync()
            }
    }

    suspend fun createSession(
        workspaceId: String?,
        cwd: String?,
        prompt: String,
        plan: Boolean,
        permission: String?,
        images: List<PromptImage> = emptyList()
    ): Result<String> {
        val runtime = activeRuntime() ?: return Result.failure(IllegalStateException("未连接"))
        val client = runtime.client ?: return Result.failure(IllegalStateException("未连接"))
        return runCatching {
            val created = client.createSession(workspaceId, cwd, prompt, plan, permission, images = images)
            refreshSessions(runtime.profile.id)
            created.sessionId
        }.onFailure { error ->
            runtime.error = error.message ?: "创建任务失败"
            sync()
        }
    }

    private fun activeRuntime(): Runtime? = activeId?.let { runtimes[it] }

    private fun ensureConnected(runtime: Runtime) {
        if (runtime.connection == ConnectionState.Connected) return
        if (runtime.connectJob?.isActive == true) return
        startRuntime(runtime)
    }

    private fun restart(runtime: Runtime) {
        runtime.connectJob?.cancel()
        runtime.eventJob?.cancel()
        runtime.connectJob = null
        runtime.eventJob = null
        runtime.client = null
        runtime.pendingOpenSessionId = runtime.activeSessionId
        runtime.connection = ConnectionState.Connecting
        runtime.endpointKind = null
        runtime.error = null
        startRuntime(runtime)
    }

    private fun startRuntime(runtime: Runtime) {
        if (runtime.connectJob?.isActive == true) return
        runtime.connectJob = scope.launch {
            var attempt = 0
            while (isActive && runtimes[runtime.profile.id] === runtime) {
                runtime.connection = ConnectionState.Connecting
                runtime.error = null
                sync()
                val failure = runCatching { connectOnce(runtime) }.exceptionOrNull()
                if (failure == null) break
                runtime.connection = ConnectionState.Error
                runtime.error = failure.message?.takeIf { it.isNotBlank() } ?: "无法连接主机"
                sync()
                if (failure is ApiException && failure.status == 401) break
                attempt += 1
                delay(minOf(15_000L, 2_000L * attempt))
            }
            if (runtimes[runtime.profile.id] === runtime && runtime.connection == ConnectionState.Connected) {
                startEvents(runtime)
            }
        }
    }

    private suspend fun openEndpoint(runtime: Runtime): OpenedEndpoint {
        val token = runtime.profile.token
        if (token.isBlank()) error("尚未配对")
        var last: Throwable? = null
        for (endpoint in runtime.profile.candidates) {
            try {
                val probe = clientFor(endpoint, token, probeTimeout(endpoint.kind))
                val info = probe.info()
                if (!matches(runtime, info)) {
                    throw IOException("该地址属于另一台主机")
                }
                return OpenedEndpoint(clientFor(endpoint, token, 15_000L), info, endpoint)
            } catch (failure: ApiException) {
                if (failure.status == 401) throw failure
                last = failure
            } catch (failure: Throwable) {
                last = failure
            }
        }
        throw IOException("局域网和 Tailscale 地址均不可达", last)
    }

    private suspend fun connectOnce(runtime: Runtime) {
        val token = runtime.profile.token
        if (token.isBlank()) error("尚未配对")
        runtime.eventJob?.cancel()
        runtime.eventJob = null
        runtime.connection = ConnectionState.Connecting
        runtime.error = null
        sync()
        val opened = try {
            openEndpoint(runtime)
        } catch (failure: Throwable) {
            runtime.client = null
            throw failure
        }
        val next = opened.client
        val info = opened.info
        runtime.client = next
        runtime.info = info
        runtime.connection = ConnectionState.Connected
        runtime.endpointKind = opened.endpoint.kind
        runtime.error = null

        val bridge = info.bridge
        val hostName = bridge?.hostName?.takeIf { it.isNotBlank() } ?: runtime.profile.hostName
        val deviceId = bridge?.deviceId?.takeIf { it.isNotBlank() } ?: runtime.profile.deviceId
        runtime.profile = runtime.profile.copy(
            baseUrl = opened.endpoint.url,
            hostName = hostName,
            deviceId = deviceId,
            lastConnectedAt = System.currentTimeMillis(),
            endpoints = Endpoints.merge(
                baseUrl = opened.endpoint.url,
                existing = runtime.profile.endpoints,
                incoming = bridge?.endpoints.orEmpty()
            )
        )
        persist()
        sync()

        refreshSessions(runtime.profile.id)
        refreshWorkspaces(runtime)
        refreshPresets(runtime)
        refreshPending(runtime.profile.id)

        val queued = runtime.pendingOpenSessionId
        runtime.pendingOpenSessionId = null
        if (queued != null && runtime.activeSessionId == queued) {
            loadSession(runtime, next, queued)
        }
    }

    private fun startEvents(runtime: Runtime) {
        runtime.eventJob?.cancel()
        runtime.eventJob = scope.launch {
            while (isActive && runtimes[runtime.profile.id] === runtime) {
                val client = runtime.client ?: break
                var failure: Throwable? = null
                try {
                    client.events().collect { event -> handleEvent(runtime, event) }
                } catch (error: Throwable) {
                    if (!isActive) break
                    failure = error
                }
                if (!isActive) break
                // The route may have changed (Wi-Fi -> cellular). Do not retry the
                // stale client forever: probe LAN/Tailscale again and reconnect.
                runtime.connection = ConnectionState.Connecting
                runtime.error = failure?.message?.takeIf { it.isNotBlank() }
                runtime.client = null
                sync()
                scope.launch {
                    delay(1_500)
                    if (runtimes[runtime.profile.id] === runtime) restart(runtime)
                }
                return@launch
            }
        }
    }

    private fun openSessionInternal(runtime: Runtime, id: String) {
        if (runtime.activeSessionId == id && (runtime.busy || runtime.detail != null)) return
        runtime.activeSessionId = id
        runtime.detail = null
        runtime.timeline = emptyList()
        runtime.streamText = ""
        runtime.busy = true
        runtime.error = null
        val client = runtime.client
        if (client == null) {
            runtime.pendingOpenSessionId = id
            ensureConnected(runtime)
            sync()
            return
        }
        sync()
        loadSession(runtime, client, id)
    }

    private fun loadSession(runtime: Runtime, client: BridgeClient, id: String) {
        scope.launch {
            runCatching {
                client.subscribe(id)
                client.session(id)
            }.onSuccess { detail ->
                if (runtime.activeSessionId != id) return@onSuccess
                runtime.detail = detail
                runtime.timeline = detail.records
                runtime.pending = mergePending(runtime.pending, detail.pending)
                runtime.busy = false
                detail.records.lastOrNull { it.kind == "assistant" }?.text?.let {
                    runtime.assistantTexts[id] = it.take(4_000)
                }
                sync()
                refreshSessions(runtime.profile.id)
                refreshPending(runtime.profile.id)
            }.onFailure { error ->
                if (runtime.activeSessionId == id) {
                    runtime.busy = false
                    runtime.error = error.message ?: "无法打开任务"
                    sync()
                }
            }
        }
    }

    private fun refreshWorkspaces(runtime: Runtime) {
        val client = runtime.client ?: return
        scope.launch {
            runCatching { client.workspaces() }.onSuccess { workspaces ->
                if (runtimes[runtime.profile.id] !== runtime) return@onSuccess
                runtime.workspaces = workspaces
                sync()
            }
        }
    }

    private fun refreshPresets(runtime: Runtime) {
        val client = runtime.client ?: return
        scope.launch {
            runCatching { client.presets() }.onSuccess { presets ->
                if (runtimes[runtime.profile.id] !== runtime) return@onSuccess
                runtime.presets = presets
                sync()
            }
        }
    }

    private fun handleEvent(runtime: Runtime, event: SseEvent) {
        try {
            when (event.name) {
                "hello" -> {
                    runtime.connection = ConnectionState.Connected
                    runtime.error = null
                    sync()
                }
                "session.snapshot" -> {
                    val envelope = JsonConfig.json.decodeFromString(SnapshotEnvelope.serializer(), event.data)
                    if (runtime.activeSessionId != envelope.sessionId) return
                    runtime.timeline = envelope.records
                    runtime.streamText = ""
                    envelope.records.lastOrNull { it.kind == "assistant" }?.text?.let {
                        runtime.assistantTexts[envelope.sessionId] = it.take(4_000)
                    }
                    sync()
                }
                "session.event" -> {
                    val envelope = JsonConfig.json.decodeFromString(SessionEventEnvelope.serializer(), event.data)
                    val item = envelope.item ?: return
                    if (runtime.activeSessionId != envelope.sessionId) return
                    val timeline = if (timelineContains(runtime.timeline, item.seq)) {
                        runtime.timeline
                    } else {
                        runtime.timeline + item
                    }
                    val running = when {
                        item.kind == "turn" && item.phase == "start" -> true
                        item.kind == "turn" && item.phase == "end" -> false
                        else -> runtime.detail?.session?.running ?: false
                    }
                    if (item.kind == "assistant") {
                        item.text?.takeIf { it.isNotBlank() }?.let {
                            runtime.assistantTexts[envelope.sessionId] = it.take(4_000)
                        }
                    }
                    runtime.timeline = timeline
                    runtime.detail = runtime.detail?.let { detail ->
                        detail.copy(session = detail.session.copy(running = running))
                    }
                    if (item.kind == "turn" && item.phase == "end") runtime.streamText = ""
                    sync()
                }
                "assistant.delta" -> {
                    val envelope = JsonConfig.json.decodeFromString(DeltaEnvelope.serializer(), event.data)
                    val item = envelope.item ?: return
                    if (item.phase != "delta" || item.kind != "text") return
                    val text = item.text ?: return
                    if (runtime.activeSessionId != envelope.sessionId) return
                    runtime.streamText = (runtime.streamText + text).takeLast(12_000)
                    sync()
                }
                "session.added", "session.updated" -> {
                    val envelope = JsonConfig.json.decodeFromString(SessionEnvelope.serializer(), event.data)
                    runtime.sessions = upsertList(runtime.sessions, envelope.session)
                    runtime.detail = runtime.detail?.let {
                        if (it.session.id == envelope.session.id) it.copy(session = envelope.session) else it
                    }
                    sync()
                }
                "session.status" -> {
                    val envelope = JsonConfig.json.decodeFromString(StatusEnvelope.serializer(), event.data)
                    val replacement = envelope.session
                    runtime.sessions = if (replacement != null) {
                        upsertList(runtime.sessions, replacement)
                    } else {
                        runtime.sessions.map {
                            if (it.id == envelope.sessionId) it.copy(running = envelope.running) else it
                        }
                    }
                    runtime.detail = runtime.detail?.let { current ->
                        if (current.session.id == envelope.sessionId) {
                            current.copy(session = current.session.copy(running = envelope.running))
                        } else {
                            current
                        }
                    }
                    if (!envelope.running && runtime.activeSessionId == envelope.sessionId) {
                        runtime.streamText = ""
                    }
                    sync()
                }
                "session.activity" -> {
                    val envelope = JsonConfig.json.decodeFromString(SessionIdEnvelope.serializer(), event.data)
                    runtime.sessions = sort(runtime.sessions.map {
                        if (it.id == envelope.sessionId) it.copy(updatedAt = envelope.updatedAt) else it
                    })
                    sync()
                }
                "session.removed" -> {
                    val envelope = JsonConfig.json.decodeFromString(SessionIdEnvelope.serializer(), event.data)
                    runtime.sessions = runtime.sessions.filterNot { it.id == envelope.sessionId }
                    if (runtime.activeSessionId == envelope.sessionId) {
                        runtime.activeSessionId = null
                        runtime.pendingOpenSessionId = null
                        runtime.detail = null
                        runtime.timeline = emptyList()
                        runtime.streamText = ""
                    }
                    runtime.assistantTexts.remove(envelope.sessionId)
                    sync()
                }
                "session.error" -> {
                    val envelope = JsonConfig.json.decodeFromString(SessionIdEnvelope.serializer(), event.data)
                    runtime.error = envelope.message
                    sync()
                }
                "approval.requested" -> {
                    val approval = JsonConfig.json.decodeFromString(PendingApproval.serializer(), event.data)
                    runtime.pending = runtime.pending.copy(
                        approvals = upsertApproval(runtime.pending.approvals, approval)
                    )
                    sync()
                }
                "question.requested" -> {
                    val question = JsonConfig.json.decodeFromString(PendingQuestion.serializer(), event.data)
                    runtime.pending = runtime.pending.copy(
                        questions = upsertQuestion(runtime.pending.questions, question)
                    )
                    sync()
                }
                "approval.closed" -> {
                    val envelope = JsonConfig.json.decodeFromString(ClosedEnvelope.serializer(), event.data)
                    removeApproval(runtime, envelope.id)
                }
                "question.closed" -> {
                    val envelope = JsonConfig.json.decodeFromString(ClosedEnvelope.serializer(), event.data)
                    removeQuestion(runtime, envelope.id)
                }
            }
        } catch (_: Throwable) {
            // Ignore unknown or malformed events; the stream keeps running.
        }
    }

    private fun removeApproval(runtime: Runtime, id: String) {
        runtime.pending = runtime.pending.copy(
            approvals = runtime.pending.approvals.filterNot { it.id == id }
        )
        sync()
    }

    private fun removeQuestion(runtime: Runtime, id: String) {
        runtime.pending = runtime.pending.copy(
            questions = runtime.pending.questions.filterNot { it.id == id }
        )
        sync()
    }

    private fun mergePending(current: PendingState, incoming: PendingState): PendingState = PendingState(
        approvals = (current.approvals + incoming.approvals).distinctBy { it.id },
        questions = (current.questions + incoming.questions).distinctBy { it.id }
    )

    private fun persist() {
        HostStore.save(appContext, runtimes.values.map { it.profile })
    }

    private fun sync() {
        if (activeId == null || !runtimes.containsKey(activeId)) {
            activeId = runtimes.keys.lastOrNull()
        }
        val active = activeRuntime()
        val hosts = runtimes.values.map { runtime ->
            HostSummary(
                id = runtime.profile.id,
                label = runtime.label,
                baseUrl = runtime.profile.baseUrl,
                deviceId = runtime.profile.deviceId,
                hostName = runtime.info?.bridge?.hostName ?: runtime.profile.hostName,
                connection = runtime.connection,
                endpointKind = runtime.endpointKind,
                endpoints = runtime.profile.endpoints,
                pendingCount = runtime.pendingCount,
                runningCount = runtime.sessions.count { it.running },
                active = runtime.profile.id == activeId,
                error = runtime.error
            )
        }
        val pendingHosts = runtimes.values
            .filter { it.pendingCount > 0 }
            .map { runtime ->
                HostPending(
                    id = runtime.profile.id,
                    label = runtime.label,
                    hostName = runtime.info?.bridge?.hostName ?: runtime.profile.hostName,
                    connection = runtime.connection,
                    pending = runtime.pending
                )
            }

        _state.value = AppState(
            connection = active?.connection ?: ConnectionState.Disconnected,
            endpointKind = active?.endpointKind,
            baseUrl = active?.profile?.baseUrl.orEmpty(),
            info = active?.info,
            sessions = active?.sessions.orEmpty(),
            activeSessionId = active?.activeSessionId,
            detail = active?.detail,
            timeline = active?.timeline.orEmpty(),
            streamText = active?.streamText.orEmpty(),
            pending = active?.pending ?: PendingState(),
            workspaces = active?.workspaces.orEmpty(),
            presets = active?.presets ?: PresetCatalog(),
            busy = active?.busy ?: false,
            error = active?.error,
            notice = active?.notice,
            restored = started,
            hosts = hosts,
            pendingHosts = pendingHosts
        )

        _hostSnapshots.value = runtimes.values.map { runtime ->
            HostSnapshot(
                id = runtime.profile.id,
                label = runtime.label,
                hostName = runtime.info?.bridge?.hostName ?: runtime.profile.hostName,
                connection = runtime.connection,
                sessions = runtime.sessions,
                pending = runtime.pending,
                assistantTexts = runtime.assistantTexts.toMap()
            )
        }

        if (_pendingHosts.value != pendingHosts) _pendingHosts.value = pendingHosts
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
