package com.ts7.dshremote.data

import android.content.Context

/**
 * 手机端展示偏好。执行细节默认隐藏，只保留用户/助手消息、轮次状态和错误；
 * 需要排查时可以在任务页右上角临时打开。
 */
object SessionPrefs {
    internal const val KEY_SHOW_DETAILS = "timeline.showDetails"

    fun showDetails(context: Context): Boolean = showDetails(SecureStorage.store(context))

    fun showDetails(store: KeyValueStore): Boolean = store.getBoolean(KEY_SHOW_DETAILS, false)

    fun setShowDetails(context: Context, value: Boolean) = setShowDetails(SecureStorage.store(context), value)

    fun setShowDetails(store: KeyValueStore, value: Boolean) {
        store.putBoolean(KEY_SHOW_DETAILS, value)
    }
}
