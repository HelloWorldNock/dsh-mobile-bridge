package com.ts7.dshremote.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** 时间线折叠与纯文本导出（R20 第一刀）。 */
class TimelineFormatTest {
    private fun item(
        seq: Long,
        kind: String,
        text: String? = null,
        preview: String? = null,
        name: String? = null,
        reason: String? = null,
        phase: String? = null
    ) = TimelineItem(seq = seq, kind = kind, text = text, preview = preview, name = name, reason = reason, phase = phase)

    @Test
    fun `detailed mode keeps one row per item`() {
        val timeline = listOf(item(1, "user", text = "a"), item(2, "tool-call", name = "bash"), item(3, "assistant", text = "b"))
        val rows = buildTimelineRows(timeline, showDetails = true)
        assertEquals(3, rows.size)
        assertTrue(rows.all { it is TimelineRowModel.Single })
    }

    @Test
    fun `compact mode merges consecutive tool frames only`() {
        val timeline = listOf(
            item(1, "user", text = "跑一下"),
            item(2, "tool-call", name = "bash"),
            item(3, "tool-result", text = "ok"),
            item(4, "assistant", text = "完成"),
            item(5, "tool-call", name = "read"),
            item(6, "tool-result", text = "内容")
        )
        val rows = buildTimelineRows(timeline, showDetails = false)
        assertEquals(4, rows.size)
        assertTrue(rows[0] is TimelineRowModel.Single)
        assertEquals(2, (rows[1] as TimelineRowModel.Tools).items.size)
        assertTrue(rows[2] is TimelineRowModel.Single)
        assertEquals(2, (rows[3] as TimelineRowModel.Tools).items.size)
    }

    @Test
    fun `compact mode keeps a trailing tool group`() {
        val rows = buildTimelineRows(listOf(item(1, "user", text = "x"), item(2, "tool-call", name = "bash")), showDetails = false)
        assertEquals(2, rows.size)
        assertTrue(rows.last() is TimelineRowModel.Tools)
    }

    @Test
    fun `empty timeline folds to nothing`() {
        assertTrue(buildTimelineRows(emptyList(), showDetails = false).isEmpty())
    }

    @Test
    fun `plain text keeps whole messages and compresses tools`() {
        val timeline = listOf(
            item(1, "user", text = "帮我看看"),
            item(2, "assistant", text = "好的"),
            item(3, "tool-call", name = "bash", text = "ls"),
            item(4, "tool-result", text = "a.txt", reason = "退出码 0"),
            item(5, "turn", phase = "end")
        )
        val text = timelineToPlainText(timeline, streamText = "")
        assertTrue(text.contains("[我]\n帮我看看"))
        assertTrue(text.contains("[DSH]\n好的"))
        assertTrue(text.contains("· 工具 bash：ls"))
        // 工具结果优先用 reason
        assertTrue(text.contains("退出码 0"))
        assertTrue(text.contains("—— 完成 ——"))
    }

    @Test
    fun `plain text falls back to preview when text is missing`() {
        val text = timelineToPlainText(listOf(item(1, "user", preview = "预览内容")), "")
        assertTrue(text.contains("预览内容"))
    }

    @Test
    fun `plain text appends the streaming buffer`() {
        val text = timelineToPlainText(listOf(item(1, "user", text = "嗯")), "正在生成的内容")
        assertTrue(text.contains("[DSH 生成中]\n正在生成的内容"))
        assertTrue(text.endsWith("正在生成的内容"))
    }

    @Test
    fun `tool bodies are truncated`() {
        val long = "x".repeat(TOOL_BODY_LIMIT + 100)
        val text = timelineToPlainText(listOf(item(1, "tool-call", name = "bash", text = long)), "")
        assertTrue(text.length < long.length)
        assertTrue(text.contains("· 工具 bash："))
    }

    @Test
    fun `running and finished turns are labelled differently`() {
        assertTrue(timelineToPlainText(listOf(item(1, "turn", phase = "start")), "").contains("—— 运行中 ——"))
        assertTrue(timelineToPlainText(listOf(item(2, "turn", phase = "end")), "").contains("—— 完成 ——"))
    }

    @Test
    fun `blank output is trimmed`() {
        assertEquals("", timelineToPlainText(emptyList(), ""))
    }
}
