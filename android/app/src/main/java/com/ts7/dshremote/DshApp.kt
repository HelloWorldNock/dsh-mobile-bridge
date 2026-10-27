package com.ts7.dshremote

import android.app.Application
import com.ts7.dshremote.data.BridgeRepository
import com.ts7.dshremote.data.EmbeddedTailscale

class DshApp : Application() {
    val tailscale: EmbeddedTailscale by lazy { EmbeddedTailscale(this) }
    val repository: BridgeRepository by lazy { BridgeRepository(this, tailscale) }
}
