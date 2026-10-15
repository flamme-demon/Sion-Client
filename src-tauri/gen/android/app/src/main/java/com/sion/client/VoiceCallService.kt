package com.sion.client

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.BroadcastReceiver
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.media.AudioManager
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.telephony.PhoneStateListener
import android.telephony.TelephonyManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.IBinder
import android.os.PowerManager
import android.view.KeyEvent
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

class VoiceCallService : Service() {

    companion object {
        const val CHANNEL_ID = "sion_voice_call"
        const val NOTIFICATION_ID = 1001
        const val ACTION_MUTE = "com.sion.client.MUTE"
        const val ACTION_DEAFEN = "com.sion.client.DEAFEN"
        const val ACTION_DISCONNECT = "com.sion.client.DISCONNECT"
        /** Appel téléphonique décroché / terminé : Sion se met en sourdine
         *  pendant l'appel, puis rétablit son état. */
        const val ACTION_APPEL_DEBUT = "com.sion.client.APPEL_DEBUT"
        const val ACTION_APPEL_FIN = "com.sion.client.APPEL_FIN"
        const val EXTRA_CHANNEL_NAME = "channel_name"
        const val EXTRA_IS_MUTED = "is_muted"
        const val EXTRA_IS_DEAFENED = "is_deafened"

        var isRunning = false
            private set

        private val pendingActions = mutableListOf<String>()
        private var currentMuted = false
        private var currentDeafened = false
        private var currentChannelName = "Voice"
        @Volatile private var instance: VoiceCallService? = null
        @Volatile var audioState = "{\"running\":false,\"selected\":\"auto\",\"devices\":[]}"
            private set
        @Volatile var headsetAction = "mute"

        fun chooseAudio(id: String): Boolean {
            val service = instance ?: return false
            val state = org.json.JSONObject(audioState)
            val devices = state.optJSONArray("devices") ?: return false
            if (!state.optBoolean("running") || (id != "auto" && (0 until devices.length()).none { devices.getJSONObject(it).getString("id") == id })) return false
            service.handler.post { if (instance === service && isRunning) service.audioRouting?.choose(id) }
            return true
        }

        fun chooseAudioType(type: String): Boolean {
            val devices = org.json.JSONObject(audioState).optJSONArray("devices") ?: return false
            val id = (0 until devices.length()).map { devices.getJSONObject(it) }.firstOrNull { it.optString("type") == type }?.optString("id") ?: return false
            return chooseAudio(id)
        }

        fun headsetButton(event: KeyEvent): Boolean = instance?.handleHeadsetButton(event) ?: false

        fun resumeAudio(): Boolean {
            val service = instance ?: return false
            service.handler.post { if (instance === service && isRunning) service.audioRouting?.resume() }
            return true
        }

        fun consumePendingAction(): String {
            synchronized(pendingActions) {
                if (pendingActions.isEmpty()) return ""
                return pendingActions.removeAt(0)
            }
        }

        fun start(context: Context, channelName: String, isMuted: Boolean = false, isDeafened: Boolean = false) {
            val intent = Intent(context, VoiceCallService::class.java).apply {
                putExtra(EXTRA_CHANNEL_NAME, channelName)
                putExtra(EXTRA_IS_MUTED, isMuted)
                putExtra(EXTRA_IS_DEAFENED, isDeafened)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            isRunning = false
            context.stopService(Intent(context, VoiceCallService::class.java))
        }

        fun update(context: Context, channelName: String, isMuted: Boolean, isDeafened: Boolean) {
            if (!isRunning) return
            start(context, channelName, isMuted, isDeafened)
        }
    }

    private var wakeLock: PowerManager.WakeLock? = null
    private val handler = Handler(Looper.getMainLooper())
    private var audioRouting: VoiceAudioController? = null
    private var headsetSession: MediaSession? = null
    private var nativeSession = -1L
    private var audioStarted = false
    private val hardwareMicrophone = HeadsetMicrophone()
    private var microphoneRegistered = false
    private var reportedMute: Boolean? = null
    private val usesTelecom: Boolean
        get() = Build.VERSION.SDK_INT >= 34 && packageManager.hasSystemFeature(android.content.pm.PackageManager.FEATURE_TELECOM)
    private val microphoneReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == AudioManager.ACTION_MICROPHONE_MUTE_CHANGED) {
                hardwareMicrophoneChanged(getSystemService(AudioManager::class.java).isMicrophoneMute)
            }
        }
    }
    private val headsetSync = object : Runnable {
        override fun run() {
            if (!isRunning || nativeSession == 0L || nativeSession != SionNatif.sessionVoix()) { stopSelf(); return }
            refreshHeadsetState()
            handler.postDelayed(this, 500)
        }
    }

    private fun hardwareMicrophoneChanged(muted: Boolean) {
        val action = hardwareMicrophone.changed(muted) ?: return
        if (isRunning && !appelEnCours && !org.json.JSONObject(audioState).optBoolean("interrupted")) {
            headsetCommand(action, "microphone-system")
        }
    }

    private fun refreshHeadsetState() {
        val muted = SionNatif.microCoupe(nativeSession)
        currentMuted = muted
        if (reportedMute != muted) {
            reportedMute = muted
            headsetSession?.setPlaybackState(PlaybackState.Builder()
                .setState(if (muted) PlaybackState.STATE_PAUSED else PlaybackState.STATE_PLAYING, 0, 1f)
                .setActions(PlaybackState.ACTION_PLAY_PAUSE or PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or PlaybackState.ACTION_STOP).build())
            getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID,
                buildNotification(currentChannelName, muted, currentDeafened))
        }
        audioRouting?.muteChanged(muted)
    }

    private fun startAudio() {
        if (audioStarted) return
        audioStarted = true
        try {
            nativeSession = SionNatif.sessionVoix()
            headsetSession = MediaSession(this, "SionVoice").apply {
                setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS or MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS)
                // Headset buttons must not restart an ended voice call.
                setMediaButtonReceiver(null)
                setPlaybackToLocal(android.media.AudioAttributes.Builder()
                    .setUsage(android.media.AudioAttributes.USAGE_VOICE_COMMUNICATION)
                    .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SPEECH).build())
                setCallback(object : MediaSession.Callback() {
                    override fun onMediaButtonEvent(intent: Intent): Boolean {
                        @Suppress("DEPRECATION") val event = intent.getParcelableExtra<KeyEvent>(Intent.EXTRA_KEY_EVENT) ?: return false
                        return handleHeadsetButton(event)
                    }
                    override fun onPlay() = headsetCommand(2)
                    override fun onPause() = headsetCommand(1)
                    override fun onStop() = headsetCommand(3)
                }, handler)
                isActive = true
            }
            val interrupted: (Boolean) -> Unit = { interrupted ->
                SionNatif.interruptionVoix(nativeSession, interrupted)
                headsetSession?.isActive = !interrupted
            }
            val changed: (String) -> Unit = { state ->
                if (state != audioState) android.util.Log.i("SionAudio", "Communication route: $state")
                audioState = state
                sendBroadcast(Intent("com.sion.client.VOICE_AUDIO").setPackage(packageName).putExtra("state", state))
            }
            audioRouting = if (usesTelecom && Build.VERSION.SDK_INT >= 34) AndroidTelecomVoiceAudio(this, handler, currentChannelName,
                interrupted, changed, { muted -> headsetCommand(if (muted) 1 else 2, "telecom-microphone") }, { headsetCommand(3, "telecom") }, {
                    getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID,
                        buildNotification(currentChannelName, currentMuted, currentDeafened))
                }) else AndroidVoiceAudio(this, handler, interrupted, changed)
            hardwareMicrophoneChanged(getSystemService(AudioManager::class.java).isMicrophoneMute)
            // Telecom distinguishes our mute acknowledgements from headset actions.
            // Reading the same changes through a second receiver would feed them back.
            if (!usesTelecom) {
                ContextCompat.registerReceiver(this, microphoneReceiver,
                    IntentFilter(AudioManager.ACTION_MICROPHONE_MUTE_CHANGED), ContextCompat.RECEIVER_NOT_EXPORTED)
                microphoneRegistered = true
            }
            refreshHeadsetState()
            audioRouting?.start()
            handler.post(headsetSync)
        }
        catch (e: RuntimeException) {
            android.util.Log.e("SionAudio", "Audio initialization failed", e)
            SionNatif.actionCasque(nativeSession, 3)
            stopSelf()
        }
    }

    private fun handleHeadsetButton(event: KeyEvent): Boolean {
        if (!isRunning || appelEnCours || org.json.JSONObject(audioState).optBoolean("interrupted") || !HeadsetButtons.supported(event.keyCode)) return false
        HeadsetButtons.action(event.keyCode, event.action == KeyEvent.ACTION_DOWN, event.repeatCount, event.isCanceled, headsetAction)?.let { headsetCommand(it, "key-${event.keyCode}") }
        return true
    }

    private fun headsetCommand(action: Int, source: String = "media") {
        if (!isRunning || (appelEnCours && source != "telecom")) return
        android.util.Log.i("SionAudio", "Headset command: source=$source action=$action")
        SionNatif.actionCasque(nativeSession, action)
        if (action == 3) stopSelf()
        else refreshHeadsetState()
    }

    // ── Appel téléphonique ──────────────────────────────────────────────
    // Décroché : sourdine (micro coupé, plus rien entendu du salon) ;
    // raccroché : état d'avant rétabli (côté interface, `__SION_VOICE_ACTION__`).
    private var appelEnCours = false
    private var ecouteMode: AudioManager.OnModeChangedListener? = null
    @Suppress("DEPRECATION")
    private var ecouteTelephone: PhoneStateListener? = null

    private fun signalerAppel(enAppel: Boolean) {
        if (enAppel == appelEnCours) return
        appelEnCours = enAppel
        sendBroadcast(Intent("com.sion.client.VOICE_ACTION").apply {
            putExtra("action", if (enAppel) ACTION_APPEL_DEBUT else ACTION_APPEL_FIN)
            setPackage(packageName)
        })
        audioRouting?.phoneCall(enAppel)
    }

    @Suppress("DEPRECATION")
    private fun suivreAppelsTelephoniques() {
        val am = getSystemService(Context.AUDIO_SERVICE) as AudioManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            // Mode audio global : IN_CALL = appel téléphonique décroché (le
            // nôtre est IN_COMMUNICATION). La sonnerie seule ne coupe rien.
            val ecoute = AudioManager.OnModeChangedListener { mode ->
                signalerAppel(mode == AudioManager.MODE_IN_CALL)
            }
            am.addOnModeChangedListener(mainExecutor, ecoute)
            ecouteMode = ecoute
            signalerAppel(am.mode == AudioManager.MODE_IN_CALL)
        } else {
            val tm = getSystemService(Context.TELEPHONY_SERVICE) as TelephonyManager
            val ecoute = object : PhoneStateListener() {
                override fun onCallStateChanged(state: Int, phoneNumber: String?) {
                    signalerAppel(state == TelephonyManager.CALL_STATE_OFFHOOK)
                }
            }
            try {
                tm.listen(ecoute, PhoneStateListener.LISTEN_CALL_STATE)
                ecouteTelephone = ecoute
            } catch (_: SecurityException) {
                // Audio focus still suspends Sion without the phone-state permission.
            }
        }
    }

    @Suppress("DEPRECATION")
    private fun cesserSuivreAppels() {
        val am = getSystemService(Context.AUDIO_SERVICE) as AudioManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            ecouteMode?.let { am.removeOnModeChangedListener(it) }
        } else {
            val tm = getSystemService(Context.TELEPHONY_SERVICE) as TelephonyManager
            ecouteTelephone?.let { tm.listen(it, PhoneStateListener.LISTEN_NONE) }
        }
        ecouteMode = null
        ecouteTelephone = null
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()

        // Acquire partial wake lock to keep CPU running for audio processing
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "sion:voicecall").apply {
            acquire()
        }
        isRunning = true
        instance = this
        suivreAppelsTelephoniques()
    }

    /**
     * Appli balayée des récentes : on quitte l'appel proprement (départ
     * MatrixRTC puis LiveKit, voir android_natif.rs) avant de s'arrêter.
     * Sans ça, la voix continuait sans interface et « Quitter » ne répondait
     * plus — les autres voyaient un participant fantôme (29/09).
     */
    override fun onTaskRemoved(rootIntent: Intent?) {
        try {
            SionNatif.quitterVoix()
        } catch (_: Throwable) {
        }
        stop(this)
        stopSelf()
        super.onTaskRemoved(rootIntent)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (SionNatif.sessionVoix() == 0L) {
            stopSelf()
            return START_NOT_STICKY
        }
        // Handle action intents from notification buttons
        when (intent?.action) {
            ACTION_MUTE -> {
                currentMuted = !currentMuted
                // If unmuting, bring app to foreground (Android blocks mic capture in background)
                if (!currentMuted) {
                    val bringToFront = Intent(this, MainActivity::class.java)
                    bringToFront.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                    startActivity(bringToFront)
                }
                sendBroadcast(Intent("com.sion.client.VOICE_ACTION").apply {
                    putExtra("action", ACTION_MUTE)
                    setPackage(packageName)
                })
                val notification = buildNotification(currentChannelName, currentMuted, currentDeafened)
                val manager = getSystemService(NotificationManager::class.java)
                manager.notify(NOTIFICATION_ID, notification)
                return START_STICKY
            }
            ACTION_DEAFEN -> {
                currentDeafened = !currentDeafened
                sendBroadcast(Intent("com.sion.client.VOICE_ACTION").apply {
                    putExtra("action", ACTION_DEAFEN)
                    setPackage(packageName)
                })
                val notification = buildNotification(currentChannelName, currentMuted, currentDeafened)
                val manager = getSystemService(NotificationManager::class.java)
                manager.notify(NOTIFICATION_ID, notification)
                return START_STICKY
            }
            ACTION_DISCONNECT -> {
                sendBroadcast(Intent("com.sion.client.VOICE_ACTION").apply {
                    putExtra("action", ACTION_DISCONNECT)
                    setPackage(packageName)
                })
                stopSelf()
                return START_NOT_STICKY
            }
        }

        // Normal start/update — store state
        val channelName = intent?.getStringExtra(EXTRA_CHANNEL_NAME) ?: currentChannelName
        val isMuted = intent?.getBooleanExtra(EXTRA_IS_MUTED, currentMuted) ?: currentMuted
        val isDeafened = intent?.getBooleanExtra(EXTRA_IS_DEAFENED, currentDeafened) ?: currentDeafened
        currentChannelName = channelName
        currentMuted = isMuted
        currentDeafened = isDeafened

        val notification = buildNotification(channelName, isMuted, isDeafened)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIFICATION_ID, notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE or
                    (if (usesTelecom) ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL else 0))
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
        // Android 15 requires foreground ownership before requesting audio focus.
        startAudio()
        refreshHeadsetState()
        return START_STICKY
    }

    override fun onDestroy() {
        isRunning = false
        instance = null
        handler.removeCallbacksAndMessages(null)
        if (microphoneRegistered) unregisterReceiver(microphoneReceiver)
        microphoneRegistered = false
        cesserSuivreAppels()
        headsetSession?.isActive = false
        headsetSession?.release()
        headsetSession = null
        audioRouting?.stop()
        audioRouting = null
        wakeLock?.let {
            if (it.isHeld) it.release()
        }
        wakeLock = null
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Appel vocal",
                NotificationManager.IMPORTANCE_DEFAULT
            ).apply {
                description = "Notification pendant un appel vocal"
                setShowBadge(false)
                setSound(null, null)
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(channelName: String, isMuted: Boolean, isDeafened: Boolean): Notification {
        val openIntent = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val muteIntent = PendingIntent.getService(
            this, 1,
            Intent(this, VoiceCallService::class.java).apply { action = ACTION_MUTE },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val deafenIntent = PendingIntent.getService(
            this, 2,
            Intent(this, VoiceCallService::class.java).apply { action = ACTION_DEAFEN },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val disconnectIntent = PendingIntent.getService(
            this, 3,
            Intent(this, VoiceCallService::class.java).apply { action = ACTION_DISCONNECT },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val muteIcon = if (isMuted) R.drawable.ic_mic_off else R.drawable.ic_mic
        val muteLabel = if (isMuted) "Unmute" else "Mute"
        val deafenIcon = if (isDeafened) R.drawable.ic_headphone_off else R.drawable.ic_headphone
        val deafenLabel = if (isDeafened) "Undeafen" else "Sourdine"
        val statusText = buildString {
            append("En appel")
            if (isMuted) append(" · Muté")
            if (isDeafened) append(" · Sourdine")
        }

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Sion — $channelName")
            .setContentText(statusText)
            .setSmallIcon(R.drawable.ic_voice_notification)
            .setOngoing(true)
            .setContentIntent(openIntent)
            .addAction(muteIcon, muteLabel, muteIntent)
            .addAction(deafenIcon, deafenLabel, deafenIntent)
            .apply {
                if (usesTelecom) setStyle(NotificationCompat.CallStyle.forOngoingCall(
                    androidx.core.app.Person.Builder().setName(channelName).build(), disconnectIntent))
                else addAction(R.drawable.ic_call_end, "Quitter", disconnectIntent)
            }
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setSilent(true)
            .build()
    }
}
