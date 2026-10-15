package com.sion.client

import org.junit.Assert.*
import org.junit.Test

class HeadsetMicrophoneTest {
    @Test fun initialUnmutedHardwareDoesNotUnmuteTheApplication() {
        val state = HeadsetMicrophone()
        assertNull(state.changed(false))
        assertNull(state.changed(false))
        assertEquals(1, state.changed(true))
        assertNull(state.changed(true))
        assertEquals(2, state.changed(false))
    }

    @Test fun initiallyMutedHardwareIsRespectedAndRepeatedBroadcastsAreIgnored() {
        val state = HeadsetMicrophone()
        assertEquals(1, state.changed(true))
        repeat(32) {
            assertNull(state.changed(true))
            assertEquals(2, state.changed(false))
            assertNull(state.changed(false))
            assertEquals(1, state.changed(true))
        }
    }
}
