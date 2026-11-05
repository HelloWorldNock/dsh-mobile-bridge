package com.ts7.dshremote.data

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * 手机端一小时内到底做了什么，只有内存里这几百行能回答。
 *
 * 排查现场时最常问的三件事——「有没有收到事件」、「轮询有没有回来」、「通知发了没有」——
 * 全都靠它。它只在内存里，不写文件、不上报，随进程退出清空；导出时才拼进文本。
 */
object RunLog {
    /** 400 行足够覆盖一次复现，又不会让导出文本大到发不出去。 */
    private const val MAX_ENTRIES = 400

    private val entries = ArrayDeque<String>()
    private val lock = Any()
    private val stamp = object : ThreadLocal<SimpleDateFormat>() {
        override fun initialValue() = SimpleDateFormat("MM-dd HH:mm:ss.SSS", Locale.US)
    }

    fun info(tag: String, message: String) = record("I", tag, message)

    fun warn(tag: String, message: String) = record("W", tag, message)

    fun error(tag: String, message: String) = record("E", tag, message)

    fun record(level: String, tag: String, message: String) {
        val time = stamp.get()?.format(Date()) ?: ""
        val line = "$time $level/$tag $message"
        synchronized(lock) {
            if (entries.size >= MAX_ENTRIES) entries.removeFirst()
            entries.addLast(line)
        }
    }

    fun size(): Int = synchronized(lock) { entries.size }

    fun snapshot(limit: Int = MAX_ENTRIES): List<String> = synchronized(lock) {
        if (limit <= 0) return@synchronized entries.toList()
        entries.takeLast(limit)
    }

    fun text(limit: Int = MAX_ENTRIES): String = snapshot(limit).joinToString("\n")

    fun timestamp(): String =
        SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(Date())

    fun clear() {
        synchronized(lock) { entries.clear() }
    }
}
