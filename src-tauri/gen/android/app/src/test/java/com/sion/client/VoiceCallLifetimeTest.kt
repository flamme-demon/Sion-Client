package com.sion.client

import org.junit.Assert.*
import org.junit.Test

class VoiceCallLifetimeTest {
    @Test fun repeatedCallsReleaseTheirControlsAndRejectLateCallbacks() {
        val closed = mutableListOf<String>()
        val owner = VoiceCallLifetime<String> { closed.add(it) }
        repeat(32) { cycle ->
            val token = owner.begin()
            assertTrue(owner.accept(token, "call-$cycle"))
            assertEquals("call-$cycle", owner.control)
            owner.stop()
            owner.stop()
            assertNull(owner.control)
            assertFalse(owner.current(token))
            assertFalse(owner.accept(token, "late-$cycle"))
        }
        assertEquals(64, closed.size)
        assertEquals(64, closed.toSet().size)
    }

    @Test fun cancellationDuringSetupCannotAttachToTheNextCall() {
        val closed = mutableListOf<String>()
        val owner = VoiceCallLifetime<String> { closed.add(it) }
        val canceled = owner.begin()
        owner.stop()
        val next = owner.begin()
        assertTrue(owner.accept(next, "next"))
        assertFalse(owner.accept(canceled, "canceled"))
        assertEquals("next", owner.control)
        assertFalse(owner.ended(canceled))
        assertTrue(owner.current(next))
        assertEquals(listOf("canceled"), closed)
        owner.stop()
        assertEquals(listOf("canceled", "next"), closed)
    }

    @Test fun platformHangupDoesNotDisconnectTwiceOrKeepTheHandle() {
        val closed = mutableListOf<String>()
        val owner = VoiceCallLifetime<String> { closed.add(it) }
        val token = owner.begin()
        owner.accept(token, "call")
        assertTrue(owner.ended(token))
        assertFalse(owner.ended(token))
        owner.stop()
        assertNull(owner.control)
        assertTrue(closed.isEmpty())
    }
}
