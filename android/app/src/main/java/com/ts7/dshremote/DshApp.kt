package com.ts7.dshremote

import android.app.Application
import com.ts7.dshremote.data.BridgeRepository
import com.ts7.dshremote.data.EmbeddedTailscale
import com.ts7.dshremote.data.SecureStorage

class DshApp : Application() {
    val tailscale: EmbeddedTailscale by lazy { EmbeddedTailscale(this) }
    val repository: BridgeRepository by lazy { BridgeRepository(this, tailscale) }

    override fun onCreate() {
        super.onCreate()
        // 必须早于任何 HostStore 读取：把老版本的明文配对凭据迁进加密存储并清掉明文。
        SecureStorage.migrateIfNeeded(this)
    }
}
