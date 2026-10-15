package com.sion.client

/** Late platform callbacks can only release their own call, never a newer one. */
class VoiceCallLifetime<T>(private val release: (T) -> Unit) {
    private var generation = 0L
    private var running = false
    var control: T? = null
        private set

    fun begin(): Long {
        stop()
        running = true
        return generation
    }

    fun current(token: Long): Boolean = running && token == generation

    fun accept(token: Long, value: T): Boolean {
        if (!current(token)) { release(value); return false }
        control = value
        return true
    }

    fun ended(token: Long): Boolean {
        if (!current(token)) return false
        running = false
        generation++
        control = null
        return true
    }

    fun stop() {
        running = false
        generation++
        val previous = control
        control = null
        if (previous != null) release(previous)
    }
}
