package com.ts7.dshremote.data

import android.content.Context
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * 配对凭据的静态加密。
 *
 * 之前 token 明文存在 SharedPreferences 里：手机 root、备份被拉走、或者任何能读到
 * `/data/data/com.ts7.dshremote/shared_prefs/dsh_remote.xml` 的东西都能直接拿到它。
 *
 * 现在写进 `EncryptedSharedPreferences`（主密钥在 Android Keystore 里，键名 AES256-SIV、
 * 值 AES256-GCM）。老版本留下的明文文件会在启动时迁过去并清空。
 *
 * Keystore 不可用时（个别定制的 ROM、备份恢复到另一台机器）不能让 App 直接瘫掉：
 * 退回明文存储，但记录一条警告，导出日志里能看到当前到底是不是加密的。
 */
object SecureStorage {
    private const val TAG = "secure"

    /** 加密后的存储文件；与老的明文文件 [HostStore.PREFS] 并存，迁移完就把老文件清空。 */
    const val SECURE_PREFS = "dsh_remote_secure"

    /** 迁移时搬运的键（布尔型的展示偏好不搬，它不敏感）。 */
    private val MIGRATED_KEYS = listOf(
        HostStore.KEY_HOSTS,
        HostStore.KEY_ACTIVE,
        HostStore.KEY_LEGACY_BASE_URL,
        HostStore.KEY_LEGACY_TOKEN,
        HostStore.KEY_LEGACY_DEVICE_ID
    )

    @Volatile
    private var encrypted = false

    /** 当前是否真的用上了加密存储；面板/日志据此提示。 */
    val isEncrypted: Boolean get() = encrypted

    /**
     * 取加密存储；创建失败时退回明文（并记一条警告）。
     * 每次调用都建一个 EncryptedSharedPreferences 实例是廉价的，AndroidX 内部有缓存。
     */
    fun store(context: Context): KeyValueStore {
        return try {
            val masterKey = MasterKey.Builder(context.applicationContext)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()
            val prefs = EncryptedSharedPreferences.create(
                context.applicationContext,
                SECURE_PREFS,
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            )
            encrypted = true
            KeyValueStore.of(prefs)
        } catch (failure: Throwable) {
            encrypted = false
            Log.w(TAG, "encrypted prefs unavailable, falling back to plain storage", failure)
            RunLog.error(TAG, "加密存储不可用，退回明文：${failure.javaClass.simpleName} ${failure.message}")
            KeyValueStore.of(context.applicationContext.getSharedPreferences(HostStore.PREFS, Context.MODE_PRIVATE))
        }
    }

    /**
     * 把明文存储里的配对凭据搬到加密存储，然后清掉明文。
     * @return 实际搬过去的键数量（0 表示无需迁移或已经迁过）。
     */
    fun migrate(plain: KeyValueStore, secure: KeyValueStore): Int {
        var moved = 0
        for (key in MIGRATED_KEYS) {
            val value = plain.getString(key) ?: continue
            if (secure.getString(key) == null) {
                secure.putString(key, value)
                moved += 1
            }
            // 无论目标是空是满，明文这一份都要删掉。
            plain.putString(key, null)
        }
        return moved
    }

    /** 启动时调用一次：有老数据就迁移。 */
    fun migrateIfNeeded(context: Context): Int {
        val plain = KeyValueStore.of(
            context.applicationContext.getSharedPreferences(HostStore.PREFS, Context.MODE_PRIVATE)
        )
        val secure = store(context)
        if (secure.getString(HostStore.KEY_HOSTS) != null && plain.getString(HostStore.KEY_HOSTS) == null) {
            return 0
        }
        val moved = migrate(plain, secure)
        if (moved > 0) RunLog.info(TAG, "已把 $moved 个明文键迁到加密存储")
        return moved
    }

    /** 彻底清空配对凭据（用户重置 / 全部解绑）。加密与明文两处都清。 */
    fun wipe(context: Context) {
        val secure = store(context)
        val plain = KeyValueStore.of(
            context.applicationContext.getSharedPreferences(HostStore.PREFS, Context.MODE_PRIVATE)
        )
        for (key in MIGRATED_KEYS + listOf(SessionPrefs.KEY_SHOW_DETAILS)) {
            secure.putString(key, null)
            plain.putString(key, null)
        }
        RunLog.info(TAG, "配对凭据已从本机清除")
    }
}
