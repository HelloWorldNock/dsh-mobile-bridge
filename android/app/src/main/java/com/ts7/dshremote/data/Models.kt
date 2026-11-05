package com.ts7.dshremote.data

import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonPrimitive
import java.time.Instant

/**
 * 桌面端的时间字段可能是毫秒数，也可能是 ISO 字符串（工作区记录就是后者）。
 * 两种都能解析，解析失败时返回 null，避免一个字段把整段列表打挂。
 */
object EpochMillisSerializer : KSerializer<Long?> {
    override val descriptor: SerialDescriptor = PrimitiveSerialDescriptor("EpochMillis", PrimitiveKind.LONG)

    override fun deserialize(decoder: Decoder): Long? {
        if (decoder !is JsonDecoder) return null
        return when (val element = decoder.decodeJsonElement()) {
            is JsonPrimitive -> when {
                element.isString -> parseInstant(element.content)
                !element.isString -> element.content.toDoubleOrNull()?.toLong()
                else -> null
            }
            else -> null
        }
    }

    override fun serialize(encoder: Encoder, value: Long?) {
        if (value == null) encoder.encodeNull() else encoder.encodeLong(value)
    }

    private fun parseInstant(raw: String): Long? {
        val text = raw.trim()
        if (text.isEmpty()) return null
        text.toDoubleOrNull()?.let { return it.toLong() }
        return runCatching { Instant.parse(text).toEpochMilli() }.getOrNull()
    }
}

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
    @Serializable(with = EpochMillisSerializer::class) val updatedAt: Long? = null,
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

/**
 * 一条消息里的图片。主机把图片落成内容寻址的附件，时间线只下发元数据，
 * 真正字节要按 (sessionId, seq, index) 再取一次。
 */
@Serializable
data class TimelineImage(
    val index: Int = 0,
    val mediaType: String? = null,
    val name: String? = null,
    val width: Int? = null,
    val height: Int? = null,
    val bytes: Long? = null
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
    val interrupted: Boolean = false,
    val images: List<TimelineImage> = emptyList()
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
    @Serializable(with = EpochMillisSerializer::class) val updatedAt: Long? = null,
    val sessionIds: List<String> = emptyList()
)

@Serializable
data class WorkspaceList(
    val workspaces: List<Workspace> = emptyList(),
    val root: String? = null
)

@Serializable
data class WorkspaceResponse(
    val workspace: Workspace,
    val root: String? = null
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
data class BridgeEndpoint(
    val kind: String = "lan",
    val address: String? = null,
    val url: String = ""
) {
    val isLan: Boolean get() = kind == "lan"
    val isTailscale: Boolean get() = kind == "tailscale"
}

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
    val clients: Int = 0,
    val endpoints: List<BridgeEndpoint> = emptyList(),
    val workspaceRoot: String? = null
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
    val version: String? = null,
    val endpoints: List<BridgeEndpoint> = emptyList()
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

@Serializable
data class GroupBody(
    val id: String = "",
    val name: String = "",
    val createdAt: String = ""
)

@Serializable
data class GroupPeer(
    val deviceId: String = "",
    val name: String = "",
    val baseUrl: String = "",
    val groupId: String? = null,
    val version: String? = null,
    val collabRoot: String? = null,
    val collabWorkspaceId: String? = null,
    val status: String = "offline"
)

@Serializable
data class GroupInviteCode(
    val code: String = "",
    val expiresAt: String = ""
)

@Serializable
data class GroupInfo(
    val group: GroupBody? = null,
    val peers: List<GroupPeer> = emptyList(),
    val invite: GroupInviteCode? = null,
    val collabRoot: String? = null
)

@Serializable
data class GroupInviteResponse(
    val group: GroupBody? = null,
    val peers: List<GroupPeer> = emptyList(),
    val invite: GroupInviteCode? = null,
    val collabRoot: String? = null,
    val endpoints: List<BridgeEndpoint> = emptyList()
)

/** 主机侧日志包：path 是落盘位置，text 是可以直接发出去的诊断文本。 */
@Serializable
data class HostLogBundle(
    val path: String? = null,
    val count: Int = 0,
    val text: String = ""
)

data class SseEvent(val name: String, val data: String)

enum class ConnectionState { Disconnected, Connecting, Connected, Error }
