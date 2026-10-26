package com.ts7.dshremote.data

import kotlinx.serialization.Serializable

@Serializable
data class SnapshotEnvelope(
    val sessionId: String,
    val records: List<TimelineItem> = emptyList()
)

@Serializable
data class SessionEventEnvelope(
    val sessionId: String,
    val item: TimelineItem? = null
)

@Serializable
data class SessionEnvelope(
    val session: SessionSummary
)

@Serializable
data class StatusEnvelope(
    val sessionId: String,
    val running: Boolean = false,
    val session: SessionSummary? = null
)

@Serializable
data class DeltaItem(
    val phase: String? = null,
    val kind: String? = null,
    val text: String? = null,
    val index: Int? = null
)

@Serializable
data class DeltaEnvelope(
    val sessionId: String,
    val item: DeltaItem? = null
)

@Serializable
data class ClosedEnvelope(
    val id: String,
    val outcome: String? = null,
    val reason: String? = null,
    val sessionId: String? = null
)

@Serializable
data class SessionIdEnvelope(
    val sessionId: String,
    val message: String? = null,
    val updatedAt: Long? = null
)

@Serializable
data class HelloEnvelope(
    val deviceId: String? = null,
    val hostName: String? = null,
    val clients: Int = 0,
    val version: String? = null
)
