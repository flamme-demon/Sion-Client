package com.sion.client

/** Initial unmuted hardware must never unmute a call the user entered muted. */
class HeadsetMicrophone {
    private var previous: Boolean? = null
    fun changed(muted: Boolean): Int? {
        val before = previous
        previous = muted
        if (before == muted || (before == null && !muted)) return null
        return if (muted) 1 else 2
    }
}
