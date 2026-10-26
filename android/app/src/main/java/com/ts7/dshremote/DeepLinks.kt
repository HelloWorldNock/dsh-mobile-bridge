package com.ts7.dshremote

import kotlinx.coroutines.flow.MutableStateFlow

/** A tiny bridge between notification taps and the Compose navigation graph. */
object DeepLinks {
    val session = MutableStateFlow<String?>(null)

    fun open(sessionId: String?) {
        if (!sessionId.isNullOrBlank()) session.value = sessionId
    }
}
