package com.sion.client

import android.content.Intent
import android.net.Uri
import android.webkit.JavascriptInterface

/** Le sélecteur Android laisse l'utilisateur choisir son application et son destinataire. */
class PartageBridge(private val activity: MainActivity) {
  @JavascriptInterface
  fun partagerLien(titre: String, lien: String): Boolean {
    if (Uri.parse(lien).scheme != "https") return false
    activity.runOnUiThread {
      val envoi = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_TEXT, lien)
        putExtra(Intent.EXTRA_TITLE, titre)
        putExtra(Intent.EXTRA_SUBJECT, titre)
      }
      activity.startActivity(Intent.createChooser(envoi, null))
    }
    return true
  }
}
