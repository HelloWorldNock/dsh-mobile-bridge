package com.ts7.dshremote.data

/**
 * 待办队列的合并规则。
 *
 * 服务端快照是权威的：手机拉回来的 `/api/pending` 整体替换本地队列。唯一的例外是
 * 「这一轮请求发出之后才到本地」的卡片——那是正在路上的 SSE 帧，不是陈旧数据；
 * 把它扔掉会出现「审批卡片刚弹出就被拉掉的快照吞掉」的闪烁。
 *
 * 逻辑抽成纯函数，`PendingMergeTest` 覆盖三种时序：先到后拉、拉完才到、双方都有。
 */
object PendingMerge {
    /**
     * @param incoming 服务端快照
     * @param current 本地当前队列
     * @param isFresh 判断某张本地卡片是否晚于本次请求发出时刻
     */
    fun merge(
        incoming: PendingState,
        current: PendingState,
        isFresh: (String) -> Boolean
    ): PendingState {
        val approvals = (incoming.approvals + current.approvals.filter { isFresh(it.id) }).distinctBy { it.id }
        val questions = (incoming.questions + current.questions.filter { isFresh(it.id) }).distinctBy { it.id }
        return PendingState(approvals = approvals, questions = questions)
    }

    /** 以「本地写入时刻 >= 请求发出时刻」判新鲜；缺记录按 0 处理。 */
    fun freshness(addedAt: Map<String, Long>, requestedAt: Long): (String) -> Boolean =
        { id -> (addedAt[id] ?: 0L) >= requestedAt }

    /** 合并后仍然活着的 id，用来清 `pendingAddedAt`。 */
    fun aliveIds(state: PendingState): Set<String> =
        (state.approvals.map { it.id } + state.questions.map { it.id }).toSet()
}
