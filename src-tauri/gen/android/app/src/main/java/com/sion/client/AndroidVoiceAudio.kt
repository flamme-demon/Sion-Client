package com.sion.client

import android.bluetooth.BluetoothHeadset
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioAttributes
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject

/** The foreground voice service owns every listener, timeout and Bluetooth proxy. */
@Suppress("DEPRECATION")
class AndroidVoiceAudio(
    private val context: Context,
    private val handler: Handler,
    private val interruption: (Boolean) -> Unit,
    private val changed: (String) -> Unit,
) : VoiceAudioDriver, VoiceAudioController {
    private val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private val routing = VoiceAudioRouting(this) { state ->
        val json = JSONObject().put("running", state.running).put("selected", state.selected)
            .put("active", state.active ?: JSONObject.NULL).put("pending", state.pending ?: JSONObject.NULL)
            .put("error", state.error ?: JSONObject.NULL).put("interrupted", state.interrupted)
            .put("devices", JSONArray(state.devices.map { d -> JSONObject().put("id", d.id).put("type", d.type).put("name", d.name) }))
        changed(json.toString())
    }
    private var started = false
    private var devicesRegistered = false
    private var broadcastsRegistered = false
    private var telephone = false
    private var hasFocus = false
    private var scoConnected = false
    private var scoRequested = false
    private var headset: BluetoothHeadset? = null
    private var communicationListener: AudioManager.OnCommunicationDeviceChangedListener? = null
    private val focus = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
        .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
        .setAcceptsDelayedFocusGain(true)
        .setOnAudioFocusChangeListener({ value ->
            if (started) {
                hasFocus = value == AudioManager.AUDIOFOCUS_GAIN
                if (hasFocus && audio.mode != AudioManager.MODE_IN_CALL) telephone = false
                if (hasFocus && !telephone && audio.mode != AudioManager.MODE_IN_CALL) audio.mode = AudioManager.MODE_IN_COMMUNICATION
                applyInterruption()
            }
        }, handler).build()
    private val deviceCallback = object : AudioDeviceCallback() {
        override fun onAudioDevicesAdded(added: Array<out AudioDeviceInfo>) { if (started) routing.refresh() }
        override fun onAudioDevicesRemoved(removed: Array<out AudioDeviceInfo>) { if (started) routing.refresh() }
    }
    private val broadcasts = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (!started) return
            if (intent?.action == AudioManager.ACTION_SCO_AUDIO_STATE_UPDATED) {
                scoConnected = intent.getIntExtra(AudioManager.EXTRA_SCO_AUDIO_STATE, -1) == AudioManager.SCO_AUDIO_STATE_CONNECTED
            }
            routing.refresh()
        }
    }
    private val profileListener = object : BluetoothProfile.ServiceListener {
        override fun onServiceConnected(profile: Int, proxy: BluetoothProfile) {
            val h = proxy as? BluetoothHeadset ?: return
            if (!started) { adapter()?.closeProfileProxy(BluetoothProfile.HEADSET, h); return }
            headset = h
            routing.refresh()
        }
        override fun onServiceDisconnected(profile: Int) { headset = null; if (started) routing.refresh() }
    }

    override fun start() {
        if (started) return
        started = true
        audio.registerAudioDeviceCallback(deviceCallback, handler)
        devicesRegistered = true
        if (Build.VERSION.SDK_INT >= 31) {
            val listener = AudioManager.OnCommunicationDeviceChangedListener { if (started) routing.refresh() }
            audio.addOnCommunicationDeviceChangedListener(context.mainExecutor, listener)
            communicationListener = listener
        } else {
            context.registerReceiver(broadcasts, IntentFilter().apply {
                addAction(AudioManager.ACTION_SCO_AUDIO_STATE_UPDATED)
                addAction(BluetoothHeadset.ACTION_CONNECTION_STATE_CHANGED)
            }, null, handler)
            broadcastsRegistered = true
            try { adapter()?.getProfileProxy(context, profileListener, BluetoothProfile.HEADSET) }
            catch (e: SecurityException) { Log.w("SionAudio", "Bluetooth profile unavailable", e) }
        }
        telephone = audio.mode == AudioManager.MODE_IN_CALL
        if (!telephone) audio.mode = AudioManager.MODE_IN_COMMUNICATION
        hasFocus = audio.requestAudioFocus(focus) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
        interruption(telephone || !hasFocus)
        routing.start(telephone || !hasFocus)
        applyInterruption()
    }

    override fun choose(id: String): Boolean = routing.choose(id)

    override fun resume() {
        if (!started) return
        if (telephone || audio.mode == AudioManager.MODE_IN_CALL) { routing.focusError(true); return }
        audio.mode = AudioManager.MODE_IN_COMMUNICATION
        hasFocus = audio.requestAudioFocus(focus) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
        applyInterruption()
        routing.focusError(!hasFocus)
    }

    override fun phoneCall(active: Boolean) {
        if (!started || telephone == active) return
        telephone = active
        if (!active) {
            audio.mode = AudioManager.MODE_IN_COMMUNICATION
            hasFocus = audio.requestAudioFocus(focus) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
        }
        applyInterruption()
    }

    private fun applyInterruption() {
        val suspended = telephone || !hasFocus
        routing.interrupt(suspended)
        interruption(suspended)
    }

    override fun stop() {
        if (!started) return
        started = false
        if (devicesRegistered) audio.unregisterAudioDeviceCallback(deviceCallback)
        devicesRegistered = false
        if (Build.VERSION.SDK_INT >= 31) {
            communicationListener?.let { audio.removeOnCommunicationDeviceChangedListener(it) }
            communicationListener = null
        } else {
            if (broadcastsRegistered) context.unregisterReceiver(broadcasts)
            broadcastsRegistered = false
            headset?.let { adapter()?.closeProfileProxy(BluetoothProfile.HEADSET, it) }
            headset = null
        }
        routing.stop()
        audio.abandonAudioFocusRequest(focus)
        audio.mode = AudioManager.MODE_NORMAL
        interruption(false)
    }

    private fun adapter() = (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter
    private fun legacyHeadsetConnected(): Boolean {
        if (Build.VERSION.SDK_INT >= 31) return false
        // This path uses the normal BLUETOOTH permission declared only through API 30.
        @android.annotation.SuppressLint("MissingPermission")
        val connected = try { headset?.connectedDevices?.isNotEmpty() == true } catch (_: SecurityException) { false }
        return connected
    }
    private fun kind(type: Int): String? = when (type) {
        AudioDeviceInfo.TYPE_BLE_HEADSET, AudioDeviceInfo.TYPE_BLUETOOTH_SCO -> "bluetooth"
        AudioDeviceInfo.TYPE_WIRED_HEADSET, AudioDeviceInfo.TYPE_WIRED_HEADPHONES -> "wired"
        AudioDeviceInfo.TYPE_USB_HEADSET, AudioDeviceInfo.TYPE_USB_DEVICE -> "usb"
        AudioDeviceInfo.TYPE_BUILTIN_SPEAKER -> "speaker"
        AudioDeviceInfo.TYPE_BUILTIN_EARPIECE -> "earpiece"
        AudioDeviceInfo.TYPE_HEARING_AID -> "hearingAid"
        else -> null
    }

    override fun devices(): List<VoiceAudioDevice> {
        val outputs = if (Build.VERSION.SDK_INT >= 31) audio.availableCommunicationDevices
            else audio.getDevices(AudioManager.GET_DEVICES_OUTPUTS).toList()
        val result = outputs.sortedBy { if (it.type == AudioDeviceInfo.TYPE_BLE_HEADSET) 0 else 1 }.mapNotNull { d -> kind(d.type)?.let {
            VoiceAudioDevice(if (Build.VERSION.SDK_INT < 31 && it == "bluetooth") "legacy-bluetooth" else d.id.toString(), it, d.productName.toString())
        } }.distinctBy { it.id }.toMutableList()
        if (Build.VERSION.SDK_INT < 31) {
            if (result.none { it.type == "bluetooth" } && legacyHeadsetConnected()) result.add(VoiceAudioDevice("legacy-bluetooth", "bluetooth", "Bluetooth"))
            // Legacy Android cannot force the earpiece over a plugged wired headset.
            if (result.any { it.type == "wired" || it.type == "usb" }) result.removeAll { it.type == "earpiece" }
        }
        return result
    }

    override fun currentDevice(): String? {
        if (Build.VERSION.SDK_INT >= 31) return audio.communicationDevice?.id?.toString()
        if (scoConnected) return "legacy-bluetooth"
        val type = if (audio.isSpeakerphoneOn) "speaker" else devices().firstOrNull { it.type == "wired" || it.type == "usb" }?.type ?: "earpiece"
        return devices().firstOrNull { it.type == type }?.id
    }

    override fun select(device: VoiceAudioDevice): Boolean = try {
        if (Build.VERSION.SDK_INT >= 31) {
            val info = audio.availableCommunicationDevices.firstOrNull { it.id.toString() == device.id }
            info != null && audio.setCommunicationDevice(info)
        } else {
            if (device.type == "bluetooth") {
                audio.isSpeakerphoneOn = false
                if (!scoRequested) { scoRequested = true; audio.startBluetoothSco() }
            } else {
                stopSco()
                audio.isSpeakerphoneOn = device.type == "speaker"
            }
            true
        }
    } catch (e: RuntimeException) { Log.w("SionAudio", "Audio route rejected", e); false }

    private fun stopSco() {
        if (scoRequested || scoConnected) audio.stopBluetoothSco()
        scoRequested = false
    }

    override fun clear() {
        if (Build.VERSION.SDK_INT >= 31) audio.clearCommunicationDevice()
        else { stopSco(); audio.isSpeakerphoneOn = false }
    }

    override fun later(delayMs: Long, action: () -> Unit): () -> Unit {
        val task = Runnable(action)
        handler.postDelayed(task, delayMs)
        return { handler.removeCallbacks(task) }
    }
}
