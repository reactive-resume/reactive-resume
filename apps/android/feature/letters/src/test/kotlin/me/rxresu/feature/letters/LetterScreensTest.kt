package me.rxresu.feature.letters

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.graphics.asImageBitmap
import kotlinx.coroutines.runBlocking
import me.rxresu.core.data.*
import me.rxresu.core.navigation.LetterMode
import me.rxresu.core.page.PageSource
import me.rxresu.core.testing.*
import org.junit.Test

class LetterScreensTest : RrScreenshotTest() {
    private fun capture(mode: LetterMode, dark: Boolean, font: Float = 1f) {
        val repositories = FakeRepositories()
        try {
            val state = runBlocking {
                val original = repositories.letters.openDraft(StoryboardIds.lumenLetter).state.value.document!!
                val letter = original.copy(content = original.content.replace('’', '\''))
                // StoryboardPageRenderer bitmap drawing works without Robolectric's unsupported PDF writer.
                val doc = me.rxresu.core.page.RenderedDocument(PageSource.Letter(letter.id, letter.revision.toString()), java.io.File("unused-fixture.pdf"), 1)
                val resumeDoc = me.rxresu.core.page.RenderedDocument(PageSource.Resume(letter.sourceResumeId!!, "fixture"), java.io.File("unused-fixture.pdf"), 1)
                LetterState(designPage = repositories.pages.page(doc, 0, 300).asImageBitmap(), resumePage = repositories.pages.page(resumeDoc, 0, 358).asImageBitmap(), draft = DraftState(letter), loading = false, pages = listOf(repositories.pages.page(doc, 0, 716).asImageBitmap()), pageCount = doc.pageCount, resumes = repositories.resumes.listResumes(), applications = repositories.applications.listApplications())
            }
            captureScreen(if (mode == LetterMode.Write) "L1-Letter" else "L2-LetterDesign", dark, fontScale = font,
                wrap = { content -> CompositionLocalProvider(LocalRepositories provides repositories) { content() } }) { LetterScreen(state, mode, true, {}, {}, {}, {}) }
        } finally { repositories.close() }
    }
    @Test fun writeLight() = capture(LetterMode.Write, false)
    @Test fun writeDark() = capture(LetterMode.Write, true)
    @Test fun designLight() = capture(LetterMode.Design, false)
    @Test fun designDark() = capture(LetterMode.Design, true)
    @Test fun largeWrite() = capture(LetterMode.Write, false, 2f)

    private fun snapshot(dark: Boolean) {
        val repositories = FakeRepositories()
        try {
            val version = runBlocking { repositories.letters.getCoverLetterVersion(StoryboardIds.lumenLetter, "letter-version-lumen") }
            val date = java.time.format.DateTimeFormatter.ofPattern("d MMM yyyy").withZone(repositories.time.timezone()).format(java.time.Instant.parse(version.createdAt))
            val state = LetterState(snapshotVersionId = version.id, snapshotLabel = listOfNotNull(version.name, date).joinToString(" · "), draft = DraftState(version.readOnlyLetter()), loading = false)
            captureScreen("L1-LetterSnapshot", dark) { LetterScreen(state, LetterMode.Write, false, {}, {}, {}, {}) }
        } finally { repositories.close() }
    }
    @Test fun snapshotLight() = snapshot(false)
    @Test fun snapshotDark() = snapshot(true)
}
