package me.rxresu.feature.builder

import android.graphics.Bitmap
import androidx.lifecycle.ViewModelStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.*
import me.rxresu.core.data.*
import me.rxresu.core.navigation.PagePreview
import me.rxresu.core.page.*
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File
import java.io.IOException

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class PagePreviewViewModelTest {
    @Before fun setup() { Dispatchers.setMain(StandardTestDispatcher()) }
    @After fun teardown() { Dispatchers.resetMain() }

    private class Renderer : PageRenderer {
        var failure: IOException? = null
        var fallback = 0
        val sources = mutableListOf<PageSource>()
        override suspend fun render(source: PageSource): RenderedDocument {
            sources += source
            failure?.let { throw it }
            return RenderedDocument(source, File("not-a-pdf"), 1)
        }
        override suspend fun lastGood(source: PageSource): RenderedDocument {
            fallback++
            return RenderedDocument(source, File("not-a-pdf"), 1)
        }
        override suspend fun page(document: RenderedDocument, index: Int, widthPx: Int) = Bitmap.createBitmap(8, 12, Bitmap.Config.ARGB_8888)
    }

    @Test fun onlyOfflineTransportFailureCanUseLastGood() = runTest {
        val renderer = Renderer()
        val repositories = FakeRepositories(pageRenderer = renderer, coroutineScope = backgroundScope)
        val store = ViewModelStore()
        try {
            renderer.failure = IOException("offline")
            val vm = PagePreviewViewModel(repositories, PagePreview(StoryboardIds.resume), StandardTestDispatcher(testScheduler))
            store.put("preview", vm)
            advanceTimeBy(351); runCurrent()
            assertEquals(1, renderer.fallback)
            assertTrue(vm.state.value.offline)
            assertEquals(1, vm.state.value.pages.size)
            renderer.failure = PageHttpException(403)
            vm.retry(); advanceTimeBy(351); runCurrent()
            assertEquals(1, renderer.fallback)
            assertTrue(vm.state.value.failed)
            assertTrue(vm.state.value.pages.isEmpty())
        } finally { store.clear(); repositories.close() }
    }

    @Test fun frozenVersionNeverRequestsLiveResumePdf() = runTest {
        val renderer = Renderer()
        val repositories = FakeRepositories(pageRenderer = renderer, coroutineScope = backgroundScope)
        val store = ViewModelStore()
        try {
            val version = repositories.resumes.listResumeVersions(StoryboardIds.resume).first()
            val vm = PagePreviewViewModel(repositories, PagePreview(StoryboardIds.resume, versionId = version.id), StandardTestDispatcher(testScheduler))
            store.put("preview", vm)
            runCurrent()
            assertTrue(renderer.sources.isNotEmpty())
            assertTrue(renderer.sources.all { it == PageSource.ResumeVersion(StoryboardIds.resume, version.id) })
        } finally { store.clear(); repositories.close() }
    }

    @Test fun changingAccountClearsVisiblePagesAndDisablesRetry() = runTest {
        val renderer = Renderer()
        val auth = FakeAuthSession()
        val repositories = FakeRepositories(pageRenderer = renderer, authSession = auth, coroutineScope = backgroundScope)
        val store = ViewModelStore()
        try {
            val vm = PagePreviewViewModel(repositories, PagePreview(StoryboardIds.resume), StandardTestDispatcher(testScheduler))
            store.put("preview", vm)
            advanceTimeBy(351); runCurrent()
            assertEquals(1, vm.state.value.pages.size)
            auth.signOut(); runCurrent()
            assertTrue(vm.state.value.pages.isEmpty())
            val count = renderer.sources.size
            vm.retry(); advanceTimeBy(351); runCurrent()
            assertEquals(count, renderer.sources.size)
        } finally { store.clear(); repositories.close() }
    }
}
