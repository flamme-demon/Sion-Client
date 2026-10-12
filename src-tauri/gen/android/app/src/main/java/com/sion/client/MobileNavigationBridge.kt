package com.sion.client

import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.BackEventCompat
import androidx.activity.OnBackPressedCallback
import org.json.JSONObject

/** Transmet le geste système sans déconnecter le vocal ni recharger le WebView. */
class MobileNavigationBridge(
  private val activity: MainActivity,
  private val webView: WebView,
  private val videoPleinEcran: () -> Boolean,
  private val fermerVideo: () -> Unit,
) {
  private var actif = false
  private val callback = object : OnBackPressedCallback(false) {
    override fun handleOnBackStarted(backEvent: BackEventCompat) {
      if (!videoPleinEcran()) transmettre("start", backEvent)
    }

    override fun handleOnBackProgressed(backEvent: BackEventCompat) {
      if (!videoPleinEcran()) transmettre("progress", backEvent)
    }

    override fun handleOnBackCancelled() {
      transmettre("cancel")
    }

    override fun handleOnBackPressed() {
      if (videoPleinEcran()) {
        transmettre("cancel")
        fermerVideo()
        return
      }
      transmettre("commit") { traite ->
        // Chargement, page absente ou pont pas encore prêt : laisser Tauri gérer Retour.
        if (!traite) {
          isEnabled = false
          activity.onBackPressedDispatcher.onBackPressed()
          isEnabled = actif
        }
      }
    }
  }

  @JavascriptInterface
  fun setEnabled(enabled: Boolean) {
    activity.runOnUiThread {
      actif = enabled
      callback.remove()
      callback.isEnabled = enabled
      if (enabled) activity.onBackPressedDispatcher.addCallback(activity, callback)
    }
  }

  private fun transmettre(phase: String, event: BackEventCompat? = null, fin: ((Boolean) -> Unit)? = null) {
    val detail = JSONObject().put("phase", phase)
    if (event != null) {
      // Android mesure en pixels physiques ; le viewport du chat utilise les pixels CSS.
      detail.put("touchX", (event.touchX / activity.resources.displayMetrics.density).toDouble())
      detail.put("progress", event.progress.toDouble())
    }
    webView.evaluateJavascript("window.__SION_MOBILE_BACK__?.($detail) === true") { resultat ->
      fin?.invoke(resultat == "true")
    }
  }
}
