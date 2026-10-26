package com.ts7.dshremote.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class PlanState(
    val active: Boolean = false,
    val pending: Boolean = false
)

@Serializable
data class SessionSummary(
    val id: String,
    val title: String? = null,
    val cwd: String? = null,
    val updatedAt: Long? = null,
    val running: Boolean = false,
    val blank: Boolean = false,
    val agentAvailable: Boolean = false,
    val parentSessionId: String? = null,
    val origin: String? = null,
    val permission: String? = null,
    val plan: PlanState = PlanState()
)

@Serializable
data class SessionListResponse(
    val sessions: List<SessionSummary> = emptyList()
)

@Serializable
data class ToolPreview(
    val tool: String? = null,
    val preview: String? = null,
    val turn: Int? = null,
    val step: Int? = null
)

@Serializable
data class PendingApproval(
    val id: String,
    val sessionId: String? = null,
    val sessionTitle: String? = null,
    val toolName: String = "tool",
    val callId: String? = null,
    val reason: String? = null,
    val displayReason: String? = null,
    val preview: ToolPreview? = null,
    val createdAt: Long? = null,
    val expiresAt: Long? = null
)

@Serializable
data class QuestionOption(
    val label: String,
    val description: String? = null
)

@Serializable
data class QuestionIntent(
    val kind: String? = null,
    val approve: String? = null,
    val detail: String? = null
)

@Serializable
data class Question(
    val id: String,
    val question: String,
    val detail: String? = null,
    val header: String? = null,
    val options: List<QuestionOption> = emptyList(),
    val multiSelect: Boolean = false,
    val intent: QuestionIntent? = null
)

@Serializable
data class PendingQuestion(
    val id: String,
    val sessionId: String? = null,
    val sessionTitle: String? = null,
    val questions: List<Question> = emptyList(),
    val plan: String? = null,
    val planReview: Boolean = false,
    val createdAt: Long? = null,
    val expiresAt: Long? = null
)

@Serializable
data class PendingState(
    val approvals: List<PendingApproval> = emptyList(),
    val questions: List<PendingQuestion> = emptyList()
)

@Serializable
data class TimelineItem(
    val seq: Long = 0,
    val at: Long? = null,
    val type: String? = null,
    val kind: String? = null,
    val text: String? = null,
    val preview: String? = null,
    val name: String? = null,
    val callId: String? = null,
    val phase: String? = null,
    val turn: Int? = null,
    val step: Int? = null,
    val reason: String? = null,
    val title: String? = null,
    val isError: Boolean = false,
    val interrupted: Boolean = false
)

@Serializable
data class SessionDetail(
    val session: SessionSummary,
    val records: List<TimelineItem> = emptyList(),
    val pending: PendingState = PendingState()
)

@Serializable
data class HistoryResponse(
    val records: List<TimelineItem> = emptyList(),
    val hasMore: Boolean = false
)

@Serializable
data class Workspace(
    val id: String,
    val path: String = "",
    val title: String? = null,
    val updatedAt: Long? = null
)

@Serializable
data class WorkspaceList(
    val workspaces: List<Workspace> = emptyList()
)

@Serializable
data class PresetOption(
    val value: String,
    val name: String? = null,
    val description: String? = null
)

@Serializable
data class PresetCatalog(
    val options: List<PresetOption> = emptyList(),
    val defaultPreset: String? = null
)

@Serializable
data class BridgeInfo(
    val bridge: BridgeHost? = null,
    val device: PairedDevice? = null,
    val settings: BridgeSettings? = null
)

@Serializable
data class BridgeHost(
    val version: String? = null,
    val deviceId: String? = null,
    val hostName: String? = null,
    val port: Int? = null,
    val discoveryPort: Int? = null,
    val clients: Int = 0
)

@Serializable
data class PairedDevice(
    val id: String,
    val name: String? = null
)

@Serializable
data class BridgeSettings(
    val phoneFirst: Boolean = true,
    val discovery: Boolean = true,
    val approvalTimeoutMs: Long? = null,
    val questionTimeoutMs: Long? = null,
    val planReviewTimeoutMs: Long? = null
)

@Serializable
data class PairResult(
    val token: String,
    val device: PairedDevice? = null,
    val host: PairHost? = null
)

@Serializable
data class PairHost(
    val id: String? = null,
    val name: String? = null,
    val version: String? = null
)

@Serializable
data class CreateSessionResult(
    val sessionId: String,
    val agentPreset: String? = null,
    val warnings: List<String> = emptyList()
)

@Serializable
data class ApiErrorBody(val error: ApiError? = null)

@Serializable
data class ApiError(val code: String? = null, val message: String? = null)

@Serializable
data class AnswerItem(
    val id: String,
    val selected: List<String> = emptyList(),
    val custom: String? = null
)

data class SseEvent(val name: String, val data: String)

enum class ConnectionState { Disconnected, Connecting, Connected, Error }
