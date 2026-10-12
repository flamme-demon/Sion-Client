package com.sion.client

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.ImageFormat
import android.hardware.camera2.*
import android.media.ImageReader
import android.os.Handler
import android.os.HandlerThread
import android.view.Surface
import android.webkit.JavascriptInterface
import org.json.JSONArray
import org.json.JSONObject
import java.lang.ref.WeakReference

/** Capture Camera2 → plans I420 → JNI ; aucun pixel ne traverse JavaScript. */
class CameraBridge(private val activity: MainActivity) {
  init { owner = WeakReference(activity) }

  @JavascriptInterface fun hasPermission(): Boolean = activity.checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
  @JavascriptInterface fun requestPermission() {
    permissionResult = "attente"
    activity.runOnUiThread { activity.requestPermissions(arrayOf(Manifest.permission.CAMERA), REQUEST_CAMERA) }
  }
  @JavascriptInterface fun permissionState(): String = if (hasPermission()) "accordée" else permissionResult

  companion object {
    const val REQUEST_CAMERA = 4244
    @Volatile var permissionResult = "attente"
    private var owner = WeakReference<MainActivity>(null)
    @Volatile private var current: Capture? = null
    @JvmStatic external fun frame(token: Long, bytes: ByteArray, width: Int, height: Int, rotation: Int)
    @JvmStatic external fun failure(token: Long, message: String)

    /** Une courte boucle décodée une fois, jamais pendant la capture. */
    @JvmStatic fun normaliserFondVideo(path: String, folder: String): String {
      val reader = android.media.MediaMetadataRetriever()
      return try {
        reader.setDataSource(path)
        val duration = (reader.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 1000L).coerceIn(100L, 6000L)
        var count = 0
        for (i in 0 until (duration / 100L).toInt().coerceIn(1, 60)) {
          val frame = if (android.os.Build.VERSION.SDK_INT >= 27) {
            reader.getScaledFrameAtTime(i * 100_000L, android.media.MediaMetadataRetriever.OPTION_CLOSEST, 320, 320)
          } else {
            reader.getFrameAtTime(i * 100_000L, android.media.MediaMetadataRetriever.OPTION_CLOSEST)?.let { original ->
              val scale = 320f / maxOf(original.width, original.height)
              android.graphics.Bitmap.createScaledBitmap(original, (original.width * scale).toInt().coerceAtLeast(1), (original.height * scale).toInt().coerceAtLeast(1), true).also { if (it !== original) original.recycle() }
            }
          } ?: break
          try { java.io.File(folder, "$i.png").outputStream().use { frame.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }; count++ } finally { frame.recycle() }
        }
        if (count > 0) "" else "Cette vidéo ne contient pas d'image lisible."
      } catch (e: Exception) { e.message ?: "Ce fond vidéo ne peut pas être lu." } finally { reader.release() }
    }

    @JvmStatic fun lister(): String {
      val activity = owner.get() ?: return "[]"
      val manager = activity.getSystemService(Context.CAMERA_SERVICE) as CameraManager
      return JSONArray().apply {
        manager.cameraIdList.forEach { id ->
          val c = manager.getCameraCharacteristics(id)
          val front = c.get(CameraCharacteristics.LENS_FACING) == CameraCharacteristics.LENS_FACING_FRONT
          if (c.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)?.getOutputSizes(ImageFormat.YUV_420_888)?.isNotEmpty() == true) {
            put(JSONObject().put("id", id).put("label", if (front) "Caméra avant" else "Caméra arrière").put("front", front))
          }
        }
      }.toString()
    }

    @JvmStatic @Synchronized fun demarrer(id: String, token: Long): String {
      val activity = owner.get() ?: return "Interface Android indisponible."
      if (!MainActivity.auPremierPlan) return "Ouvre Sion pour activer la caméra."
      if (activity.checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) return "Autorise l'accès à la caméra."
      current?.close()
      val capture = Capture(activity, id, token)
      current = capture
      return try { capture.start(); "" } catch (e: Exception) { capture.close(); current = null; e.message ?: "Impossible d'ouvrir la caméra." }
    }

    @JvmStatic @Synchronized fun arreter(token: Long) {
      current?.takeIf { it.token == token }?.let { current = null; it.close() }
    }

