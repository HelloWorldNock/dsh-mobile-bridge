package com.ts7.dshremote.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 待办队列合并：服务端快照权威，但本地「请求发出之后才到」的卡片必须活下来。
 * 这三条时序任一搞反，都会出现审批卡片闪烁或幽灵卡片。
 */
class PendingMergeTest {
    private fun approval(id: String, tool: String = "bash") =
        PendingApproval(id = id, sessionTitle = "任务", toolName = tool)

    private fun question(id: String) = PendingQuestion(id = id, sessionTitle = "任务")

    @Test
    fun `server snapshot replaces stale local cards`() {
        val current = PendingState(approvals = listOf(approval("ap_old")), questions = listOf(question("q_old")))
        val incoming = PendingState(approvals = listOf(approval("ap_new")))

        val merged = PendingMerge.merge(incoming, current, isFresh = { false })

        assertEquals(listOf("ap_new"), merged.approvals.map { it.id })
        assertTrue(merged.questions.isEmpty())
    }

    @Test
    fun `a card that arrived after the request started survives`() {
        val current = PendingState(approvals = listOf(approval("ap_late")), questions = emptyList())
        val incoming = PendingState()

        val merged = PendingMerge.merge(incoming, current, isFresh = { it == "ap_late" })

        assertEquals(listOf("ap_late"), merged.approvals.map { it.id })
    }

    @Test
    fun `same id on both sides is not duplicated and keeps the server copy`() {
        val current = PendingState(approvals = listOf(approval("ap_1", tool = "local-copy")))
        val incoming = PendingState(approvals = listOf(approval("ap_1", tool = "server-copy")))

        val merged = PendingMerge.merge(incoming, current, isFresh = { true })

        assertEquals(1, merged.approvals.size)
        assertEquals("server-copy", merged.approvals.single().toolName)
    }

    @Test
    fun `freshness compares local write time with the request time`() {
        val addedAt = mapOf("ap_before" to 100L, "ap_after" to 200L)
        val isFresh = PendingMerge.freshness(addedAt, requestedAt = 150L)

        assertFalse(isFresh("ap_before"))
        assertTrue(isFresh("ap_after"))
        // 从没见过的 id 按 0 处理，不会凭空活下来。
        assertFalse(isFresh("ap_unknown"))
    }

    @Test
    fun `alive ids cover both queues for pruning`() {
        val state = PendingState(approvals = listOf(approval("ap_1"), approval("ap_2")), questions = listOf(question("q_1")))
        assertEquals(setOf("ap_1", "ap_2", "q_1"), PendingMerge.aliveIds(state))
    }

    @Test
    fun `merging an identical snapshot keeps the same object shape`() {
        val state = PendingState(approvals = listOf(approval("ap_1")), questions = listOf(question("q_1")))
        assertEquals(state, PendingMerge.merge(state, state, isFresh = { false }))
    }
}
