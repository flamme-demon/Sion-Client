package com.sion.client

import org.junit.Assert.*
import org.junit.Test

class VoiceMicrophoneSyncTest {
    private class Driver(canRequest: Boolean = true) {
        var platform = false
        var headset = false
        val requests = mutableListOf<Pair<Boolean, (Boolean) -> Unit>>()
        val changes = mutableListOf<Boolean>()
        val timers = mutableListOf<Pair<() -> Unit, BooleanArray>>()
        val sync = VoiceMicrophoneSync(canRequest, { platform }, { headset },
            { value, completed -> requests.add(value to completed) }, { value -> changes.add(value); syncDesired(value) },
            { delay, action ->
                assertEquals(350L, delay)
                val canceled = booleanArrayOf(false)
                timers.add(action to canceled)
                val cancel: () -> Unit = { canceled[0] = true }
                cancel
            })
        private fun syncDesired(value: Boolean) { sync.desired(value) }
        fun complete() {
            val (value, completed) = requests.removeAt(0)
            platform = value
            sync.platform(value)
            completed(true)
        }
        fun settle() { while (requests.isNotEmpty()) complete() }
        fun platform(value: Boolean) { platform = value; sync.platform(value) }
        fun tick() { val task = timers.first { !it.second[0] }; task.second[0] = true; task.first() }
        fun attach() { headset = true; sync.route("headset", true); sync.devicesChanged() }
        fun detach() { headset = false; sync.devicesChanged(); sync.route("speaker", false) }
        fun startMuted() { sync.desired(true); sync.route("speaker", false); sync.active(true); settle() }
    }

    @Test fun attachingWhileMutedSynchronizesTheHeadsetBeforeItsFirstUnmute() {
        val d = Driver()
        d.startMuted()
        assertTrue(d.platform)
        d.attach()
        assertEquals(false, d.requests.single().first)
        d.complete()
        assertTrue(d.sync.muted)
        assertEquals(true, d.requests.single().first)
        d.complete()
        assertTrue(d.changes.isEmpty())
        d.platform(false)
        assertTrue(d.sync.muted)
        d.tick()
        assertEquals(listOf(false), d.changes)
        assertFalse(d.sync.muted)
    }

    @Test fun unpluggingMutedNeverOpensTheSpeakerMicrophoneForEitherCallbackOrder() {
        for (muteResetFirst in listOf(false, true)) {
            val d = Driver()
            d.startMuted(); d.attach(); d.settle()
            if (muteResetFirst) d.platform(false)
            d.detach()
            if (!muteResetFirst) d.platform(false)
            d.settle()
            d.timers.forEach { it.first() }
            assertTrue(d.sync.muted)
            assertTrue(d.platform)
            assertTrue(d.changes.isEmpty())
            assertTrue(d.timers.all { it.second[0] })
        }
    }

    @Test fun unpluggingAnOpenMicrophoneKeepsItsExistingState() {
        val d = Driver()
        d.sync.active(true); d.attach(); d.detach(); d.platform(false)
        assertFalse(d.sync.muted)
        assertTrue(d.requests.isEmpty())
        assertTrue(d.changes.isEmpty())
    }

    @Test fun pushToTalkReleaseCancelsAnEarlierHeadsetUnmute() {
        val d = Driver()
        d.startMuted(); d.attach(); d.settle()
        d.platform(false)
        val stale = d.timers.single().first
        d.sync.desired(false)
        d.sync.desired(true)
        d.settle()
        stale()
        assertTrue(d.sync.muted)
        assertTrue(d.changes.isEmpty())
        assertTrue(d.timers.single().second[0])
    }

    @Test fun nativeIntentCanChangeDuringTheHeadsetHandshakeWithoutFeedback() {
        val d = Driver()
        d.startMuted(); d.attach()
        d.sync.desired(false)
        d.complete()
        assertFalse(d.sync.muted)
        assertTrue(d.requests.isEmpty())
        d.sync.desired(true); d.complete()
        assertTrue(d.sync.muted)
        assertTrue(d.changes.isEmpty())
    }

    @Test fun aRouteChangeDuringTheHandshakePreservesMuteAndInvalidatesOldUnmute() {
        val d = Driver()
        d.startMuted(); d.attach(); d.detach(); d.complete(); d.settle()
        d.platform(false); d.settle()
        assertTrue(d.sync.muted)
        assertTrue(d.platform)
        assertTrue(d.changes.isEmpty())
    }

    @Test fun hardwareMuteIsImmediateAndStalePlatformCallbacksCannotUnmute() {
        val d = Driver()
        d.sync.active(true); d.attach()
        d.platform(true)
        assertEquals(listOf(true), d.changes)
        d.sync.platform(false)
        assertTrue(d.sync.muted)
        assertTrue(d.timers.isEmpty())
    }

    @Test fun interruptionsAndRepeatedTeardownCancelPendingHardwareActions() {
        repeat(32) {
            val d = Driver()
            d.startMuted(); d.attach(); d.settle(); d.platform(false)
            val stale = d.timers.single().first
            d.sync.active(false)
            stale()
            assertTrue(d.changes.isEmpty())
            d.sync.active(true)
            val late = d.requests.single().second
            d.sync.stop(); d.sync.stop()
            late(true)
            d.sync.platform(false)
            d.sync.route("new-headset", true)
            stale()
            assertTrue(d.changes.isEmpty())
            assertTrue(d.timers.all { it.second[0] })
        }
    }

    @Test fun aRejectedPlatformRequestKeepsNativeMuteAndCanBeRetriedExplicitly() {
        val d = Driver()
        d.sync.desired(true); d.sync.active(true)
        d.requests.removeAt(0).second(false)
        assertTrue(d.sync.muted)
        assertTrue(d.requests.isEmpty())
        d.sync.active(true); d.complete()
        assertTrue(d.platform)
        assertTrue(d.changes.isEmpty())
    }

    @Test fun acknowledgementsBeforeThePlatformBroadcastDoNotLoopOrOpenTheMicrophone() {
        val d = Driver()
        d.sync.desired(true); d.sync.active(true)
        d.requests.removeAt(0).second(true)
        assertTrue(d.requests.isEmpty())
        d.platform(true)
        d.attach()
        d.requests.removeAt(0).second(true)
        assertEquals(true, d.requests.single().first)
        d.requests.removeAt(0).second(true)
        d.sync.platform(false)
        assertTrue(d.requests.isEmpty())
        assertTrue(d.changes.isEmpty())
        assertTrue(d.sync.muted)
    }

    @Test fun latestPushToTalkIntentWinsWhenPlatformReadsLagBehindAnAcknowledgement() {
        val d = Driver()
        d.sync.desired(true); d.sync.active(true)
        d.requests.removeAt(0).second(true)
        assertFalse(d.platform)
        d.sync.desired(false)
        assertEquals(false, d.requests.single().first)
        d.platform(true)
        d.complete()
        assertFalse(d.sync.muted)
        assertFalse(d.platform)
        assertTrue(d.changes.isEmpty())
    }

    @Test fun olderTelecomDoesNotTreatInitialOrUnplugMuteResetsAsUnmute() {
        val d = Driver(canRequest = false)
        d.sync.desired(true); d.sync.active(true); d.sync.platform(false)
        assertTrue(d.sync.muted)
        d.attach(); d.platform(true); d.platform(false); d.tick()
        assertFalse(d.sync.muted)
        d.platform(true)
        d.detach(); d.platform(false)
        assertTrue(d.sync.muted)
        assertTrue(d.requests.isEmpty())
        assertEquals(listOf(false, true), d.changes)
    }
}
