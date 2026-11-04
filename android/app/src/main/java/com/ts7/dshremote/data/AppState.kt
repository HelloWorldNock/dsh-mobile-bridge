package com.ts7.dshremote.data

/** Lightweight per-host row used by host pickers and settings. */
data class HostSummary(
    val id: String,
    val label: String,
    val baseUrl: String,
    val deviceId: String? = null,
    val hostName: String? = null,
    val connection: ConnectionState = ConnectionState.Disconnected,
    val endpointKind: String? = null,
    val endpoints: List<BridgeEndpoint> = emptyList(),
    val pendingCount: Int = 0,
    val runningCount: Int = 0,
    val active: Boolean = false,
    val error: String? = null
) {
    val connected: Boolean get() = connection == ConnectionState.Connected
    val routeLabel: String get() = Endpoints.label(endpointKind)
}

/** Background notification view of one host. */
data class HostSnapshot(
    val id: String,
    val label: String,
    val hostName: String? = null,
    val connection: ConnectionState = ConnectionState.Disconnected,
    val sessions: List<SessionSummary> = emptyList(),
    val pending: PendingState = PendingState(),
    val assistantTexts: Map<String, String> = emptyMap()
)

/** The pending queue of one host, shown together on the approvals screen. */
data class HostPending(
    val id: String,
    val label: String,
    val hostName: String? = null,
    val connection: ConnectionState = ConnectionState.Disconnected,
    val pending: PendingState = PendingState()
) {
    val pendingCount: Int get() = pending.approvals.size + pending.questions.size
}

data class AppState(
    val connection: ConnectionState = ConnectionState.Disconnected,
    val endpointKind: String? = null,
    val baseUrl: String = "",
    val info: BridgeInfo? = null,
    val sessions: List<SessionSummary> = emptyList(),
    val activeSessionId: String? = null,
    val detail: SessionDetail? = null,
    val timeline: List<TimelineItem> = emptyList(),
    val streamText: String = "",
    val pending: PendingState = PendingState(),
    val workspaces: List<Workspace> = emptyList(),
    val presets: PresetCatalog = PresetCatalog(),
    val catalogLoading: Boolean = false,
    val catalogError: String? = null,
    val busy: Boolean = false,
    val error: String? = null,
    val notice: String? = null,
    val restored: Boolean = false,
    val group: GroupInfo? = null,
    val hosts: List<HostSummary> = emptyList(),
    val pendingHosts: List<HostPending> = emptyList(),
    val update: AppUpdate? = null,
    val updateChecking: Boolean = false
) {
    val connected: Boolean get() = connection == ConnectionState.Connected
    val activeSession: SessionSummary? get() = sessions.firstOrNull { it.id == activeSessionId } ?: detail?.session
    val activeHost: HostSummary? get() = hosts.firstOrNull { it.active }
    val hostLabel: String
        get() = activeHost?.label ?: info?.bridge?.hostName ?: baseUrl.ifBlank { "未配对" }
    val routeLabel: String get() = Endpoints.label(endpointKind)
    val pendingCount: Int get() = pending.approvals.size + pending.questions.size
    val totalPendingCount: Int get() = if (hosts.isEmpty()) pendingCount else hosts.sumOf { it.pendingCount }
    val otherPendingCount: Int get() = (totalPendingCount - pendingCount).coerceAtLeast(0)
    val otherHostCount: Int get() = (hosts.size - 1).coerceAtLeast(0)
    val connectedHostCount: Int get() = hosts.count { it.connected }
}
