package me.rxresu.feature.documents

import android.annotation.SuppressLint
import android.content.Context
import android.net.Uri
import android.webkit.WebMessage
import android.webkit.WebMessagePort
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import java.io.ByteArrayInputStream
import java.util.Base64
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.serialization.json.*
import me.rxresu.core.network.ApiJson
import me.rxresu.core.network.generated.ResumeData

internal data class LocalImportResult(val data: JsonObject, val pages: Int? = null)
internal class LocalImportException(val code: String) : Exception("Local import failed: $code")

/** Executes only bundled reader code. The WebView never displays a file, its HTML, or a remote page. */
internal class LocalImportReader(context: Context, private val moreTitle: String) {
    private val app = context.applicationContext

    @SuppressLint("SetJavaScriptEnabled")
    suspend fun read(file: PickedFile, progress: (Int) -> Unit): LocalImportResult = withContext(Dispatchers.Main.immediate) {
        require(file.bytes.size <= 10 * 1024 * 1024 && file.size <= 10 * 1024 * 1024)
        val view = WebView(app)
        var ports: Array<WebMessagePort>? = null
        try {
            withTimeout(60_000) {
                suspendCancellableCoroutine { result ->
                    fun fail(code: String) {
                        if (result.isActive) result.resumeWithException(LocalImportException(code))
                    }
                    view.settings.apply {
                        javaScriptEnabled = true
                        allowFileAccess = false
                        allowContentAccess = false
                        blockNetworkLoads = true
                        blockNetworkImage = true
                        domStorageEnabled = false
                        databaseEnabled = false
                        javaScriptCanOpenWindowsAutomatically = false
                        setSupportMultipleWindows(false)
                        @Suppress("DEPRECATION")
                        allowFileAccessFromFileURLs = false
                        @Suppress("DEPRECATION")
                        allowUniversalAccessFromFileURLs = false
                    }
                    view.webViewClient = object : WebViewClient() {
                        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = true
                        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse {
                            val path = assetPath(request.url, request.method)
                            val content = path?.let { runCatching { app.assets.open("local-import/$it") }.getOrNull() }
                            return if (content == null) WebResourceResponse("text/plain", "UTF-8", 403, "Blocked", emptyMap(), ByteArrayInputStream(byteArrayOf()))
                            else WebResourceResponse(mime(path), "UTF-8", content)
                        }
                        override fun onPageFinished(view: WebView, url: String) {
                            if (url != PAGE || !result.isActive || ports != null) return
                            val channel = view.createWebMessageChannel()
                            ports = channel
                            channel[0].setWebMessageCallback(object : WebMessagePort.WebMessageCallback() {
                                override fun onMessage(port: WebMessagePort, message: WebMessage) {
                                    if (!result.isActive) return
                                    try {
                                        val json = ApiJson.parseToJsonElement(requireNotNull(message.data)).jsonObject
                                        json["stage"]?.jsonPrimitive?.intOrNull?.let { stage ->
                                            require(stage in 1..2)
                                            progress(stage)
                                            return
                                        }
                                        json["error"]?.jsonPrimitive?.content?.let { throw LocalImportException(it) }
                                        val data = json.getValue("data").jsonObject
                                        // Validate the bridge before it can become a Create request.
                                        ApiJson.decodeFromJsonElement(ResumeData.serializer(), data)
                                        val pages = json["pages"]?.takeUnless { it is JsonNull }?.jsonPrimitive?.int
                                        require(pages == null || pages in 1..30)
                                        result.resume(LocalImportResult(data, pages))
                                    } catch (error: Exception) {
                                        if (result.isActive) result.resumeWithException(error)
                                    }
                                }
                            })
                            view.postWebMessage(WebMessage("reader", arrayOf(channel[1])), Uri.parse(ORIGIN))
                            channel[0].postMessage(WebMessage(buildJsonObject {
                                put("name", file.name)
                                put("format", ImportViewModel.formatOf(file).name)
                                put("base64", Base64.getEncoder().encodeToString(file.bytes))
                                put("moreTitle", moreTitle)
                            }.toString()))
                        }
                        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: android.webkit.WebResourceError) {
                            if (request.isForMainFrame) fail("unsupported")
                        }
                        override fun onRenderProcessGone(view: WebView, detail: android.webkit.RenderProcessGoneDetail): Boolean {
                            fail("unsupported")
                            return true
                        }
                    }
                    view.loadUrl(PAGE)
                }
            }
        } catch (_: TimeoutCancellationException) {
            currentCoroutineContext().ensureActive()
            throw LocalImportException("unsupported")
        } finally {
            ports?.forEach { runCatching { it.close() } }
            view.stopLoading()
            view.destroy()
        }
    }

    companion object {
        private const val ORIGIN = "https://appassets.androidplatform.net"
        private const val PAGE = "$ORIGIN/local-import/index.html"

        internal fun assetPath(uri: Uri, method: String): String? {
            if (method != "GET" || uri.scheme != "https" || uri.host != "appassets.androidplatform.net" || uri.userInfo != null || uri.port != -1 || uri.query != null || uri.fragment != null) return null
            val path = uri.path?.removePrefix("/local-import/") ?: return null
            if (!uri.path!!.startsWith("/local-import/") || !path.matches(Regex("[A-Za-z0-9_./-]+")) || path.split('/').any { it == "." || it == ".." }) return null
            return path.takeIf { it in setOf("index.html", "reader.js", "pdf.worker.mjs") || it.startsWith("cmaps/") || it.startsWith("standard_fonts/") || it.startsWith("wasm/") }
        }

        private fun mime(path: String?) = when (path?.substringAfterLast('.')) {
            "html" -> "text/html"
            "js", "mjs" -> "text/javascript"
            "wasm" -> "application/wasm"
            else -> "application/octet-stream"
        }
    }
}
