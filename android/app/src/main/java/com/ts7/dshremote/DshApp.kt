package com.ts7.dshremote

import android.app.Application
import com.ts7.dshremote.data.BridgeRepository

class DshApp : Application() {
    val repository: BridgeRepository by lazy { BridgeRepository(this) }
}
