package com.ts7.dshremote

import kotlinx.coroutines.flow.MutableStateFlow

/** A tiny bridge between notification taps and the Compose navigation graph. */
object DeepLinks {
    data class Target(val hostId: String?, val sessionId: String)

    val session = MutableStateFlow<Target?>(null)

    fun open(hostId: String?, sessionId: String?) {
        if (!sessionId.isNullOrBlank()) session.value = Target(hostId, sessionId)
    }
}
