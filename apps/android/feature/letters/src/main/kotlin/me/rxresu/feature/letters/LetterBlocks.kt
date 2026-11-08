package me.rxresu.feature.letters

import java.io.File
import me.rxresu.core.network.generated.CoverLetter

// TODO(lead): share PDF text extraction and normalized hit regions with builder PageBlocks.
internal data class LetterBlock(val field: String, val page: Int, val left: Float, val top: Float, val right: Float, val bottom: Float) {
    fun contains(x: Float, y: Float) = x in left..right && y in top..bottom
}
internal typealias LetterRun = me.rxresu.core.page.PageTextRun
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
internal fun readLetterRuns(file: File): List<List<LetterRun>>? = me.rxresu.core.page.PdfText.read(file)
