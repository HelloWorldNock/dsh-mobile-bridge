package com.ts7.dshremote.data

data class AppState(
    val connection: ConnectionState = ConnectionState.Disconnected,
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
    val busy: Boolean = false,
    val error: String? = null,
    val notice: String? = null,
    val restored: Boolean = false
) {
    val connected: Boolean get() = connection == ConnectionState.Connected
    val activeSession: SessionSummary? get() = sessions.firstOrNull { it.id == activeSessionId } ?: detail?.session
    val pendingCount: Int get() = pending.approvals.size + pending.questions.size
}
