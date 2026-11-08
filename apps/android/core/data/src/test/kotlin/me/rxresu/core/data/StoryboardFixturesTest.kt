package me.rxresu.core.data

import java.io.File
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.runTest
import me.rxresu.core.network.ApiJson
import me.rxresu.core.network.generated.Application
import me.rxresu.core.network.generated.Interview
import me.rxresu.core.page.PageSource
import me.rxresu.core.page.RenderedDocument
import me.rxresu.core.page.StoryboardImage
import me.rxresu.core.page.StoryboardPageImages
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class StoryboardFixturesTest {
    @Test fun commonSeedMatchesDocumentDesignAndLumenHistory() = runTest {
        FakeRepositories(coroutineScope = backgroundScope).use { repositories ->
            val resume = repositories.resumes.getResume(StoryboardIds.resume)
            val metadata = resume.data.metadata
            assertEquals("rgba(47, 90, 138, 1)", metadata.design.colors.primary)
            assertEquals("EB Garamond", metadata.typography.body.fontFamily)
            assertEquals(10.5, metadata.typography.body.fontSize, 0.0)
            assertEquals(14.0, metadata.page.marginX, 0.0)
            assertEquals(12.0, metadata.page.marginY, 0.0)
            assertEquals("2026-10-28T10:00:00Z", resume.createdAt)
            assertEquals("Product designer — Lumen", repositories.resumes.getResume(StoryboardIds.lumenResume).name)
            val application = repositories.applications.getApplication(StoryboardIds.lumen)
            assertEquals("2026-10-24T10:00:00Z", application.createdAt)
            assertEquals("2026-11-02T14:20:00Z", application.appliedAt)
            assertEquals("https://lumen.com/careers", application.sourceUrl)
            val interview = application.activity.filterIsInstance<Interview>().single()
            assertEquals(listOf("Priya Raman", "Tomás Silva"), interview.participants!!.map { it.name })
            assertEquals("https://meet.lumen.com/design-loop", interview.location)

            // Contradictory screen states stay typed response overrides rather than changing the common seed.
            val controls = FakeControls().apply {
                responses.value = mapOf("getApplication" to ApiJson.encodeToJsonElement(Application.serializer(), application.copy(notes = "Screen-specific notes")))
            }
            FakeRepositories(controls, coroutineScope = backgroundScope).use { scenario ->
                assertEquals("Screen-specific notes", scenario.applications.getApplication(StoryboardIds.lumen).notes)
            }
        }
    }

    @Test fun defaultFakeRepositoriesUseTheSameStoryboardPageCrop() = runBlocking {
        FakeRepositories().use { repositories ->
            val source = PageSource.Resume(StoryboardIds.resume, "fixture")
            val document = RenderedDocument(source, File("unused.pdf"), 1)
            val image = repositories.pages.page(document, 0, 340)
            val expected = StoryboardPageImages.bitmap(StoryboardImage.ResumeOverview, 340)
            try { assertTrue(expected.sameAs(image)) }
            finally { image.recycle(); expected.recycle() }
        }
    }
}
