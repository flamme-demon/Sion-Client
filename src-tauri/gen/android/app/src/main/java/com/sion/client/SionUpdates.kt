package com.sion.client

import android.app.Activity
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import java.io.File
import java.util.concurrent.Executors

/** Self-update only: fixed private cache path, package/version/certificate checks. */
object SionUpdates {
    const val REQUEST_PERMISSION = 4244
    @Volatile private var state = "ready"
    private val executor = Executors.newSingleThreadExecutor()
    @Volatile private var confirmationIntent: Intent? = null
    private var waiting: Pair<String, String>? = null

    fun status(): String = state

    @Synchronized
    fun install(activity: Activity, path: String, version: String): String {
        if (state == "installing" || state == "permission") return state
        if (VoiceCallService.isRunning) return "error:Termine l'appel avant d'installer la mise à jour."
        if (confirmationIntent != null) {
            launchConfirmation(activity)
            return state
        }
        val apk = File(path)
        val expected = File(activity.cacheDir, "updates/package.apk")
        if (apk.canonicalFile != expected.canonicalFile || !apk.isFile) return "error:APK introuvable dans le cache de Sion."
        try {
            verify(activity, apk, version)
            if (!activity.packageManager.canRequestPackageInstalls()) {
                waiting = Pair(path, version)
                state = "permission"
                activity.runOnUiThread {
                    try {
                        activity.startActivityForResult(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                            Uri.parse("package:${activity.packageName}")), REQUEST_PERMISSION)
                    } catch (error: Exception) { state = "error:${error.message}"; waiting = null }
                }
                return state
            }
            state = "installing"
            executor.execute {
                val installer = activity.packageManager.packageInstaller
                var sessionId: Int? = null
                try {
                    // Recheck after returning from Settings, before committing.
                    verify(activity, apk, version)
                    val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
                        setAppPackageName(activity.packageName)
                        setSize(apk.length())
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                            setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
                        }
                    }
                    val id = installer.createSession(params)
                    sessionId = id
                    installer.openSession(id).use { session ->
                        session.openWrite("Sion.apk", 0, apk.length()).use { output ->
                            apk.inputStream().use { input -> input.copyTo(output) }
                            session.fsync(output)
                        }
                        val callback = Intent(activity, SionUpdateReceiver::class.java)
                            .setAction("${activity.packageName}.UPDATE_RESULT")
                        val flags = PendingIntent.FLAG_UPDATE_CURRENT or
                            (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0)
                        val pending = PendingIntent.getBroadcast(activity, id, callback, flags)
                        session.commit(pending.intentSender)
                    }
                } catch (error: Exception) {
                    sessionId?.let { runCatching { installer.abandonSession(it) } }
                    state = "error:${error.message}"
                }
            }
        } catch (error: Exception) { state = "error:${error.message}" }
        return state
    }

    @Synchronized
    fun permissionResult(activity: Activity) {
        val pending = waiting
        waiting = null
        state = "ready"
        if (pending != null && activity.packageManager.canRequestPackageInstalls()) {
            install(activity, pending.first, pending.second)
        }
    }

    @Suppress("DEPRECATION")
    private fun verify(context: Context, file: File, version: String) {
        val pm = context.packageManager
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
        val candidate = pm.getPackageArchiveInfo(file.path, flags) ?: error("APK illisible ou incomplet.")
        val current = pm.getPackageInfo(context.packageName, flags)
        require(candidate.packageName == context.packageName) { "Cet APK n'est pas une mise à jour de cette application." }
        require(candidate.versionName == version) { "La version de l'APK ne correspond pas à la release annoncée." }
        val candidateCode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) candidate.longVersionCode else candidate.versionCode.toLong()
        val currentCode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) current.longVersionCode else current.versionCode.toLong()
        require(candidateCode > currentCode) { "L'APK doit être plus récent que la version installée." }
        val incoming = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) candidate.signingInfo?.apkContentsSigners else candidate.signatures
        val installed = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) current.signingInfo?.apkContentsSigners else current.signatures
        fun certificates(signatures: Array<android.content.pm.Signature>?): Set<String> =
            signatures?.map { android.util.Base64.encodeToString(it.toByteArray(), android.util.Base64.NO_WRAP) }?.toSet() ?: emptySet()
        val trusted = certificates(installed)
        require(trusted.isNotEmpty() && certificates(incoming) == trusted) { "La signature de l'APK ne correspond pas à celle de Sion." }
    }

    private fun launchConfirmation(context: Context) {
        val confirmation = confirmationIntent ?: return
        try {
            state = "installing"
            context.startActivity(confirmation.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            confirmationIntent = null
        } catch (error: Exception) { state = "error:${error.message}" }
    }

    fun result(context: Context, intent: Intent) {
        when (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                @Suppress("DEPRECATION")
                val confirmation = intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)
                if (confirmation == null) {
                    state = "error:Confirmation Android introuvable."
                } else {
                    // If Sion went to the background, keep the system confirmation
                    // for the next explicit Install click instead of launching an activity.
                    confirmationIntent = confirmation
                    state = "ready"
                    if (MainActivity.auPremierPlan) launchConfirmation(context)
                }
            }
            PackageInstaller.STATUS_SUCCESS -> {
                state = "ready"
                confirmationIntent = null
                File(context.cacheDir, "updates/package.apk").delete()
            }
            PackageInstaller.STATUS_FAILURE_ABORTED -> { confirmationIntent = null; state = "ready" }
            else -> state = "error:" + (intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: "Installation refusée par Android.")
        }
    }
}

class SionUpdateReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) { SionUpdates.result(context, intent) }
}
