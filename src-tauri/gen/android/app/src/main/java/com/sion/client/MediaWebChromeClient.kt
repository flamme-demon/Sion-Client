package com.sion.client

import android.content.pm.ActivityInfo
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.*
import android.widget.Button
import android.widget.FrameLayout
import androidx.activity.OnBackPressedCallback
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

/** Wry refuse les vues plein écran. On les héberge dans l'activité, en
 * conservant son client pour les permissions, fichiers et dialogues. */
class MediaWebChromeClient(
  private val activity: MainActivity,
  private val webView: WebView,
  private val delegate: WebChromeClient,
) : WebChromeClient() {
  private var fullscreen: FrameLayout? = null
  private var hiddenCallback: CustomViewCallback? = null
  private var previousOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
  private var previousVisibility = View.VISIBLE
  private var statusBarVisible = true
  private var navigationBarVisible = true
  private var previousBarsBehavior = 0
  val backCallback = object : OnBackPressedCallback(false) {
    override fun handleOnBackPressed() = onHideCustomView()
  }

  override fun onShowCustomView(view: View, callback: CustomViewCallback) {
    if (fullscreen != null) {
      callback.onCustomViewHidden()
      return
    }
    previousOrientation = activity.requestedOrientation
    previousVisibility = webView.visibility
    val decor = activity.window.decorView as ViewGroup
    val insets = androidx.core.view.ViewCompat.getRootWindowInsets(decor)
    statusBarVisible = insets?.isVisible(WindowInsetsCompat.Type.statusBars()) ?: true
    navigationBarVisible = insets?.isVisible(WindowInsetsCompat.Type.navigationBars()) ?: true
    val controller = WindowCompat.getInsetsController(activity.window, decor)
    previousBarsBehavior = controller.systemBarsBehavior
    controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    controller.hide(WindowInsetsCompat.Type.systemBars())

    val frame = FrameLayout(activity).apply {
      setBackgroundColor(Color.BLACK)
      addView(view, FrameLayout.LayoutParams(-1, -1))
    }
    fullscreen = frame
    hiddenCallback = callback
    decor.addView(frame, ViewGroup.LayoutParams(-1, -1))
    webView.visibility = View.INVISIBLE
    backCallback.isEnabled = true

    // Proposition explicite : pas de rotation imposée aux vidéos verticales
    // ni de modification du réglage de rotation du téléphone.
    webView.evaluateJavascript("""
      (() => {
        const root = document.fullscreenElement;
        const media = root?.matches('video,canvas') ? root : root?.querySelector('video,canvas');
        if (!media) return false;
        const w = Number(media.dataset.nativeVideoWidth) || media.videoWidth || media.width;
        const h = Number(media.dataset.nativeVideoHeight) || media.videoHeight || media.height;
        return w > h && h > 0;
      })()
    """.trimIndent()) { horizontal ->
      if (fullscreen !== frame || horizontal != "true") return@evaluateJavascript
      val rotate = Button(activity).apply {
        text = activity.getString(R.string.media_landscape)
        contentDescription = text
        setOnClickListener {
          activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
          visibility = View.GONE
        }
      }
      val margin = (12 * activity.resources.displayMetrics.density).toInt()
      frame.addView(rotate, FrameLayout.LayoutParams(-2, -2, Gravity.TOP or Gravity.END).apply {
        setMargins(margin, margin, margin, margin)
      })
    }
  }

  override fun onHideCustomView() {
    val frame = fullscreen ?: return
    val callback = hiddenCallback
    fullscreen = null
    hiddenCallback = null
    backCallback.isEnabled = false
    (frame.parent as? ViewGroup)?.removeView(frame)
    frame.removeAllViews()
    webView.visibility = previousVisibility
    activity.requestedOrientation = previousOrientation
    val controller = WindowCompat.getInsetsController(activity.window, activity.window.decorView)
    controller.systemBarsBehavior = previousBarsBehavior
    if (statusBarVisible) controller.show(WindowInsetsCompat.Type.statusBars())
    else controller.hide(WindowInsetsCompat.Type.statusBars())
    if (navigationBarVisible) controller.show(WindowInsetsCompat.Type.navigationBars())
    else controller.hide(WindowInsetsCompat.Type.navigationBars())
    callback?.onCustomViewHidden()
  }

  override fun onPermissionRequest(request: PermissionRequest) = delegate.onPermissionRequest(request)
  override fun onPermissionRequestCanceled(request: PermissionRequest) = delegate.onPermissionRequestCanceled(request)
  override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri?>?>, params: FileChooserParams) =
    delegate.onShowFileChooser(view, callback, params)
  override fun onJsAlert(view: WebView, url: String, message: String, result: JsResult) =
    delegate.onJsAlert(view, url, message, result)
  override fun onJsConfirm(view: WebView, url: String, message: String, result: JsResult) =
    delegate.onJsConfirm(view, url, message, result)
  override fun onJsPrompt(view: WebView, url: String, message: String, defaultValue: String, result: JsPromptResult) =
    delegate.onJsPrompt(view, url, message, defaultValue, result)
  override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) =
    delegate.onGeolocationPermissionsShowPrompt(origin, callback)
  override fun onGeolocationPermissionsHidePrompt() = delegate.onGeolocationPermissionsHidePrompt()
  override fun onConsoleMessage(message: ConsoleMessage) = delegate.onConsoleMessage(message)
  override fun onReceivedTitle(view: WebView, title: String) = delegate.onReceivedTitle(view, title)
  override fun onReceivedIcon(view: WebView, icon: Bitmap) = delegate.onReceivedIcon(view, icon)
  override fun onProgressChanged(view: WebView, progress: Int) = delegate.onProgressChanged(view, progress)
  override fun onCreateWindow(view: WebView, dialog: Boolean, gesture: Boolean, message: android.os.Message) =
    delegate.onCreateWindow(view, dialog, gesture, message)
  override fun onCloseWindow(view: WebView) = delegate.onCloseWindow(view)
  override fun onRequestFocus(view: WebView) = delegate.onRequestFocus(view)
  override fun getDefaultVideoPoster(): Bitmap? = delegate.defaultVideoPoster
  override fun getVideoLoadingProgressView(): View? = delegate.videoLoadingProgressView
}
