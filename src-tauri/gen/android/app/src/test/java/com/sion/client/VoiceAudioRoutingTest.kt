package com.sion.client

import org.junit.Assert.*
import org.junit.Test

class VoiceAudioRoutingTest {
    private val speaker = VoiceAudioDevice("1", "speaker", "Phone")
    private val earpiece = VoiceAudioDevice("2", "earpiece", "Phone")
    private val bluetooth = VoiceAudioDevice("3", "bluetooth", "Headset")
    private class Driver : VoiceAudioDriver {
        var available = emptyList<VoiceAudioDevice>()
        var active: String? = null
        val requested = mutableListOf<String>()
        val reject = mutableSetOf<String>()
        val timers = mutableListOf<Pair<() -> Unit, BooleanArray>>()
        var cleared = 0
        override fun devices() = available
        override fun currentDevice() = active
        override fun select(device: VoiceAudioDevice): Boolean { requested.add(device.id); return device.id !in reject }
        override fun clear() { cleared++ }
        override fun later(delayMs: Long, action: () -> Unit): () -> Unit {
            assertEquals(15_000, delayMs)
            val canceled = booleanArrayOf(false)
            timers.add(action to canceled)
            return { canceled[0] = true }
        }
        fun timeout() { val pending = timers.first { !it.second[0] }; pending.second[0] = true; pending.first() }
    }

    @Test fun selectionWaitsForTheActualRouteAndKeepsTheUserChoice() {
        val d = Driver().apply { available = listOf(speaker, earpiece, bluetooth); active = speaker.id }
        val routing = VoiceAudioRouting(d) {}
        routing.start()
        assertEquals(bluetooth.id, routing.state.pending)
        assertEquals(speaker.id, routing.state.active)
        d.active = bluetooth.id; routing.refresh()
        assertNull(routing.state.pending)
        assertEquals(bluetooth.id, routing.state.active)
        assertTrue(routing.choose(earpiece.id))
        d.active = earpiece.id; routing.refresh()
        routing.refresh()
        assertEquals(listOf(bluetooth.id, earpiece.id), d.requested)
        assertEquals(earpiece.id, routing.state.selected)
    }

    @Test fun unpluggedHeadsetFallsBackAndReconnectsAutomatically() {
        val d = Driver().apply { available = listOf(speaker, bluetooth); active = bluetooth.id }
        val routing = VoiceAudioRouting(d) {}
        routing.start(); routing.choose(bluetooth.id)
        d.available = listOf(speaker); d.active = speaker.id; routing.refresh()
        assertEquals("auto", routing.state.selected)
        assertNull(routing.state.pending)
        d.available = listOf(speaker, bluetooth); routing.refresh()
        assertEquals(bluetooth.id, routing.state.pending)
    }

    @Test fun rejectedAndTimedOutRequestsFallBackWithAnError() {
        for (rejectImmediately in listOf(false, true)) {
            val d = Driver().apply { available = listOf(speaker, bluetooth); active = speaker.id }
            if (rejectImmediately) d.reject.add(bluetooth.id)
            val routing = VoiceAudioRouting(d) {}
            routing.start()
            if (!rejectImmediately) {
                routing.refresh(); routing.refresh()
                assertEquals(1, d.requested.size)
                d.timeout(); d.timeout()
                assertEquals(2, d.requested.size)
            }
            assertEquals(speaker.id, routing.state.active)
            assertNull(routing.state.pending)
            assertEquals("routeFailed", routing.state.error)
            assertTrue(d.timers.all { it.second[0] })
        }
    }

    @Test fun interruptionsPauseSelectionAndResumeWithoutChangingPreference() {
        val d = Driver().apply { available = listOf(speaker, bluetooth); active = speaker.id }
        val routing = VoiceAudioRouting(d) {}
        routing.start(interrupted = true)
        assertTrue(d.requested.isEmpty())
        routing.interrupt(false)
        assertEquals(bluetooth.id, routing.state.pending)
        routing.interrupt(true)
        val before = d.requested.size
        routing.refresh()
        assertEquals(before, d.requested.size)
        routing.interrupt(false)
        assertEquals(before + 1, d.requested.size)
    }

