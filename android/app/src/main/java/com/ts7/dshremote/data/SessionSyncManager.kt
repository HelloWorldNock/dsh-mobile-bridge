package com.ts7.dshremote.data

/**
 * 会话列表与时间线的折叠规则（R19 第二刀）。
 *
 * 这些函数决定「同一条会话再来一次事件时，列表/时间线该怎么变」。它们曾经散在
 * `BridgeRepository` 的事件处理里，只能靠真机断线复现来验；抽出来之后可以在 JVM 上
 * 把边界（乱序 seq、重复帧、turn 起止）逐条钉住。
 */
object SessionSyncManager {
    /** 通知里最多带多少字的助手正文（手机锁屏时只需要一段摘要）。 */
    const val ASSISTANT_TEXT_LIMIT = 4_000

    /** 会话排序：最近更新的在前，同一时刻按 id 倒序，保证刷新前后顺序稳定。 */
    fun sortSessions(items: List<SessionSummary>): List<SessionSummary> =
        items.sortedWith(compareByDescending<SessionSummary> { it.updatedAt ?: 0L }.thenByDescending { it.id })

    /** 新会话插入 / 已有会话整体替换，然后重排。 */
    fun upsertSession(list: List<SessionSummary>, session: SessionSummary): List<SessionSummary> {
        val index = list.indexOfFirst { it.id == session.id }
        if (index < 0) return sortSessions(list + session)
        val copy = list.toMutableList()
        copy[index] = session
        return sortSessions(copy)
    }

    /** 审批卡片：同 id 覆盖，否则追加（顺序即到达顺序）。 */
    fun upsertApproval(list: List<PendingApproval>, approval: PendingApproval): List<PendingApproval> {
        val index = list.indexOfFirst { it.id == approval.id }
        if (index < 0) return list + approval
        val copy = list.toMutableList()
        copy[index] = approval
        return copy
    }

    fun upsertQuestion(list: List<PendingQuestion>, question: PendingQuestion): List<PendingQuestion> {
        val index = list.indexOfFirst { it.id == question.id }
        if (index < 0) return list + question
        val copy = list.toMutableList()
        copy[index] = question
        return copy
    }

    /**
     * 时间线里已经有这一条了吗（按 seq 判）。
     *
     * seq <= 0 一律当「没有 seq」处理：老桥接的帧不带序号，不能因此把所有帧都当成重复。
     */
    fun timelineContains(items: List<TimelineItem>, seq: Long): Boolean {
        if (seq <= 0) return false
        return items.any { it.seq == seq }
    }

    /** 追加一条时间线条目；已经存在的 seq 直接忽略（SSE 重连会重放快照）。 */
    fun appendTimeline(items: List<TimelineItem>, item: TimelineItem): List<TimelineItem> =
        if (timelineContains(items, item.seq)) items else items + item

    /**
     * 这一帧推完之后 `running` 应该是多少。
     *
     * turn 的 start/end 是唯一能改这个标记的帧；其它帧一律沿用当前值（不能因为收到
     * 一条助手消息就认为任务停了）。
     */
    fun runningAfterEvent(currentRunning: Boolean, item: TimelineItem): Boolean = when {
        item.kind == "turn" && item.phase == "start" -> true
        item.kind == "turn" && item.phase == "end" -> false
        else -> currentRunning
    }

    /** 需要缓存给通知用的助手正文；非助手消息或空正文返回 null。 */
    fun assistantTextFor(item: TimelineItem): String? {
        if (item.kind != "assistant") return null
        val text = item.text?.takeIf { it.isNotBlank() } ?: return null
        return text.take(ASSISTANT_TEXT_LIMIT)
    }
}
