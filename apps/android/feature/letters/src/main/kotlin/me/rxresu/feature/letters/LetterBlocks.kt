package me.rxresu.feature.letters

import android.graphics.pdf.PdfRenderer
import android.graphics.pdf.PdfRendererPreV
import android.os.Build
import android.os.ParcelFileDescriptor
import android.os.ext.SdkExtensions
import java.io.File
import me.rxresu.core.network.generated.CoverLetter

// TODO(lead): share PDF text extraction and normalized hit regions with builder PageBlocks.
internal data class LetterBlock(val field: String, val page: Int, val left: Float, val top: Float, val right: Float, val bottom: Float) {
    fun contains(x: Float, y: Float) = x in left..right && y in top..bottom
}
internal data class LetterRun(val text: String, val left: Float, val top: Float, val right: Float, val bottom: Float)
internal fun letterBlocks(letter: CoverLetter, pages: List<List<LetterRun>>): List<LetterBlock> {
    fun norm(text: String) = android.text.Html.fromHtml(text, android.text.Html.FROM_HTML_MODE_LEGACY).toString().lowercase().replace(Regex("\\s+"), " ").trim()
    val fields = listOf("recipient" to letter.recipient, "recipient" to letter.recipientName.orEmpty(), "recipient" to letter.recipientCompany.orEmpty(), "recipient" to letter.letterDate.orEmpty(),
        "greeting" to letter.greeting.orEmpty(), "signoff" to letter.signOff.orEmpty(), "body" to letter.content).map { it.first to norm(it.second) }.filter { it.second.isNotEmpty() }
    return pages.flatMapIndexed { page, runs -> runs.mapNotNull { run ->
        val text = norm(run.text)
        if (text.isEmpty()) return@mapNotNull null
        val matches = fields.filter { (_, value) -> value == text || value.contains(text) || (text.length >= 12 && text.contains(value)) }
        val field = matches.map { it.first }.distinct().singleOrNull() ?: return@mapNotNull null
        LetterBlock(field, page, run.left, run.top, run.right, run.bottom)
    } }
}
internal fun readLetterRuns(file: File): List<List<LetterRun>>? {
    if (Build.VERSION.SDK_INT < 35 && (Build.VERSION.SDK_INT < 31 || SdkExtensions.getExtensionVersion(Build.VERSION_CODES.S) < 13)) return null
    fun runs(contents: List<Pair<String, List<android.graphics.RectF>>>, width: Int, height: Int) = contents.flatMap { (text, bounds) ->
        val lines = text.split('\n').map { it.trim() }.filter { it.isNotEmpty() }
        val pairs = if (lines.size == bounds.size) lines.zip(bounds) else bounds.map { text.trim() to it }
        pairs.map { (line, b) -> LetterRun(line, b.left / width, b.top / height, b.right / width, b.bottom / height) }
    }
    return runCatching { ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY).use { fd ->
        if (Build.VERSION.SDK_INT >= 35) PdfRenderer(fd).use { pdf -> (0 until pdf.pageCount).map { index -> pdf.openPage(index).use { runs(it.textContents.map { text -> text.text to text.bounds }, it.width, it.height) } } }
        else {
            @Suppress("NewApi")
            PdfRendererPreV(fd).use { pdf -> (0 until pdf.pageCount).map { index -> pdf.openPage(index).use { runs(it.textContents.map { text -> text.text to text.bounds }, it.width, it.height) } } }
        }
    } }.getOrNull()
}