    @Test fun asynchronousRejectionOnlyAffectsThePendingRoute() {
        val d = Driver().apply { available = listOf(speaker, earpiece, bluetooth); active = speaker.id }
        val routing = VoiceAudioRouting(d) {}
        routing.start()
        assertEquals(bluetooth.id, routing.state.pending)
        assertTrue(routing.choose(earpiece.id))
        routing.rejected(bluetooth.id)
        assertEquals(earpiece.id, routing.state.pending)
        assertNull(routing.state.error)
        routing.rejected(earpiece.id)
        assertEquals("auto", routing.state.selected)
        assertEquals("routeFailed", routing.state.error)
        assertEquals(bluetooth.id, routing.state.pending)
        routing.stop()
        routing.rejected(bluetooth.id)
        assertFalse(routing.state.running)
        assertNull(routing.state.error)
        assertTrue(d.timers.all { it.second[0] })
    }

    @Test fun repeatedCallsReleaseTimeoutsEvenIfAnOldCallbackRunsLater() {
        val d = Driver().apply { available = listOf(speaker, bluetooth); active = speaker.id }
        val routing = VoiceAudioRouting(d) {}
        repeat(32) {
            routing.start()
            val stale = d.timers.last().first
            routing.stop()
            assertFalse(routing.state.running)
            assertNull(routing.state.pending)
            assertTrue(d.timers.all { it.second[0] })
            routing.start()
            val requests = d.requested.size
            stale()
            assertEquals(requests, d.requested.size)
            routing.stop()
        }
        assertEquals(64, d.cleared)
    }

    @Test fun unknownSelectionDoesNotChangeTheRoute() {
        val d = Driver().apply { available = listOf(speaker); active = speaker.id }
        val routing = VoiceAudioRouting(d) {}
        assertFalse(routing.choose(speaker.id))
        routing.start()
        assertFalse(routing.choose("missing"))
        assertEquals("auto", routing.state.selected)
        assertTrue(d.requested.isEmpty())
        routing.stop()
    }

    @Test fun phoneInterruptionDoesNotForgetATemporarilyHiddenManualRoute() {
        val d = Driver().apply { available = listOf(speaker, earpiece, bluetooth); active = earpiece.id }
        val routing = VoiceAudioRouting(d) {}
        routing.start(); routing.choose(earpiece.id)
        routing.interrupt(true)
        d.available = emptyList(); routing.refresh()
        assertEquals(earpiece.id, routing.state.selected)
        d.available = listOf(speaker, earpiece, bluetooth); d.active = speaker.id
        routing.interrupt(false)
        assertEquals(earpiece.id, routing.state.pending)
        assertEquals(earpiece.id, routing.state.selected)
        routing.stop()
    }

    @Test fun focusRetryDoesNotHideAnExistingRouteFailure() {
        val d = Driver().apply { available = listOf(speaker, bluetooth); active = speaker.id; reject.add(bluetooth.id) }
        val routing = VoiceAudioRouting(d) {}
        routing.start()
        routing.focusError(false)
        assertEquals("routeFailed", routing.state.error)
        routing.focusError(true)
        assertEquals("focusFailed", routing.state.error)
        routing.focusError(false)
        assertNull(routing.state.error)
        routing.stop()
    }

    @Test fun hardwareButtonsIgnoreKeyUpRepeatAndVolumeControls() {
        assertEquals(0, HeadsetButtons.action(91, true, 0, false, "disconnect"))
        assertEquals(0, HeadsetButtons.action(79, true, 0, false, "mute"))
        assertEquals(3, HeadsetButtons.action(79, true, 0, false, "disconnect"))
        assertEquals(3, HeadsetButtons.action(6, true, 0, false, "mute"))
        assertEquals(1, HeadsetButtons.action(127, true, 0, false, "mute"))
        assertEquals(2, HeadsetButtons.action(126, true, 0, false, "mute"))
        assertNull(HeadsetButtons.action(79, false, 0, false, "mute"))
        assertNull(HeadsetButtons.action(79, true, 1, false, "mute"))
        assertNull(HeadsetButtons.action(79, true, 0, true, "mute"))
        assertFalse(HeadsetButtons.supported(164))
        assertFalse(HeadsetButtons.supported(24))
    }
}
