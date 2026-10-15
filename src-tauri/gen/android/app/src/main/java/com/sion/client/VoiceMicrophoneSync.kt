package com.sion.client

/** Native mute owns intent; route changes and platform acknowledgements never open it. */
class VoiceMicrophoneSync(
    private val canRequest: Boolean,
    private val readPlatform: () -> Boolean,
    private val headsetPresent: () -> Boolean,
    private val request: (Boolean, (Boolean) -> Unit) -> Unit,
    private val microphone: (Boolean) -> Unit,
    private val later: (Long, () -> Unit) -> (() -> Unit),
) {
    var muted = false
        private set
    private var active = false
    private var stopped = false
    private var route: String? = null
    private var bluetooth = false
    private var routeEpoch = 0L
    private var sequence = 0L
    private var pending: Long? = null
    private var confirmed: Boolean? = null
    private var handshake = 0
    private var candidateEpoch = 0L
    private var cancelUnmute: (() -> Unit)? = null

    fun desired(value: Boolean) {
        if (stopped || value == muted) return
        muted = value
        cancelCandidate()
        if (!value) handshake = 0
        synchronize()
    }

    fun active(value: Boolean) {
        if (stopped) return
        active = value
        if (!value) cancelCandidate()
        synchronize()
    }

    fun route(id: String?, isBluetooth: Boolean) {
        if (stopped || (id == route && isBluetooth == bluetooth)) return
        route = id
        bluetooth = isBluetooth
        routeEpoch++
        cancelCandidate()
        // A newly attached headset may have missed the earlier system mute.
        // Create a fresh platform edge while the native microphone stays muted.
        handshake = if (canRequest && isBluetooth && muted) 1 else 0
        synchronize()
    }

    fun devicesChanged() {
        if (bluetooth && !headsetPresent()) {
            routeEpoch++
            handshake = 0
            cancelCandidate()
        }
        synchronize()
    }

    fun platform(value: Boolean) {
        if (stopped || !active) return
        // Binder callbacks can arrive after a newer request or route change.
        if (value != readPlatform() || pending != null || handshake != 0) return
        confirmed = null
        cancelCandidate()
        if (value == muted) return
        if (value) {
            muted = true
            microphone(true)
        } else if (bluetooth && headsetPresent()) {
            val epoch = routeEpoch
            val candidate = candidateEpoch
            // Disconnect can reset system mute before Telecom removes its endpoint.
            cancelUnmute = later(350) {
                if (candidate != candidateEpoch) return@later
                cancelUnmute = null
                if (!stopped && active && epoch == routeEpoch && pending == null &&
                    bluetooth && headsetPresent() && !readPlatform() && muted) {
                    muted = false
                    microphone(false)
                }
                synchronize()
            }
        } else synchronize()
    }

    fun stop() {
        stopped = true
        active = false
        pending = null
        handshake = 0
        routeEpoch++
        cancelCandidate()
    }

    private fun synchronize() {
        if (stopped || !active || !canRequest || pending != null || cancelUnmute != null) return
        if (!bluetooth || !headsetPresent()) handshake = 0
        val phase = handshake
        val value = if (phase == 1) false else muted
        if (phase == 0 && readPlatform() == value && (confirmed == null || confirmed == value)) return
        val id = ++sequence
        val epoch = routeEpoch
        pending = id
        request(value) { accepted ->
            if (stopped || pending != id) return@request
            pending = null
            if (!accepted) { handshake = 0; return@request }
            confirmed = value
            if (epoch == routeEpoch && handshake == phase) handshake = if (phase == 1 && muted) 2 else 0
            if (handshake != 0 || epoch != routeEpoch || value != muted) synchronize()
        }
    }

    private fun cancelCandidate() {
        candidateEpoch++
        cancelUnmute?.invoke()
        cancelUnmute = null
    }
}
