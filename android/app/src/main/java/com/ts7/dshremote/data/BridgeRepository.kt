package com.ts7.dshremote.data

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Build
import android.util.LruCache
import com.ts7.dshremote.BuildConfig
import java.io.IOException
import java.util.UUID
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
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
    companion object {
        /** 会话目录兜底工作区的 id 前缀；创建任务时拆出来走 cwd 参数。 */
        const val CWD_PREFIX = "cwd:"

        /** 流式事件合并节拍：60ms 约等于 16fps，肉眼看是连续的，重组次数降一个量级。 */
        private const val SYNC_COALESCE_MS = 60L

        /** 打开会话后顺手刷列表的新鲜度阈值，避免每次点开会话都多跑两个请求。 */
        private const val SESSION_REFRESH_FRESH_MS = 3_000L

        /** 连上 tailnet 后隔一会儿再探局域网：太早会和首次连接的探测抢同一条链路。 */
        private const val LAN_PROBE_DELAY_MS = 1_500L
    }

    private val appContext = context.applicationContext
    private val prefs = appContext.getSharedPreferences(HostStore.PREFS, Context.MODE_PRIVATE)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val _state = MutableStateFlow(AppState())
    val state: StateFlow<AppState> = _state.asStateFlow()

    private val _hostSnapshots = MutableStateFlow<List<HostSnapshot>>(emptyList())
    val hosts: StateFlow<List<HostSnapshot>> = _hostSnapshots.asStateFlow()

    private val _pendingHosts = MutableStateFlow<List<HostPending>>(emptyList())
    val pendingHosts: StateFlow<List<HostPending>> = _pendingHosts.asStateFlow()

    /** Turn-finished / turn-failed notices pushed by the host, for the foreground service. */
    private val _turnNotices = MutableSharedFlow<TurnNotice>(
        extraBufferCapacity = 32,
        onBufferOverflow = BufferOverflow.DROP_OLDEST
    )
    val turnNotices: SharedFlow<TurnNotice> = _turnNotices.asSharedFlow()

    private class Runtime(var profile: PairedHost) {
        var connection: ConnectionState = ConnectionState.Disconnected
        var endpointKind: String? = null
        var info: BridgeInfo? = null
        var client: BridgeClient? = null
        var connectJob: Job? = null
        var eventJob: Job? = null
        var lanProbeJob: Job? = null
        var sessions: List<SessionSummary> = emptyList()
        var pending: PendingState = PendingState()
        var workspaces: List<Workspace> = emptyList()

        /** 桌面端设置的默认工作区目录；为 null 表示手机端不能新建工作区文件夹。 */
        var workspaceRoot: String? = null
        var presets: PresetCatalog = PresetCatalog()
        var catalogLoading: Boolean = false
        var catalogError: String? = null
        var activeSessionId: String? = null
        var pendingOpenSessionId: String? = null
        var detail: SessionDetail? = null

        /** 上一次真正从 host 拉到的详情，重进会话时先拿它铺屏。 */
        var lastDetail: SessionDetail? = null
        var timeline: List<TimelineItem> = emptyList()
        var streamText: String = ""
        var busy: Boolean = false
        var error: String? = null
        var notice: String? = null
        var assistantTexts: MutableMap<String, String> = mutableMapOf()
        var eventFailures: Int = 0
        var sessionsRefreshing: Boolean = false
        var pendingRefreshing: Boolean = false

        /** 这台主机所在绑定组的状态，断连时保留上一次结果。 */
        var group: GroupInfo? = null

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

    /** 版本检查只跟这台手机有关，不挂在任何一台 PC 的 runtime 上。 */
    private var update: AppUpdate? = null
    private var updateChecking = false
    private var updateJob: Job? = null

    /**
     * 流式事件（assistant.delta / session.event）一秒能来几十上百条，每条都重建一整个
     * AppState 会把整屏重组的代价乘上事件数。合并成一个 60ms 的节拍再推给 UI。
     */
    private var syncSoonJob: Job? = null
    private val syncGuard = Any()

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
        // 启动时只在距上次检查超过 6 小时才查一次，避免每次冷启动都打 GitHub。
        if (UpdateChecker.shouldAutoCheck(appContext)) checkUpdate()
    }

    /** 查 GitHub 上有没有新版本；只提示，不自动下载安装。 */
    fun checkUpdate() {
        if (updateJob?.isActive == true) return
        updateChecking = true
        sync()
        updateJob = scope.launch {
            val result = UpdateChecker.check(appContext, BuildConfig.VERSION_NAME)
            update = result
            updateChecking = false
            sync()
        }
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
        val best = pickReachable(runtime, preferLan = true) ?: return
        if (normalizeBaseUrl(best.url) != normalizeBaseUrl(runtime.profile.baseUrl) ||
            runtime.connection != ConnectionState.Connected
        ) {
            if (best.kind == Endpoints.LAN) promoteLan(runtime, best)
            restart(runtime)
        }
    }

    /**
     * Put [endpoint] and every other LAN address in front of the stored order
     * and keep it that way, so later cold starts dial the LAN first too.
     */
    private fun promoteLan(runtime: Runtime, endpoint: BridgeEndpoint) {
        val ordered = Endpoints.merge(
            baseUrl = endpoint.url,
            existing = runtime.profile.endpoints,
            incoming = emptyList(),
            sort = true
        )
        if (ordered == runtime.profile.endpoints) return
        runtime.profile = runtime.profile.copy(endpoints = ordered)
        persist()
    }

    /**
     * A host that was paired over Tailscale stores its tailnet address first,
     * so every reconnect lands on the tailnet even when the phone is sitting on
     * the same LAN as the desktop. Once such a connection is up, give the LAN
     * one chance in the background and switch over if it answers; a LAN that
     * never answers (a NAT'd VM, a phone on mobile data) costs one probe and
     * nothing else, because the switch only happens on success.
     */
    private fun probeLanUpgrade(runtime: Runtime) {
        val lan = runtime.profile.candidates.filter { it.kind == Endpoints.LAN }
        if (lan.isEmpty()) return
        runtime.lanProbeJob?.cancel()
        runtime.lanProbeJob = scope.launch {
            delay(LAN_PROBE_DELAY_MS)
            // 首次连接后面还跟着一轮刷新，重启会把它们打断；等这轮跑完再探。
            if (runtime.connectJob?.isActive == true) delay(LAN_PROBE_DELAY_MS)
            if (runtimes[runtime.profile.id] !== runtime) return@launch
            if (runtime.connection != ConnectionState.Connected) return@launch
            if (runtime.endpointKind == Endpoints.LAN) return@launch
            val token = runtime.profile.token
            val hit = lan.firstOrNull { endpoint ->
                try {
                    matches(runtime, clientFor(endpoint, token, probeTimeout(endpoint.kind)).info())
                } catch (_: Throwable) {
                    false
                }
            } ?: return@launch
            runtime.lanProbeJob = null
            promoteLan(runtime, hit)
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
            val (host, port) = Endpoints.target(endpoint.url) ?: error("Tailscale 地址无效")
            val local = tailscale.proxyFor(host, port)
                ?: throw IOException("内嵌 Tailscale 正在连接")
            return BridgeClient("http://127.0.0.1:$local", token, timeoutMs)
        }
        return BridgeClient(endpoint.url, token, timeoutMs)
    }

    /**
     * Resolve a tailnet target to the embedded node's loopback proxy.
     *
     * The embedded node is a userspace tailnet: it never installs a VPN route,
     * so dialing a 100.x address directly leaves on the Wi-Fi interface and
     * times out. Pairing has to take this same hop as every later RPC.
     */
    private fun tailnetDialUrl(rawUrl: String): String {
        val state = tailscale.state.value
        if (!state.enabled) {
            throw IOException("内嵌 Tailscale 未启用：先到 设置 → 内嵌 Tailscale 打开，再配对")
        }
        if (state.phase != EmbeddedTailscale.Phase.Connected) {
            throw IOException(
                when (state.phase) {
                    EmbeddedTailscale.Phase.Starting -> "内嵌 Tailscale 正在连接，请稍候重试"
                    EmbeddedTailscale.Phase.NeedsLogin -> "内嵌 Tailscale 需要登录 tailnet，请到设置里完成登录"
                    EmbeddedTailscale.Phase.Error -> state.error?.takeIf { it.isNotBlank() } ?: "内嵌 Tailscale 启动失败"
                    else -> "内嵌 Tailscale 未就绪"
                }
            )
        }
        val (host, port) = Endpoints.target(rawUrl) ?: throw IOException("Tailscale 地址无效")
        val local = tailscale.proxyFor(host, port)
            ?: throw IOException("内嵌 Tailscale 本地代理启动失败")
        return "http://127.0.0.1:$local"
    }

    /** Turn a raw pairing failure into something that names the likely cause. */
    private fun pairFailureMessage(failure: Throwable, base: String, useTailscale: Boolean): String {
        val message = failure.message?.takeIf { it.isNotBlank() } ?: "配对失败"
        if (useTailscale || Endpoints.kindOf(base) != Endpoints.TAILSCALE) return message
        return if (tailscale.state.value.enabled) {
            "$message（这是 tailnet 地址：打开“通过 Tailscale 连接”再试）"
        } else {
            "$message（这是 tailnet 地址：打开“通过 Tailscale 连接”，或先启用内嵌 Tailscale）"
        }
    }

    private fun matches(runtime: Runtime, info: BridgeInfo): Boolean {
        val expected = runtime.profile.deviceId?.takeIf { it.isNotBlank() } ?: return true
        val reported = info.bridge?.deviceId?.takeIf { it.isNotBlank() } ?: return true
        return expected == reported
    }

    private suspend fun pickReachable(runtime: Runtime, preferLan: Boolean = false): BridgeEndpoint? {
        val token = runtime.profile.token
        val order = runtime.profile.candidates
        for (endpoint in if (preferLan) Endpoints.preferLan(order) else order) {
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
                incoming = listOf(BridgeEndpoint(kind = Endpoints.kindOf(normalized), url = normalized)),
                sort = false
            )
        )
        persist()
        restart(runtime)
        sync()
    }

    private fun refreshCatalogInternal(runtime: Runtime) {
        refreshWorkspaces(runtime)
        refreshPresets(runtime)
    }

    fun refreshCatalog() {
        val runtime = activeRuntime() ?: return
        refreshCatalogInternal(runtime)
    }

    /**
     * Pairs a desktop.
     *
     * [useTailscale] says the address is only reachable over the tailnet (a
     * 100.x node, a MagicDNS name, or a host that forwards into a NAT VM). The
     * dial then goes through the embedded node's loopback proxy, while the
     * saved address stays the real one so later route probing keeps working.
     */
    suspend fun pair(
        baseUrl: String,
        code: String,
        knownHostName: String? = null,
        knownDeviceId: String? = null,
        useTailscale: Boolean = false
    ): Result<Unit> = runCatching {
        val base = normalizeBaseUrl(baseUrl)
        val dialUrl = if (useTailscale) tailnetDialUrl(base) else base
        val result = try {
            BridgeClient.pair(
                rawBaseUrl = dialUrl,
                code = code,
                installId = installId,
                deviceName = Build.MODEL ?: "Android",
                model = Build.MODEL ?: "Android",
                appVersion = BuildConfig.VERSION_NAME
            )
        } catch (failure: Throwable) {
            throw IOException(pairFailureMessage(failure, base, useTailscale), failure)
        }
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
        val endpoints = Endpoints.withKind(
            Endpoints.merge(
                baseUrl = base,
                existing = existing?.profile?.endpoints.orEmpty(),
                incoming = result.host?.endpoints.orEmpty() + BridgeEndpoint(kind = Endpoints.kindOf(base), url = base)
            ),
            base,
            if (useTailscale) Endpoints.TAILSCALE else Endpoints.kindOf(base),
            first = useTailscale
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
                    // Picking an address from the discovered list is an explicit
                    // transport choice: it leads the probe order instead of being
                    // re-sorted behind a LAN address that may not be routable.
                    endpoints = Endpoints.withKind(
                        Endpoints.merge(
                            baseUrl = normalized,
                            existing = runtime.profile.endpoints,
                            incoming = listOf(BridgeEndpoint(kind = Endpoints.kindOf(normalized), url = normalized)),
                            sort = false
                        ),
                        normalized,
                        Endpoints.kindOf(normalized),
                        first = true
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
        if (runtime.sessionsRefreshing) return
        runtime.sessionsRefreshing = true
        scope.launch {
            try {
                runCatching { client.sessions() }.onSuccess { sessions ->
                    if (runtimes[runtime.profile.id] !== runtime) return@onSuccess
                    val next = sort(sessions)
                    // 结构相等就不推新列表，省掉整页工作区分组的重算。
                    if (next == runtime.sessions) return@onSuccess
                    runtime.sessions = next
                    sync()
                }
            } finally {
                runtime.sessionsRefreshing = false
            }
        }
    }

    fun refreshPending(hostId: String? = activeId) {
        val runtime = hostId?.let { runtimes[it] } ?: return
        val client = runtime.client ?: return
        if (runtime.pendingRefreshing) return
        runtime.pendingRefreshing = true
        scope.launch {
            try {
                runCatching { client.pending() }.onSuccess { pending ->
                    if (runtimes[runtime.profile.id] !== runtime) return@onSuccess
                    if (pending == runtime.pending) return@onSuccess
                    runtime.pending = pending
                    sync()
                }
            } finally {
                runtime.pendingRefreshing = false
            }
        }
    }

    /**
     * Cheap reconciliation used by the foreground service with the screen off:
     * a lost SSE frame leaves running flags or the pending queue stale, and only
     * the host knows the truth. Pending is included on every pass because an
     * approval that goes unnoticed simply times out on the desktop.
     */
    fun reconcile() {
        if (!started) return
        for (runtime in runtimes.values.toList()) {
            if (runtime.connection != ConnectionState.Connected) continue
            refreshSessions(runtime.profile.id)
            refreshPending(runtime.profile.id)
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
        runtime.lanProbeJob?.cancel()
        runtime.connectJob = null
        runtime.eventJob = null
        runtime.lanProbeJob = null
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
        runtime.eventFailures = 0
        runtime.info = info
        runtime.connection = ConnectionState.Connected
        runtime.endpointKind = opened.endpoint.kind
        runtime.error = null

        val bridge = info.bridge
        runtime.workspaceRoot = bridge?.workspaceRoot?.takeIf { it.isNotBlank() } ?: runtime.workspaceRoot
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
                incoming = bridge?.endpoints.orEmpty(),
                sort = false
            )
        )
        persist()
        sync()

        if (opened.endpoint.kind != Endpoints.LAN) probeLanUpgrade(runtime)

        refreshSessions(runtime.profile.id)
        refreshWorkspaces(runtime)
        refreshPresets(runtime)
        refreshPending(runtime.profile.id)
        refreshGroup(runtime.profile.id)

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
                if (failure is ApiException && failure.status == 401) {
                    runtime.connection = ConnectionState.Error
                    runtime.error = failure.message
                    sync()
                    break
                }
                runtime.eventFailures += 1
                // Dropped streams are routine on mobile networks (NAT rebinding,
                // screen-off power saving). Retry the same endpoint twice before
                // paying for a full LAN/Tailscale route probe, so a single blip
                // does not flash the UI to "连接中" or fire connection alerts.
                if (runtime.eventFailures <= 2) {
                    delay(1_000)
                    continue
                }
                // The route may have changed (Wi-Fi -> cellular). Do not retry the
                // stale client forever: probe LAN/Tailscale again and reconnect.
                runtime.connection = ConnectionState.Connecting
                runtime.error = failure?.message?.takeIf { it.isNotBlank() }
                runtime.client = null
                sync()
                val wait = minOf(30_000L, 2_000L * (1 shl minOf(runtime.eventFailures - 3, 4)))
                scope.launch {
                    delay(wait)
                    if (runtimes[runtime.profile.id] === runtime) restart(runtime)
                }
                return@launch
            }
        }
    }

    private fun openSessionInternal(runtime: Runtime, id: String) {
        if (runtime.activeSessionId == id && (runtime.busy || runtime.detail != null)) return
        runtime.activeSessionId = id
        // 回到刚看过的会话时先用上次的详情铺屏，再让请求把内容补齐，
        // 避免每次点开都先空一屏等网络。
        val cached = runtime.lastDetail?.takeIf { it.session.id == id }
        runtime.detail = cached
        runtime.timeline = cached?.records.orEmpty()
        runtime.streamText = ""
        runtime.busy = cached == null
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
                // subscribe 只是让 host 开始跟随这个会话，失败不该挡住历史加载，
                // 所以和 session() 并行发出去。
                coroutineScope {
                    launch { runCatching { client.subscribe(id) } }
                    client.session(id)
                }
            }.onSuccess { detail ->
                if (runtime.activeSessionId != id) return@onSuccess
                runtime.detail = detail
                runtime.lastDetail = detail
                runtime.timeline = detail.records
                runtime.pending = mergePending(runtime.pending, detail.pending)
                runtime.busy = false
                detail.records.lastOrNull { it.kind == "assistant" }?.text?.let {
                    runtime.assistantTexts[id] = it.take(4_000)
                }
                sync()
                // 打开会话时不再无条件补两个请求：摘要已在列表里且不比 detail 旧就跳过，
                // 待办队列只在本地还留着旧卡片时才对齐一次。
                val summary = runtime.sessions.firstOrNull { it.id == id }
                if (summary == null || (detail.session.updatedAt ?: 0L) > (summary.updatedAt ?: 0L)) {
                    refreshSessions(runtime.profile.id)
                }
                if (runtime.pendingCount > 0) refreshPending(runtime.profile.id)
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
        runtime.catalogLoading = true
        runtime.catalogError = null
        sync()
        scope.launch {
            val result = runCatching { client.workspaces() }
            if (runtimes[runtime.profile.id] !== runtime) return@launch
            result
                .onSuccess { catalog ->
                    runtime.workspaceRoot = catalog.root?.takeIf { it.isNotBlank() }
                    // 桌面端没有登记工作区时，用已知会话的目录兜底，
                    // 避免任务页一行都选不了。
                    runtime.workspaces = catalog.workspaces.ifEmpty { workspacesFromSessions(runtime.sessions) }
                    runtime.catalogError = null
                }
                .onFailure { error ->
                    runtime.workspaces = workspacesFromSessions(runtime.sessions)
                    runtime.catalogError = error.message?.takeIf { it.isNotBlank() } ?: "无法读取桌面端工作区"
                }
            runtime.catalogLoading = false
            sync()
        }
    }

    /** 用会话目录拼出可选工作区，id 带 [CWD_PREFIX] 前缀，创建任务时改为直接传 cwd。 */
    private fun workspacesFromSessions(sessions: List<SessionSummary>): List<Workspace> =
        sessions
            .mapNotNull { it.cwd?.takeIf { cwd -> cwd.isNotBlank() } }
            .distinct()
            .map { cwd -> Workspace(id = CWD_PREFIX + cwd, path = cwd) }

    /**
     * 在主机设置的默认工作区目录下建一个新文件夹并登记成工作区。
     * 主机没配默认目录时这里会直接失败，错误文案由主机给出。
     */
    suspend fun createWorkspace(name: String): Result<Workspace> {
        val trimmed = name.trim()
        if (trimmed.isEmpty()) return Result.failure(IOException("先给文件夹起个名字"))
        val runtime = activeRuntime() ?: return Result.failure(IOException("还没有连接主机"))
        val client = runtime.client ?: return Result.failure(IOException("连接已断开，稍后重试"))
        return runCatching { client.createWorkspace(trimmed) }
            .onSuccess { workspace ->
                runtime.workspaces = (listOf(workspace) + runtime.workspaces.filter { it.id != workspace.id })
                refreshWorkspaces(runtime)
            }
    }

    /** 历史图片的内存缓存：一张聊天截图几百 KB，24 MB 够翻几十屏。 */
    private val imageCache = object : LruCache<String, ByteArray>(24 * 1024 * 1024) {
        override fun sizeOf(key: String, value: ByteArray): Int = value.size
    }

    /** 取一条消息里第 [index] 张图片的原始字节；同一张图重复显示只下载一次。 */
    suspend fun imageBytes(sessionId: String, seq: Long, index: Int): ByteArray {
        val key = "$sessionId|$seq|$index"
        imageCache.get(key)?.let { return it }
        val runtime = activeRuntime() ?: throw IOException("还没有连接主机")
        val client = runtime.client ?: throw IOException("连接已断开，稍后重试")
        val bytes = client.imageBytes(sessionId, seq, index)
        imageCache.put(key, bytes)
        return bytes
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

    /** 拉这台主机的绑定组状态；失败时保留上一次结果。 */
    fun refreshGroup(hostId: String? = activeId) {
        val runtime = hostId?.let { runtimes[it] } ?: return
        val client = runtime.client ?: return
        scope.launch {
            runCatching { client.group() }.onSuccess { group ->
                if (runtimes[runtime.profile.id] !== runtime) return@onSuccess
                if (runtime.group != group) {
                    runtime.group = group
                    sync()
                }
            }
        }
    }

    /**
     * 把同一部手机绑定过的其它主机全部拉进当前主机所在的绑定组：
     * 先向当前主机要一次性邀请码，再让每台其它主机带着这个码加入当前主机。
     * 返回 null 表示成功，否则是给用户看的错误文案。
     */
    suspend fun linkGroup(): String? {
        val hub = activeRuntime() ?: return "还没有连上任何主机"
        val hubClient = hub.client ?: return "当前主机未连接"
        val invite = runCatching { hubClient.groupInvite() }
            .getOrElse { error ->
                return error.message?.takeIf { it.isNotBlank() } ?: "无法创建绑定组"
            }
        val code = invite.invite?.code
        if (code.isNullOrBlank()) return "邀请码生成失败，请稍后重试"
        invite.group?.let { hub.group = hub.group?.copy(group = it) ?: GroupInfo(group = it) }

        val targets = runtimes.values.filter { it.profile.id != hub.profile.id }
        if (targets.isEmpty()) {
            refreshGroup(hub.profile.id)
            sync()
            return "只有一台已配对主机，先把其它电脑也配对到这个手机"
        }
        var joined = 0
        var firstFailure: String? = null
        for (runtime in targets) {
            val profile = runtime.profile
            val outcome = runCatching {
                // 走这条主机自己的端点口径（tailnet 地址经内嵌节点回环代理），
                // selfBaseUrl 交给对端自己填局域网地址：手机保存的地址可能是
                // 127.0.0.1 的代理端口，别的电脑连不上。
                val endpoint = BridgeEndpoint(kind = runtime.endpointKind ?: Endpoints.LAN, url = profile.baseUrl)
                clientFor(endpoint, profile.token, timeoutMs = 20_000L).groupLink(
                    peerBaseUrl = hub.profile.baseUrl,
                    code = code,
                    selfBaseUrl = null
                )
            }
            outcome.onSuccess { info ->
                runtime.group = info
                joined += 1
            }
            outcome.onFailure { error ->
                if (firstFailure == null) {
                    val label = profile.hostName?.takeIf { it.isNotBlank() } ?: profile.baseUrl
                    firstFailure = "$label 加入失败：${error.message?.takeIf { it.isNotBlank() } ?: "网络不可达"}"
                }
            }
        }
        refreshGroup(hub.profile.id)
        sync()
        val failure = firstFailure
        return when {
            joined == 0 -> failure ?: "没有主机加入成功"
            failure != null -> "已加入 $joined 台，$failure"
            else -> null
        }
    }

    private fun handleEvent(runtime: Runtime, event: SseEvent) {
        try {
            when (event.name) {
                "hello" -> {
                    val recovered = runtime.eventFailures > 0
                    runtime.connection = ConnectionState.Connected
                    runtime.error = null
                    runtime.eventFailures = 0
                    sync()
                    // A re-attached stream may have missed status frames, so pull
                    // the authoritative running flags and pending queue once.
                    if (recovered) {
                        refreshSessions(runtime.profile.id)
                        refreshPending(runtime.profile.id)
                        if (runtime.workspaces.isEmpty()) refreshCatalogInternal(runtime)
                    }
                }
                "session.snapshot" -> {
                    val envelope = JsonConfig.json.decodeFromString(SnapshotEnvelope.serializer(), event.data)
                    if (runtime.activeSessionId != envelope.sessionId) return
                    runtime.timeline = envelope.records
                    runtime.streamText = ""
                    envelope.records.lastOrNull { it.kind == "assistant" }?.text?.let {
                        runtime.assistantTexts[envelope.sessionId] = it.take(4_000)
                    }
                    syncSoon()
                }
                "session.event" -> {
                    val envelope = JsonConfig.json.decodeFromString(SessionEventEnvelope.serializer(), event.data)
                    val item = envelope.item ?: return
                    // Record assistant text for every followed session, not only the
                    // open one: the foreground service needs it for completion
                    // notifications while the phone is locked.
                    if (item.kind == "assistant") {
                        item.text?.takeIf { it.isNotBlank() }?.let {
                            runtime.assistantTexts[envelope.sessionId] = it.take(4_000)
                        }
                    }
                    if (runtime.activeSessionId != envelope.sessionId) {
                        syncSoon()
                        return
                    }
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
                    runtime.timeline = timeline
                    runtime.detail = runtime.detail?.let { detail ->
                        detail.copy(session = detail.session.copy(running = running))
                    }
                    if (item.kind == "turn" && item.phase == "end") runtime.streamText = ""
                    syncSoon()
                }
                "assistant.delta" -> {
                    val envelope = JsonConfig.json.decodeFromString(DeltaEnvelope.serializer(), event.data)
                    val item = envelope.item ?: return
                    if (item.phase != "delta" || item.kind != "text") return
                    val text = item.text ?: return
                    if (runtime.activeSessionId != envelope.sessionId) return
                    runtime.streamText = (runtime.streamText + text).takeLast(12_000)
                    syncSoon()
                }
                "session.added", "session.updated" -> {
                    val envelope = JsonConfig.json.decodeFromString(SessionEnvelope.serializer(), event.data)
                    runtime.sessions = upsertList(runtime.sessions, envelope.session)
                    runtime.detail = runtime.detail?.let {
                        if (it.session.id == envelope.session.id) it.copy(session = envelope.session) else it
                    }
                    syncSoon()
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
                    syncSoon()
                }
                "session.activity" -> {
                    val envelope = JsonConfig.json.decodeFromString(SessionIdEnvelope.serializer(), event.data)
                    runtime.sessions = sort(runtime.sessions.map {
                        if (it.id == envelope.sessionId) it.copy(updatedAt = envelope.updatedAt) else it
                    })
                    syncSoon()
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
                "notice" -> {
                    val envelope = JsonConfig.json.decodeFromString(NoticeEnvelope.serializer(), event.data)
                    val sessionId = envelope.sessionId ?: return
                    val kind = envelope.kind ?: return
                    if (kind != "turn-end" && kind != "turn-error") return
                    if (kind == "turn-end") {
                        envelope.text?.takeIf { it.isNotBlank() }?.let {
                            runtime.assistantTexts[sessionId] = it.take(4_000)
                        }
                    }
                    _turnNotices.tryEmit(
                        TurnNotice(
                            hostId = runtime.profile.id,
                            hostLabel = runtime.label,
                            kind = kind,
                            sessionId = sessionId,
                            title = envelope.title.orEmpty(),
                            text = envelope.text.orEmpty(),
                            reason = envelope.reason,
                            durationMs = envelope.durationMs
                        )
                    )
                    sync()
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

    /**
     * 高频事件用的合并刷新：同一节拍里只建一次 AppState。
     *
     * 结构化变化（切换会话、连接状态、待办卡片）仍然走 [sync] 立即上屏，
     * 只有逐条吐字的流式帧和会话列表刷新走这里。
     */
    private fun syncSoon() {
        synchronized(syncGuard) {
            if (syncSoonJob?.isActive == true) return
            syncSoonJob = scope.launch {
                delay(SYNC_COALESCE_MS)
                sync()
            }
        }
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
            workspaceRoot = active?.workspaceRoot,
            presets = active?.presets ?: PresetCatalog(),
            catalogLoading = active?.catalogLoading ?: false,
            catalogError = active?.catalogError,
            busy = active?.busy ?: false,
            error = active?.error,
            notice = active?.notice,
            restored = started,
            group = active?.group,
            hosts = hosts,
            pendingHosts = pendingHosts,
            update = update,
            updateChecking = updateChecking
        )

        _hostSnapshots.value = runtimes.values.map { runtime ->
            HostSnapshot(
                id = runtime.profile.id,
                label = runtime.label,
                hostName = runtime.info?.bridge?.hostName ?: runtime.profile.hostName,
                connection = runtime.connection,
                sessions = runtime.sessions,
                pending = runtime.pending,
                error = runtime.error,
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
