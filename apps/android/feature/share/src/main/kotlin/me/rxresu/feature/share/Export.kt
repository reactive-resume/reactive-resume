package me.rxresu.feature.share

import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.CancellationSignal
import android.os.ParcelFileDescriptor
import android.print.*
import androidx.core.content.FileProvider
import androidx.core.graphics.createBitmap
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import java.io.File
import java.io.FileOutputStream
import java.util.UUID
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.*
import kotlinx.serialization.json.*
import me.rxresu.core.data.*
import me.rxresu.core.database.SaveStatus
import me.rxresu.core.navigation.DocumentKind
import me.rxresu.core.network.ApiJson
import me.rxresu.core.network.generated.*
import me.rxresu.core.page.*

class ExportFileProvider : FileProvider()
internal enum class FileFormat(val extension: String, val mime: String) {
    Pair("pdf", "application/pdf"), Pdf("pdf", "application/pdf"), Word("docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    OpenDocument("odt", "application/vnd.oasis.opendocument.text"), Text("md", "text/markdown"), Json("json", "application/json")
}
internal data class ExportFile(val name: String, val mime: String, val bytes: ByteArray)
internal data class ExportState(val name: String = "", val format: FileFormat = FileFormat.Pdf, val paired: Boolean = false, val busy: Boolean = false, val failed: Boolean = false, val offline: Boolean = false)
internal data class Delivery(val files: List<ExportFile>, val save: Boolean)
internal class ExportViewModel(private val repositories: RrRepositories, private val id: String, private val kind: DocumentKind) : ViewModel() {
    private val mutable = MutableStateFlow(ExportState())
    val state = mutable.asStateFlow()
    private val channel = Channel<Delivery>(Channel.BUFFERED)
    val deliveries = channel.receiveAsFlow()
    init { viewModelScope.launch { try {
        val letter = if (kind == DocumentKind.Letter) requireNotNull(repositories.letters.openDraft(id).state.value.document) else null
        val name = if (letter != null) letter.style.basics.name + " Cover Letter" else repositories.resumes.openDraft(id).state.value.document?.data?.basics?.name.orEmpty() + " Resume"
        mutable.update { it.copy(name = name, paired = letter?.sourceResumeId != null, format = if (letter?.sourceResumeId != null) FileFormat.Pair else FileFormat.Pdf) }
    } catch (e: CancellationException) { throw e } catch (_: Exception) { mutable.update { it.copy(failed = true) } } } }
    fun offline(value: Boolean) { mutable.update { it.copy(offline = value) } }
    fun name(value: String) { mutable.update { it.copy(name = value) } }
    fun format(value: FileFormat) { mutable.update { it.copy(format = value) } }
    fun export(save: Boolean) = viewModelScope.launch {
        if (state.value.busy) return@launch
        val selection = state.value
        mutable.update { it.copy(busy = true, failed = false) }
        try { channel.send(Delivery(files(selection), save)) }
        catch (e: CancellationException) { throw e } catch (_: Exception) { mutable.update { it.copy(failed = true) } }
        finally { mutable.update { it.copy(busy = false) } }
    }
    private suspend fun files(selection: ExportState): List<ExportFile> {
        val name = safeFileName(selection.name)
        suspend fun resume(resumeId: String, fileName: String, format: FileFormat): ExportFile {
            val draft = repositories.resumes.openDraft(resumeId)
            draft.flush()
            val value = requireNotNull(draft.state.value.document)
            val bytes = when (format) {
                FileFormat.Json -> ApiJson.encodeToString(ResumeData.serializer(), value.data).toByteArray()
                FileFormat.Pdf, FileFormat.Pair -> pdf(PageSource.Resume(resumeId, value.updatedAt), draft.state.value.status)
                else -> { check(draft.state.value.status == SaveStatus.Saved); repositories.resumes.exportResumeFile(resumeId, format.api()).bytes }
            }
            return ExportFile("$fileName.${format.extension}", format.mime, bytes)
        }
        if (kind == DocumentKind.Resume) return listOf(resume(id, name, selection.format))
        val draft = repositories.letters.openDraft(id); draft.flush(); val letter = requireNotNull(draft.state.value.document)
        if (selection.format == FileFormat.Pair) {
            val resumeId = requireNotNull(letter.sourceResumeId)
            return listOf(resume(resumeId, name.removeSuffix(" Cover Letter") + " Resume", FileFormat.Pdf), ExportFile("$name.pdf", "application/pdf", pdf(PageSource.Letter(id, letter.revision.toString()), draft.state.value.status)))
        }
        val bytes = when (selection.format) {
            FileFormat.Pdf -> pdf(PageSource.Letter(id, letter.revision.toString()), draft.state.value.status)
            FileFormat.Json -> {
                val json = ApiJson.encodeToJsonElement(CoverLetter.serializer(), letter).jsonObject
                JsonObject(json.filterKeys { it in setOf("content", "greeting", "layout", "letterDate", "name", "recipient", "recipientCompany", "recipientName", "signOff", "style") } + mapOf("format" to JsonPrimitive("reactive-resume-cover-letter"), "version" to JsonPrimitive(1))).toString().toByteArray()
            }
            else -> { check(draft.state.value.status == SaveStatus.Saved); repositories.letters.exportCoverLetterFile(id, selection.format.api()).bytes }
        }
        return listOf(ExportFile("$name.${selection.format.extension}", selection.format.mime, bytes))
    }
    private suspend fun pdf(source: PageSource, status: SaveStatus): ByteArray {
        check(status == SaveStatus.Saved) { "Save your changes before exporting the page." }
        val rendered = try { repositories.pages.render(source) } catch (e: CancellationException) { throw e } catch (e: java.io.IOException) {
            if (e is PageHttpException || e is PageSourceUnavailable || e is PageSessionChanged) throw e
            repositories.pages.lastGood(source)?.takeIf { it.source.revision == source.revision } ?: throw e
        }
        return withContext(Dispatchers.IO) { rendered.file.readBytes() }
    }
}
private fun FileFormat.api() = when (this) { FileFormat.Word -> ExportResumeFileFormat.Docx; FileFormat.OpenDocument -> ExportResumeFileFormat.Odt; FileFormat.Text -> ExportResumeFileFormat.Md; FileFormat.Json -> ExportResumeFileFormat.Json; else -> ExportResumeFileFormat.Pdf }
internal fun safeFileName(value: String) = value.map { if (it.code < 32 || it in "\\/:*?\"<>|") '_' else it }.joinToString("").trim().trim('.').take(120).ifBlank { "Document" }
internal suspend fun shareFiles(context: Context, files: List<ExportFile>, title: String) {
    val uris = withContext(Dispatchers.IO) {
        val root = File(context.cacheDir, "rr-exports").apply { mkdirs() }
        root.listFiles()?.filter { it.lastModified() < System.currentTimeMillis() - 86400000 }?.forEach { it.deleteRecursively() }
        val directory = File(root, UUID.randomUUID().toString()).apply { mkdirs() }
        files.map { value -> File(directory, safeFileName(value.name)).also { it.writeBytes(value.bytes) } }.map { FileProvider.getUriForFile(context, "${context.packageName}.share.files", it) }
    }
    val intent = Intent(if (uris.size == 1) Intent.ACTION_SEND else Intent.ACTION_SEND_MULTIPLE).apply {
        type = files.first().mime
        if (uris.size == 1) putExtra(Intent.EXTRA_STREAM, uris.first()) else putParcelableArrayListExtra(Intent.EXTRA_STREAM, ArrayList(uris))
        clipData = ClipData.newUri(context.contentResolver, title, uris.first()).apply { uris.drop(1).forEach { addItem(ClipData.Item(it)) } }
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    context.startActivity(Intent.createChooser(intent, title))
}
internal fun shareLink(context: Context, value: String, title: String) { context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply { type = "text/plain"; putExtra(Intent.EXTRA_TEXT, value) }, title)) }
internal fun selectedPrintPages(ranges: Array<out PageRange>, count: Int): List<Int> = (0 until count).filter { page -> ranges.any { page in it.start..it.end } }
internal fun printPdf(context: Context, file: File, name: String, pageCount: Int) {
    val manager = context.getSystemService(Context.PRINT_SERVICE) as PrintManager
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    manager.print(name, object : PrintDocumentAdapter() {
        override fun onLayout(old: PrintAttributes?, new: PrintAttributes?, signal: CancellationSignal, callback: LayoutResultCallback, extras: android.os.Bundle?) {
            if (signal.isCanceled) callback.onLayoutCancelled() else callback.onLayoutFinished(PrintDocumentInfo.Builder(name).setPageCount(pageCount).setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT).build(), old != new)
        }
        override fun onWrite(pages: Array<out PageRange>, destination: ParcelFileDescriptor, signal: CancellationSignal, callback: WriteResultCallback) {
            scope.launch {
                try {
                    val selected = selectedPrintPages(pages, pageCount); check(selected.isNotEmpty())
                    destination.use { target -> FileOutputStream(target.fileDescriptor).use { output ->
                        signal.throwIfCanceled()
                        if (selected.size == pageCount) file.inputStream().use { it.copyTo(output) }
                        else android.os.ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY).use { source -> android.graphics.pdf.PdfRenderer(source).use { pdf ->
                            val printed = android.graphics.pdf.PdfDocument()
                            try {
                                selected.forEach { index ->
                                    signal.throwIfCanceled()
                                    pdf.openPage(index).use { page ->
                                        // shortcut: selected pages rasterize at 300 dpi; use a PDF page-copy API when core supplies one.
                                        val bitmap = createBitmap((page.width * 300f / 72).toInt(), (page.height * 300f / 72).toInt(), android.graphics.Bitmap.Config.ARGB_8888)
                                        try {
                                            bitmap.eraseColor(android.graphics.Color.WHITE)
                                            page.render(bitmap, null, null, android.graphics.pdf.PdfRenderer.Page.RENDER_MODE_FOR_PRINT)
                                            val outputPage = printed.startPage(android.graphics.pdf.PdfDocument.PageInfo.Builder(page.width, page.height, index + 1).create())
                                            outputPage.canvas.drawBitmap(bitmap, null, android.graphics.Rect(0, 0, page.width, page.height), android.graphics.Paint(android.graphics.Paint.FILTER_BITMAP_FLAG))
                                            printed.finishPage(outputPage)
                                        } finally { bitmap.recycle() }
                                    }
                                }
                                signal.throwIfCanceled(); printed.writeTo(output)
                            } finally { printed.close() }
                        } }
                    } }
                    if (signal.isCanceled) callback.onWriteCancelled() else callback.onWriteFinished(selected.map { PageRange(it, it) }.toTypedArray())
                } catch (_: android.os.OperationCanceledException) { callback.onWriteCancelled() }
                catch (_: Exception) { callback.onWriteFailed(null) }
            }
        }
        override fun onFinish() { scope.cancel() }
    }, null)
}
