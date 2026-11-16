package com.ts7.dshremote.data

import android.content.Context
import android.content.SharedPreferences

/**
 * 手机端持久化的最小面。
 *
 * 生产实现是 SharedPreferences；单测用内存实现（[InMemoryKeyValueStore]）就能覆盖
 * 「配对记录怎么读写、老版本怎么迁移」这类逻辑，不必拉起 Android 运行时。
 */
interface KeyValueStore {
    fun getString(key: String, fallback: String? = null): String?
    fun putString(key: String, value: String?)
    fun getBoolean(key: String, fallback: Boolean = false): Boolean
    fun putBoolean(key: String, value: Boolean)

    companion object {
        fun of(prefs: SharedPreferences): KeyValueStore = object : KeyValueStore {
            override fun getString(key: String, fallback: String?): String? = prefs.getString(key, fallback)
            override fun putString(key: String, value: String?) {
                prefs.edit().putString(key, value).apply()
            }

            override fun getBoolean(key: String, fallback: Boolean): Boolean = prefs.getBoolean(key, fallback)
            override fun putBoolean(key: String, value: Boolean) {
                prefs.edit().putBoolean(key, value).apply()
            }
        }

        fun of(context: Context, name: String = HostStore.PREFS): KeyValueStore =
            of(context.applicationContext.getSharedPreferences(name, Context.MODE_PRIVATE))
    }
}

/** 单测用的内存实现：语义与 SharedPreferences 一致（缺键返回 fallback）。 */
class InMemoryKeyValueStore(initial: Map<String, Any?> = emptyMap()) : KeyValueStore {
    private val values = LinkedHashMap<String, Any?>(initial)

    override fun getString(key: String, fallback: String?): String? = values[key] as? String ?: fallback

    override fun putString(key: String, value: String?) {
        if (value == null) values.remove(key) else values[key] = value
    }

    override fun getBoolean(key: String, fallback: Boolean): Boolean = values[key] as? Boolean ?: fallback

    override fun putBoolean(key: String, value: Boolean) {
        values[key] = value
    }

    /** 断言用：看看到底写进去了什么。 */
    fun snapshot(): Map<String, Any?> = LinkedHashMap(values)
}
