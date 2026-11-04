package com.ts7.dshremote.data

import android.content.Context
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request

/**
 * 「有没有新版本」只看 GitHub 上 /releases/latest 的重定向结果：
 * 它不需要 token，也不吃 API 的每小时限流，被墙/限流时 API 那套会先挂。
 * 更新说明和安装包仍然留在发布页，点开自己看。
 */
data class AppUpdate(
    val current: String,
    val latest: String?,
    val hasUpdate: Boolean,
    val url: String,
    val checkedAt: Long,
    val error: String? = null
)

object UpdateChecker {
    const val REPO = "HelloWorldNock/dsh-mobile-bridge"

    private const val SITE = "https://github.com"
    private const val KEY_LAST_CHECK = "update.lastCheckAt"
    private const val AUTO_INTERVAL_MS = 6 * 60 * 60 * 1000L
    private val TAG = Regex("/releases/tag/([^/?#]+)")

    private val client = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(8, TimeUnit.SECONDS)
        .followRedirects(true)
        .build()

    val releasesUrl: String get() = "$SITE/$REPO/releases"

    fun lastCheckedAt(context: Context): Long =
        prefs(context).getLong(KEY_LAST_CHECK, 0L)

    fun shouldAutoCheck(context: Context, now: Long = System.currentTimeMillis()): Boolean =
        now - lastCheckedAt(context) >= AUTO_INTERVAL_MS

    suspend fun check(context: Context, current: String): AppUpdate =
        withContext(Dispatchers.IO) {
            val checkedAt = System.currentTimeMillis()
            try {
                val request = Request.Builder()
                    .url("$SITE/$REPO/releases/latest")
                    .header("Accept", "text/html")
                    .header("User-Agent", "TS7-DSH-Remote/$current")
                    .build()
                client.newCall(request).execute().use { response ->
                    val finalUrl = response.request.url.toString()
                    val tag = TAG.find(finalUrl)?.groupValues?.getOrNull(1)
                    if (tag == null) {
                        val message = if (response.code == 404) {
                            "找不到发布页，仓库可能是私有的"
                        } else {
                            "仓库还没有发布版本"
                        }
                        return@withContext AppUpdate(current, null, false, releasesUrl, checkedAt, message)
                    }
                    val latest = tag.removePrefix("v").removePrefix("V")
                    saveCheckedAt(context, checkedAt)
                    AppUpdate(
                        current = current,
                        latest = latest,
                        hasUpdate = compareVersions(latest, current) > 0,
                        url = "$SITE/$REPO/releases/tag/$tag",
                        checkedAt = checkedAt,
                        error = null
                    )
                }
            } catch (error: Exception) {
                AppUpdate(
                    current = current,
                    latest = null,
                    hasUpdate = false,
                    url = releasesUrl,
                    checkedAt = checkedAt,
                    error = "连不上 GitHub：${error.message ?: error.javaClass.simpleName}"
                )
            }
        }

    /** `v0.8.10` 要比 `v0.8.9` 大，所以按数字段比而不是字符串比。 */
    fun compareVersions(left: String, right: String): Int {
        val a = parts(left)
        val b = parts(right)
        for (index in 0 until maxOf(a.size, b.size)) {
            val one = a.getOrElse(index) { 0 }
            val other = b.getOrElse(index) { 0 }
            if (one != other) return if (one > other) 1 else -1
        }
        return 0
    }

    private fun parts(value: String): List<Int> =
        value.trim()
            .removePrefix("v")
            .removePrefix("V")
            .substringBefore('-')
            .substringBefore('+')
            .split('.')
            .map { piece -> piece.takeWhile { it.isDigit() }.toIntOrNull() ?: 0 }

    private fun saveCheckedAt(context: Context, value: Long) {
        prefs(context).edit().putLong(KEY_LAST_CHECK, value).apply()
    }

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(HostStore.PREFS, Context.MODE_PRIVATE)
}
