package com.ts7.dshremote.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** 会话列表与时间线的折叠规则（R19 第二刀）。 */
class SessionSyncManagerTest {
    private fun session(id: String, updatedAt: Long?) =
        SessionSummary(id = id, title = "任务 $id", updatedAt = updatedAt)

    private fun item(seq: Long, kind: String = "assistant", phase: String? = null, text: String? = null) =
        TimelineItem(seq = seq, kind = kind, phase = phase, text = text)

    @Test
    fun `sessions sort by recency then id`() {
        val sorted = SessionSyncManager.sortSessions(
            listOf(session("a", 1), session("c", 3), session("b", 3), session("d", null))
        )
        assertEquals(listOf("c", "b", "a", "d"), sorted.map { it.id })
    }

    @Test
    fun `upsert replaces in place and keeps the order stable`() {
        val list = listOf(session("a", 10), session("b", 20))
        val replaced = SessionSyncManager.upsertSession(list, session("a", 30))
        assertEquals(listOf("a", "b"), replaced.map { it.id })
        assertEquals(30L, replaced.first().updatedAt)

        val added = SessionSyncManager.upsertSession(list, session("c", 5))
        assertEquals(listOf("b", "a", "c"), added.map { it.id })
    }

    @Test
    fun `pending upserts append new cards and overwrite existing ones`() {
        val approvals = SessionSyncManager.upsertApproval(emptyList(), PendingApproval(id = "ap1", toolName = "bash"))
        assertEquals(1, approvals.size)
        val again = SessionSyncManager.upsertApproval(approvals, PendingApproval(id = "ap1", toolName = "read"))
        assertEquals(1, again.size)
        assertEquals("read", again.single().toolName)

        val questions = SessionSyncManager.upsertQuestion(emptyList(), PendingQuestion(id = "q1"))
        // 不同 id 追加，同 id 覆盖
        assertEquals(2, SessionSyncManager.upsertQuestion(questions, PendingQuestion(id = "q2")).size)
        assertEquals(1, SessionSyncManager.upsertQuestion(questions, PendingQuestion(id = "q1", planReview = true)).size)
    }

    @Test
    fun `timeline dedupes by seq and ignores frames without one`() {
        val existing = listOf(item(1), item(2))
        assertTrue(SessionSyncManager.timelineContains(existing, 2))
        assertFalse(SessionSyncManager.timelineContains(existing, 3))
        // seq <= 0 的老帧不算重复，否则会把所有无序号帧都吞掉。
        assertFalse(SessionSyncManager.timelineContains(existing, 0))
        assertFalse(SessionSyncManager.timelineContains(existing, -5))

        assertEquals(2, SessionSyncManager.appendTimeline(existing, item(2)).size)
        assertEquals(3, SessionSyncManager.appendTimeline(existing, item(3)).size)
        // 无序号帧总是追加
        assertEquals(3, SessionSyncManager.appendTimeline(existing, item(0)).size)
    }

    @Test
    fun `only turn start and end change the running flag`() {
        assertTrue(SessionSyncManager.runningAfterEvent(false, item(1, kind = "turn", phase = "start")))
        assertFalse(SessionSyncManager.runningAfterEvent(true, item(2, kind = "turn", phase = "end")))
        // 助手消息不该被当成「任务结束」
        assertTrue(SessionSyncManager.runningAfterEvent(true, item(3, kind = "assistant")))
        assertFalse(SessionSyncManager.runningAfterEvent(false, item(4, kind = "tool")))
    }

    @Test
    fun `assistant text is cached only for assistant frames and capped`() {
        assertNull(SessionSyncManager.assistantTextFor(item(1, kind = "tool", text = "x")))
        assertNull(SessionSyncManager.assistantTextFor(item(2, kind = "assistant", text = "   ")))
        assertEquals("hi", SessionSyncManager.assistantTextFor(item(3, kind = "assistant", text = "hi")))

        val long = "帧".repeat(SessionSyncManager.ASSISTANT_TEXT_LIMIT + 50)
        assertEquals(
            SessionSyncManager.ASSISTANT_TEXT_LIMIT,
            SessionSyncManager.assistantTextFor(item(4, kind = "assistant", text = long))?.length
        )
    }
}
