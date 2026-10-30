package com.ts7.dshremote.data

import android.content.Context

/**
 * 手机端展示偏好。执行细节默认隐藏，只保留用户/助手消息、轮次状态和错误；
 * 需要排查时可以在任务页右上角临时打开。
 */
object SessionPrefs {
    private const val KEY_SHOW_DETAILS = "timeline.showDetails"

    fun showDetails(context: Context): Boolean =
        prefs(context).getBoolean(KEY_SHOW_DETAILS, false)

    fun setShowDetails(context: Context, value: Boolean) {
        prefs(context).edit().putBoolean(KEY_SHOW_DETAILS, value).apply()
    }

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(HostStore.PREFS, Context.MODE_PRIVATE)
}
