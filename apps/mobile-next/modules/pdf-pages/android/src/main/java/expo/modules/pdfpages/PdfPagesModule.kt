package expo.modules.pdfpages

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.util.UUID
import java.util.concurrent.Executors
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.asCoroutineDispatcher

class PdfPagesModule : Module() {
  private data class Document(val renderer: PdfRenderer, val directory: File)
  private val documents = mutableMapOf<String, Document>()
  private val dispatcher = Executors.newSingleThreadExecutor { task -> Thread(task, "pdf-pages") }.asCoroutineDispatcher()
  private val scope = CoroutineScope(dispatcher + SupervisorJob())

  override fun definition() = ModuleDefinition {
    Name("PdfPages")
    OnCreate {
      dispatcher.executor.execute {
        appContext.reactContext?.cacheDir?.listFiles()?.filter { it.isDirectory && it.name.startsWith("rr-pdf-") }
          ?.forEach { it.deleteRecursively() }
      }
    }
    AsyncFunction("open") { bytes: ByteArray ->
      val cache = requireNotNull(appContext.reactContext).cacheDir
      val id = UUID.randomUUID().toString()
      val directory = File(cache, "rr-pdf-$id")
      check(directory.mkdirs()) { "Cannot create PDF cache" }
      val file = File(directory, "document.pdf")
      var renderer: PdfRenderer? = null
      try {
        file.writeBytes(bytes)
        val descriptor = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
        val opened = try { PdfRenderer(descriptor) } catch (error: Throwable) { descriptor.close(); throw error }
        renderer = opened
        check(opened.pageCount > 0) { "Empty PDF" }
        val pages = (0 until opened.pageCount).map { index ->
          opened.openPage(index).use { page -> mapOf("width" to page.width, "height" to page.height) }
        }
        documents[id] = Document(opened, directory)
        mapOf("id" to id, "pages" to pages)
      } catch (error: Throwable) {
        renderer?.close()
        directory.deleteRecursively()
        throw error
      }
    }.runOnQueue(scope)

    AsyncFunction("rasterize") { id: String, indices: List<Int>, scale: Double ->
      val document = requireNotNull(documents[id]) { "Closed PDF" }
      require(scale.isFinite() && scale >= 0.1 && scale <= 6) { "Invalid scale" }
      indices.map { index ->
        require(index >= 0 && index < document.renderer.pageCount) { "Invalid page" }
        document.renderer.openPage(index).use { page ->
          require(page.width > 0 && page.height > 0) { "Invalid page dimensions" }
          val limit = 25_000_000.0
          val pageScale = minOf(scale, kotlin.math.sqrt(limit / page.width / page.height), limit / page.width, limit / page.height)
          val width = maxOf(1, kotlin.math.floor(page.width * pageScale).toInt())
          val height = maxOf(1, kotlin.math.floor(page.height * pageScale).toInt())
          val file = File(document.directory, "$index-$pageScale.png")
          if (!file.exists()) {
            val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
            try {
              bitmap.eraseColor(Color.WHITE)
              val matrix = Matrix().apply { setScale(pageScale.toFloat(), pageScale.toFloat()) }
              page.render(bitmap, null, matrix, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
              file.outputStream().use { check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) { "PNG encoding failed" } }
            } catch (error: Throwable) {
              file.delete()
              throw error
            } finally { bitmap.recycle() }
          }
          document.directory.listFiles()?.filter { it.name.startsWith("$index-") && it.extension == "png" && it != file }
            ?.forEach { it.delete() }
          mapOf("index" to index, "uri" to android.net.Uri.fromFile(file).toString(), "width" to page.width, "height" to page.height)
        }
      }
    }.runOnQueue(scope)

    AsyncFunction("close") { id: String -> remove(id) }.runOnQueue(scope)
    OnDestroy {
      // Queue cleanup behind outstanding renders; shutting down an executor still drains its queue.
      dispatcher.executor.execute { documents.keys.toList().forEach { remove(it) } }
      dispatcher.close()
    }
  }

  private fun remove(id: String) {
    documents.remove(id)?.let { document ->
      try { document.renderer.close() } finally { document.directory.deleteRecursively() }
    }
  }
}
