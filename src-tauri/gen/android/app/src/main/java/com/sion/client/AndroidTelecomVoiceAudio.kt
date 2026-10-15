package com.sion.client

import android.content.ComponentName
import android.content.Context
import android.media.AudioManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.OutcomeReceiver
import android.telecom.CallAttributes
import android.telecom.CallControl
import android.telecom.CallControlCallback
import android.telecom.CallEndpoint
import android.telecom.CallEventCallback
import android.telecom.CallException
import android.telecom.DisconnectCause
import android.telecom.PhoneAccount
import android.telecom.PhoneAccountHandle
import android.telecom.TelecomManager
import android.util.Log
import androidx.annotation.RequiresApi
import org.json.JSONArray
import org.json.JSONObject
import java.util.function.Consumer

/** Telecom owns focus and HFP call controls; the service owns this one call. */
@RequiresApi(34)
class AndroidTelecomVoiceAudio(
    private val context: Context,
    private val handler: Handler,
    private val name: String,
    private val interruption: (Boolean) -> Unit,
    private val changed: (String) -> Unit,
    private val microphone: (Boolean) -> Unit,
    private val disconnected: () -> Unit,
    private val notification: () -> Unit,
) : VoiceAudioController, VoiceAudioDriver {
    private val telecom = context.getSystemService(TelecomManager::class.java)
    private val audio = context.getSystemService(AudioManager::class.java)
    private val executor = context.mainExecutor
    private val account = PhoneAccountHandle(ComponentName(context, VoiceCallService::class.java), "sion-voice")
    private val lifetime = VoiceCallLifetime<CallControl> { call ->
        try {
            call.disconnect(DisconnectCause(DisconnectCause.LOCAL), executor, object : OutcomeReceiver<Void, CallException> {
                override fun onResult(result: Void?) {}
                override fun onError(error: CallException) { Log.w("SionAudio", "Telecom disconnect: ${error.code}") }
            })
        } catch (error: RuntimeException) {
            // A dead platform binder must not prevent the remaining teardown.
            Log.w("SionAudio", "Telecom disconnect failed", error)
        }
    }
    private val routing = VoiceAudioRouting(this) { state ->
        changed(JSONObject().put("running", state.running).put("selected", state.selected)
            .put("active", state.active ?: JSONObject.NULL).put("pending", state.pending ?: JSONObject.NULL)
            .put("error", state.error ?: JSONObject.NULL).put("interrupted", state.interrupted)
            .put("devices", JSONArray(state.devices.map { d -> JSONObject().put("id", d.id).put("type", d.type).put("name", d.name) })).toString())
    }
    private var started = false
    private var registered = false
    private var creating = false
    private var active = false
    private var telephone = false
    private var endpoints = emptyList<CallEndpoint>()
    private var endpoint: String? = null
    private var routeRequest = 0L
    private val microphoneSync = VoiceMicrophoneSync(Build.VERSION.SDK_INT >= 35,
        { audio.isMicrophoneMute }, { bluetoothPresent() }, ::requestMute, microphone, ::later)

    private fun bluetoothPresent(): Boolean = audio.availableCommunicationDevices.any {
        it.type == android.media.AudioDeviceInfo.TYPE_BLUETOOTH_SCO ||
            it.type == android.media.AudioDeviceInfo.TYPE_BLE_HEADSET ||
            it.type == android.media.AudioDeviceInfo.TYPE_BLE_SPEAKER ||
            it.type == android.media.AudioDeviceInfo.TYPE_HEARING_AID
    }

    private fun updateMicrophoneRoute() {
        val selected = endpoints.firstOrNull { it.identifier.toString() == endpoint }
        microphoneSync.route(endpoint, selected?.endpointType == CallEndpoint.TYPE_BLUETOOTH)
    }

    override fun start() {
        if (started) return
        started = true
        routing.start(interrupted = true)
        interruption(true)
        telecom.registerPhoneAccount(PhoneAccount.builder(account, "Sion")
            .setCapabilities(PhoneAccount.CAPABILITY_SUPPORTS_TRANSACTIONAL_OPERATIONS)
            .setSupportedUriSchemes(listOf(PhoneAccount.SCHEME_SIP)).build())
        registered = true
        addCall()
    }

    private fun addCall() {
        if (!started || creating) return
        creating = true
        val token = lifetime.begin()
        currentToken = token
        val attributes = CallAttributes.Builder(account, CallAttributes.DIRECTION_OUTGOING, name,
            Uri.fromParts(PhoneAccount.SCHEME_SIP, "sion", null))
            .setCallType(CallAttributes.AUDIO_CALL).setCallCapabilities(CallAttributes.SUPPORTS_SET_INACTIVE).build()
        transaction({ creating = false; routing.focusError(true) }) {
            telecom.addCall(attributes, executor, object : OutcomeReceiver<CallControl, CallException> {
                override fun onResult(result: CallControl) {
                    if (!lifetime.accept(token, result)) return
                    creating = false
                    notification()
                    resume()
                }
                override fun onError(error: CallException) {
                    if (!lifetime.current(token)) return
                    creating = false
                    Log.e("SionAudio", "Telecom add call: ${error.code}")
                    routing.focusError(true)
                }
            }, object : CallControlCallback {
                override fun onSetActive(completed: Consumer<Boolean>) = setActive(token, true, completed)
                override fun onSetInactive(completed: Consumer<Boolean>) = setActive(token, false, completed)
                override fun onAnswer(videoState: Int, completed: Consumer<Boolean>) = setActive(token, true, completed)
                override fun onDisconnect(cause: DisconnectCause, completed: Consumer<Boolean>) {
                    val accepted = lifetime.ended(token)
                    completed.accept(accepted)
                    if (accepted) {
                        Log.i("SionAudio", "Telecom hangup: ${cause.code}")
                        active = false
                        interruption(true)
                        disconnected()
                    }
                }
                override fun onCallStreamingStarted(completed: Consumer<Boolean>) { completed.accept(false) }
            }, object : CallEventCallback {
                override fun onCallEndpointChanged(value: CallEndpoint) {
                    if (!lifetime.current(token)) return
                    endpoint = value.identifier.toString()
                    updateMicrophoneRoute()
                    routing.refresh()
                }
                override fun onAvailableCallEndpointsChanged(values: MutableList<CallEndpoint>) {
                    if (!lifetime.current(token)) return
                    endpoints = values.toList()
                    updateMicrophoneRoute()
                    microphoneSync.devicesChanged()
                    routing.refresh()
                }
                override fun onMuteStateChanged(value: Boolean) {
                    if (!lifetime.current(token)) return
                    microphoneSync.platform(value)
                }
                override fun onCallStreamingFailed(reason: Int) { Log.w("SionAudio", "Telecom streaming rejected: $reason") }
                override fun onEvent(event: String, extras: Bundle) {}
            })
        }
    }

    private fun setActive(token: Long, value: Boolean, completed: Consumer<Boolean>) {
        val accepted = lifetime.current(token)
        if (accepted) {
            active = value
            telephone = !value
            applyInterruption()
        }
        completed.accept(accepted)
    }

    private fun applyInterruption() {
        val suspended = !active || telephone
        interruption(suspended)
        routing.interrupt(suspended)
        microphoneSync.active(!suspended)
    }

    override fun resume() {
        if (!started || audio.mode == AudioManager.MODE_IN_CALL) { routing.focusError(true); return }
        val call = lifetime.control
        if (call == null) { addCall(); return }
        val token = currentToken
        transaction({ routing.focusError(true) }) {
            call.setActive(executor, outcome(token, {
                active = true
                telephone = false
                applyInterruption()
                routing.focusError(false)
            }, { routing.focusError(true) }))
        }
    }

    private var currentToken = 0L
    override fun choose(id: String) = routing.choose(id)
    override fun phoneCall(active: Boolean) {
        telephone = active
        if (active) applyInterruption() else resume()
    }

    override fun muteChanged(muted: Boolean) {
        microphoneSync.desired(muted)
    }

    private fun requestMute(muted: Boolean, completed: (Boolean) -> Unit) {
        val call = lifetime.control
        if (Build.VERSION.SDK_INT < 35 || call == null || !active || telephone) { completed(false); return }
        transaction({ completed(false) }) {
            call.requestMuteState(muted, executor, outcome(currentToken, { completed(true) }, { completed(false) }))
        }
    }

    private fun transaction(failure: () -> Unit, operation: () -> Unit) {
        try { operation() }
        catch (error: RuntimeException) {
            Log.w("SionAudio", "Telecom transaction failed", error)
            failure()
        }
    }

    private fun outcome(token: Long, success: () -> Unit, failure: () -> Unit) = object : OutcomeReceiver<Void, CallException> {
        override fun onResult(result: Void?) { if (lifetime.current(token)) success() }
        override fun onError(error: CallException) {
            if (!lifetime.current(token)) return
            Log.w("SionAudio", "Telecom operation: ${error.code}")
            failure()
        }
    }

    override fun stop() {
        if (!started) return
        started = false
        microphoneSync.stop()
        lifetime.stop()
        routing.stop()
        endpoints = emptyList()
        endpoint = null
        val unregister = registered
        registered = false
        if (unregister) {
            try { telecom.unregisterPhoneAccount(account) }
            catch (error: RuntimeException) { Log.w("SionAudio", "Telecom account cleanup failed", error) }
        }
    }

    override fun devices() = endpoints.mapNotNull { endpoint ->
        val type = when (endpoint.endpointType) {
            CallEndpoint.TYPE_BLUETOOTH -> "bluetooth"
            CallEndpoint.TYPE_WIRED_HEADSET -> "wired"
            CallEndpoint.TYPE_SPEAKER -> "speaker"
            CallEndpoint.TYPE_EARPIECE -> "earpiece"
            else -> null
        }
        type?.let { VoiceAudioDevice(endpoint.identifier.toString(), it, endpoint.endpointName.toString()) }
    }
    override fun currentDevice() = endpoint
    override fun select(device: VoiceAudioDevice): Boolean {
        val call = lifetime.control ?: return false
        val target = endpoints.firstOrNull { it.identifier.toString() == device.id } ?: return false
        val request = ++routeRequest
        return try {
            call.requestCallEndpointChange(target, executor, outcome(currentToken, {}, { if (request == routeRequest) routing.rejected(device.id) }))
            true
        } catch (error: RuntimeException) {
            Log.w("SionAudio", "Telecom endpoint request failed", error)
            false
        }
    }
    override fun clear() { routeRequest++ }
    override fun later(delayMs: Long, action: () -> Unit): () -> Unit {
        val task = Runnable(action)
        handler.postDelayed(task, delayMs)
        return { handler.removeCallbacks(task) }
    }
}
