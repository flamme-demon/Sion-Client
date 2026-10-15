package com.sion.client

data class VoiceAudioDevice(val id: String, val type: String, val name: String)
data class VoiceAudioState(
    val running: Boolean = false,
    val selected: String = "auto",
    val active: String? = null,
    val pending: String? = null,
    val devices: List<VoiceAudioDevice> = emptyList(),
    val error: String? = null,
    val interrupted: Boolean = false,
)

interface VoiceAudioDriver {
    fun devices(): List<VoiceAudioDevice>
    fun currentDevice(): String?
    fun select(device: VoiceAudioDevice): Boolean
    fun clear()
    fun later(delayMs: Long, action: () -> Unit): () -> Unit
}

interface VoiceAudioController {
    fun start()
    fun stop()
    fun choose(id: String): Boolean
    fun resume()
    fun phoneCall(active: Boolean)
    fun muteChanged(muted: Boolean) {}
}

/** One call owns routing; accepted requests remain pending until Android confirms them. */
class VoiceAudioRouting(private val driver: VoiceAudioDriver, private val changed: (VoiceAudioState) -> Unit) {
    var state = VoiceAudioState()
        private set
    private var cancelTimeout: (() -> Unit)? = null
    private val failed = mutableSetOf<String>()
    private var retries = 0
    private var epoch = 0L

    fun start(interrupted: Boolean = false) {
        if (state.running) return
        state = VoiceAudioState(running = true, interrupted = interrupted)
        refresh()
    }

    fun stop() {
        cancelPending()
        driver.clear()
        failed.clear()
        state = VoiceAudioState()
        changed(state)
    }

    fun choose(id: String): Boolean {
        if (!state.running || (id != "auto" && state.devices.none { it.id == id })) return false
        cancelPending()
        failed.clear()
        retries = 0
        state = state.copy(selected = id, pending = null, error = null)
        refresh()
        return true
    }

    fun interrupt(value: Boolean) {
        if (!state.running || value == state.interrupted) return
        cancelPending()
        state = state.copy(interrupted = value, pending = null)
        if (value) changed(state) else refresh()
    }

    fun focusError(failed: Boolean) {
        state = state.copy(error = if (failed) "focusFailed" else state.error.takeUnless { it == "focusFailed" })
        changed(state)
    }

    fun rejected(id: String) {
        if (state.running && state.pending == id) fail(id)
    }

    fun refresh() {
        if (!state.running) return
        val devices = driver.devices()
        if (devices.map { it.id }.toSet() != state.devices.map { it.id }.toSet()) {
            failed.clear()
            state = state.copy(error = null)
        }
        val selected = if (state.interrupted) state.selected
            else state.selected.takeIf { it == "auto" || devices.any { d -> d.id == it } } ?: "auto"
        state = state.copy(devices = devices, selected = selected, active = driver.currentDevice())
        if (state.interrupted) { changed(state); return }
        val target = devices.firstOrNull { it.id == selected && it.id !in failed }
            ?: devices.filter { it.id !in failed }.minByOrNull { priority(it.type) }
        if (target == null) {
            cancelPending()
            state = state.copy(pending = null, error = "routeFailed")
            changed(state)
            return
        }
        if (state.active == target.id) {
            cancelPending()
            retries = 0
            state = state.copy(pending = null)
            changed(state)
        } else if (state.pending != target.id) {
            cancelPending()
            retries = 0
            request(target)
        } else changed(state)
    }

    private fun request(target: VoiceAudioDevice) {
        state = state.copy(pending = target.id)
        if (!driver.select(target)) { fail(target.id); return }
        if (!state.running || state.interrupted || state.pending != target.id) return
        if (driver.currentDevice() == target.id) { refresh(); return }
        changed(state)
        val requestEpoch = epoch
        // A retry and its confirmation together take at most 30 seconds.
        cancelTimeout = driver.later(15_000) {
            if (requestEpoch != epoch || !state.running || state.interrupted || state.pending != target.id) return@later
            cancelTimeout = null
            if (driver.currentDevice() == target.id) { refresh(); return@later }
            if (retries++ == 0) {
                driver.clear()
                request(target)
            } else fail(target.id)
        }
    }

    private fun fail(id: String) {
        cancelPending()
        driver.clear()
        failed.add(id)
        state = state.copy(selected = "auto", pending = null, error = "routeFailed")
        refresh()
    }

    private fun cancelPending() { epoch++; cancelTimeout?.invoke(); cancelTimeout = null }
    private fun priority(type: String): Int = when (type) {
        "bluetooth" -> 0
        "wired" -> 1
        "usb" -> 2
        "hearingAid" -> 3
        "speaker" -> 4
        "earpiece" -> 5
        else -> 6
    }
}