    @Synchronized fun pause() {
      current?.let { current = null; it.close(); failure(it.token, "La caméra a été arrêtée quand Sion est passé en arrière-plan.") }
    }
  }

  private class Capture(val activity: MainActivity, val id: String, val token: Long) {
    private val thread = HandlerThread("sion-camera").apply { start() }
    private val handler = Handler(thread.looper)
    @Volatile private var closed = false
    private var camera: CameraDevice? = null
    private var session: CameraCaptureSession? = null
    private var reader: ImageReader? = null

    @Suppress("MissingPermission", "DEPRECATION")
    fun start() {
      val manager = activity.getSystemService(Context.CAMERA_SERVICE) as CameraManager
      val characteristics = manager.getCameraCharacteristics(id)
      val sizes = characteristics.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)?.getOutputSizes(ImageFormat.YUV_420_888) ?: error("Format caméra indisponible.")
      val size = sizes.filter { it.width <= 1280 && it.height <= 1280 && it.width % 2 == 0 && it.height % 2 == 0 }
        .minByOrNull { kotlin.math.abs(it.width * it.height - 640 * 480) } ?: error("Résolution caméra indisponible.")
      val sensor = characteristics.get(CameraCharacteristics.SENSOR_ORIENTATION) ?: 0
      val front = characteristics.get(CameraCharacteristics.LENS_FACING) == CameraCharacteristics.LENS_FACING_FRONT
      val range = characteristics.get(CameraCharacteristics.CONTROL_AE_AVAILABLE_TARGET_FPS_RANGES)?.filter { it.upper <= 30 }?.maxByOrNull { it.upper }
      val bytes = ByteArray(size.width * size.height * 3 / 2)
      val images = ImageReader.newInstance(size.width, size.height, ImageFormat.YUV_420_888, 2)
      reader = images
      images.setOnImageAvailableListener({ input ->
        val image = try { input.acquireLatestImage() } catch (_: IllegalStateException) { null }
        image?.use {
          if (closed) return@use
          var offset = 0
          image.planes.forEachIndexed { index, plane ->
            val w = if (index == 0) size.width else size.width / 2
            val h = if (index == 0) size.height else size.height / 2
            val buffer = plane.buffer
            val base = buffer.position()
            for (y in 0 until h) for (x in 0 until w) bytes[offset++] = buffer.get(base + y * plane.rowStride + x * plane.pixelStride)
          }
          val display = when (activity.windowManager.defaultDisplay.rotation) { Surface.ROTATION_90 -> 90; Surface.ROTATION_180 -> 180; Surface.ROTATION_270 -> 270; else -> 0 }
          val rotation = if (front) (sensor + display) % 360 else (sensor - display + 360) % 360
          frame(token, bytes, size.width, size.height, rotation)
        }
      }, handler)
      manager.openCamera(id, object : CameraDevice.StateCallback() {
        override fun onOpened(device: CameraDevice) {
          if (closed) { device.close(); return }
          camera = device
          device.createCaptureSession(listOf(images.surface), object : CameraCaptureSession.StateCallback() {
            override fun onConfigured(s: CameraCaptureSession) {
              if (closed) { s.close(); return }
              session = s
              try {
                val request = device.createCaptureRequest(CameraDevice.TEMPLATE_RECORD).apply {
                  addTarget(images.surface)
                  set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_VIDEO)
                  if (range != null) set(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE, range)
                }.build()
                s.setRepeatingRequest(request, null, handler)
              } catch (e: Exception) { fail(e.message ?: "Capture caméra interrompue.") }
            }
            override fun onConfigureFailed(s: CameraCaptureSession) { s.close(); fail("La caméra ne peut pas fournir d'image.") }
          }, handler)
        }
        override fun onDisconnected(device: CameraDevice) { device.close(); fail("La caméra a été déconnectée.") }
        override fun onError(device: CameraDevice, code: Int) { device.close(); fail("Caméra indisponible (code $code).") }
      }, handler)
    }

    private fun fail(message: String) { if (!closed) { failure(token, message); close() } }
    fun close() {
      if (closed) return
      closed = true
      try { session?.close() } catch (_: Exception) { }
      camera?.close()
      reader?.close()
      session = null; camera = null; reader = null
      thread.quitSafely()
    }
  }
}
