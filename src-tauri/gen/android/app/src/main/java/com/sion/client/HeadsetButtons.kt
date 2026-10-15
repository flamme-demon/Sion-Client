package com.sion.client

/** Ignore key-up and auto-repeat so one physical press produces one action. */
object HeadsetButtons {
    fun supported(code: Int): Boolean = code in setOf(5, 6, 79, 85, 86, 91, 126, 127)
    fun action(code: Int, down: Boolean, repeat: Int, canceled: Boolean, hook: String): Int? {
        if (!down || repeat != 0 || canceled) return null
        return when (code) {
            5, 79, 85 -> if (hook == "disconnect") 3 else 0
            91 -> 0
            126 -> 2
            127 -> 1
            6, 86 -> 3
            else -> null
        }
    }
}
