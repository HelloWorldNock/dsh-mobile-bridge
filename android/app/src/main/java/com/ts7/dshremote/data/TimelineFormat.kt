package com.ts7.dshremote.data

/**
 * 时间线的「展示折叠」规则（R20 第一刀）。
 *
 * `SessionScreen` 里混着两件事：把 [TimelineItem] 折叠成可渲染的行，以及把整段对话铺成
 * 可复制的纯文本。这两件都是纯函数，不需要 Compose 也能测——抽出来之后就能在 JVM 上
 * 钉住「工具调用怎么合并」「流式文本怎么附在末尾」「工具结果取 reason 还是 text」。
 */

/** 时间线的一行：单条消息，或一段被合并的工具调用/结果。 */
sealed interface TimelineRowModel {
    data class Single(val item: TimelineItem) : TimelineRowModel
    data class Tools(val items: List<TimelineItem>) : TimelineRowModel
}

/** 工具结果/调用在纯文本里最多带多少字。 */
const val TOOL_BODY_LIMIT = 600

/**
 * 简洁模式把相邻的工具调用/结果合成一行（ToolGroupRow），详细模式一条一行。
 * 合并只在「连续」时发生：中间夹一条用户消息就断开。
 */
fun buildTimelineRows(timeline: List<TimelineItem>, showDetails: Boolean): List<TimelineRowModel> {
    if (showDetails) return timeline.map { TimelineRowModel.Single(it) }
    val rows = mutableListOf<TimelineRowModel>()
    val tools = mutableListOf<TimelineItem>()
    fun flush() {
        if (tools.isEmpty()) return
        rows += TimelineRowModel.Tools(tools.toList())
        tools.clear()
    }
    timeline.forEach { item ->
        if (item.kind == "tool-call" || item.kind == "tool-result") {
            tools += item
        } else {
            flush()
            rows += TimelineRowModel.Single(item)
        }
    }
    flush()
    return rows
}

/**
 * 把整段对话铺成可复制的纯文本：用户/助手消息整段保留，工具调用与结果压成一行，
 * 生成中的流式文本附在最后。手机上没有跨气泡框选的机制，这条通路负责全量复制。
 */
fun timelineToPlainText(timeline: List<TimelineItem>, streamText: String): String {
    val builder = StringBuilder()
    timeline.forEach { item ->
        val body = item.text.orEmpty().ifBlank { item.preview.orEmpty() }
        when (item.kind) {
            "user" -> builder.append("[我]\n").append(body).append("\n\n")
            "assistant" -> builder.append("[DSH]\n").append(body).append("\n\n")
            "tool-call" -> {
                builder.append("· 工具 ").append(item.name ?: "tool")
                if (body.isNotBlank()) builder.append("：").append(body.take(TOOL_BODY_LIMIT))
                builder.append('\n')
            }
            "tool-result" -> {
                val result = (item.reason ?: body).take(TOOL_BODY_LIMIT)
                if (result.isNotBlank()) builder.append(result).append('\n')
            }
            "turn" -> builder.append(if (item.phase == "end") "—— 完成 ——\n" else "—— 运行中 ——\n")
            else -> if (body.isNotBlank()) builder.append(body).append('\n')
        }
    }
    if (streamText.isNotBlank()) builder.append("[DSH 生成中]\n").append(streamText).append('\n')
    return builder.toString().trim()
}
