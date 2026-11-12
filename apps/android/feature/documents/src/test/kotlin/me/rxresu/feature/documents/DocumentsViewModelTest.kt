package me.rxresu.feature.documents

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonArray
import me.rxresu.core.data.FakeControls
import me.rxresu.core.data.FakeMode
import me.rxresu.core.data.FakeRepositories
import me.rxresu.core.data.StoryboardIds
import me.rxresu.core.network.ApiJson
import me.rxresu.core.network.generated.DocumentType
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
class DocumentsViewModelTest {
    @Before fun main() = Dispatchers.setMain(UnconfinedTestDispatcher())
    @After fun reset() = Dispatchers.resetMain()

    @Test fun libraryFiltersOnDeviceAndKeepsCounts() = runTest {
        val r = FakeRepositories()
        val vm = LibraryViewModel(r.documents, r.account)
        val all = vm.state.first { !it.loading }
        vm.setType(LibraryType.Letter)
        val letters = vm.state.first { it.filters.type == LibraryType.Letter }
        assertTrue(letters.documents.isNotEmpty())
        assertTrue(letters.documents.all { it.type == DocumentType.Letter })
        assertEquals(all.resumes, letters.resumes)
        vm.setTag("Nope")
        assertTrue(vm.state.first { it.filters.tag == "Nope" }.documents.isEmpty())
        vm.clearFilters()
        assertEquals(all.documents.size, vm.state.first { !it.filters.active }.documents.size)
    }

    @Test fun movingToTrashHidesAtOnceAndUndoRestores() = runTest {
        val r = FakeRepositories()
        val vm = LibraryViewModel(r.documents, r.account)
        val doc = vm.state.first { !it.loading }.all.first { it.id == StoryboardIds.resume }
        vm.trash(doc)
        assertTrue(vm.state.value.all.none { it.id == doc.id })
        assertTrue(r.documents.listDocuments(trashed = true).any { it.id == doc.id })
        vm.restore(doc)
        assertTrue(vm.state.first { s -> s.all.any { it.id == doc.id } }.all.any { it.id == doc.id })
    }

    @Test fun bulkTrashSkipsLockedDocuments() = runTest {
        val r = FakeRepositories()
        val vm = LibraryViewModel(r.documents, r.account)
        vm.state.first { !it.loading }
        vm.select(StoryboardIds.resume)
        vm.select(StoryboardIds.lockedResume)
        val moved = vm.trashSelection()
        assertEquals(listOf(StoryboardIds.resume), moved.map { it.id })
        assertEquals(setOf(StoryboardIds.lockedResume), vm.state.value.selection)
    }

    @Test fun failedTrashBringsTheRowBack() = runTest {
        val controls = FakeControls()
        val r = FakeRepositories(controls)
        val vm = LibraryViewModel(r.documents, r.account)
        val doc = vm.state.first { !it.loading }.all.first { it.id == StoryboardIds.resume }
        controls.set("trashDocument", FakeMode.Error())
        assertTrue(runCatching { vm.trash(doc) }.isFailure)
        assertTrue(vm.state.value.all.any { it.id == doc.id })
    }

    @Test fun trashRestoresAndEmpties() = runTest {
        val r = FakeRepositories()
        val vm = TrashViewModel(r.documents, r.applications)
        val parcel = vm.state.first { !it.loading }.documents.single()
        vm.restore(parcel)
        assertTrue(vm.state.first { it.documents.isEmpty() }.documents.isEmpty())
        assertTrue(r.documents.listDocuments().any { it.id == parcel.id })
    }

    @Test fun publicLinkOnlyForPublishedResumes() = runTest {
        val r = FakeRepositories()
        val published = DocumentActionsViewModel(r, StoryboardIds.resume).state.first { it.document != null && it.username != null }
        assertTrue(published.publicUrl!!.endsWith("/${published.username}/product-designer"))
        val private = DocumentActionsViewModel(r, StoryboardIds.lumenResume).state.first { it.document != null && it.username != null }
        assertNull(private.publicUrl)
    }

    @Test fun copyForJobLinksAnExistingApplication() = runTest {
        val r = FakeRepositories()
        val vm = DocumentActionsViewModel(r, StoryboardIds.resume)
        val id = vm.copyForJob(StoryboardIds.resume, JobChoice.Existing(StoryboardIds.kiln), "Kiln Studio · Senior product designer")
        val copy = r.documents.listDocuments().first { it.id == id }
        assertEquals("Kiln Studio · Senior product designer", copy.name)
        assertEquals(StoryboardIds.kiln, copy.application?.id)
    }

    @Test fun suggestedCopyNames() {
        assertEquals("Lumen · Senior product designer", DocumentActionsViewModel.suggestedName(null, " Lumen ", "Senior product designer"))
        assertEquals("", DocumentActionsViewModel.suggestedName(null, null, null))
    }

    @Test fun importReadsLocallyWithoutPreviewOrAiAndCreatePersistsParsedData() = runTest {
        val controls = FakeControls()
        val r = FakeRepositories(controls)
        val data = ApiJson.encodeToJsonElement(me.rxresu.core.network.generated.ResumeData.serializer(), r.resumes.getResume(StoryboardIds.resume).data)
        var localReads = 0
        val resumes = object : me.rxresu.core.data.ResumeRepository by r.resumes {
            override suspend fun previewPdfImport(file: me.rxresu.core.network.UploadPart, options: me.rxresu.core.network.RequestOptions): me.rxresu.core.network.generated.PreviewPdfImportResponse = error("Local import must never upload a PDF")
        }
        val ai = object : me.rxresu.core.data.AiRepository by r.ai {
            override suspend fun parseResumePdf(body: me.rxresu.core.network.generated.CreatePdfParseRequest, options: me.rxresu.core.network.RequestOptions): me.rxresu.core.network.generated.CreatePdfParseResponse = error("Local import must never use AI")
        }
        val vm = ImportViewModel(resumes, ai, r.account.session) { _, stage -> localReads++; stage(1); stage(2); LocalImportResult(importData(r), 2) }
        vm.start(PickedFile("cv.pdf", 10, "application/pdf", ByteArray(10)))
        val done = vm.state.first { it.summary != null || it.problem != null }
        assertEquals(3, done.progress)
        assertEquals(data.jsonObject["basics"]!!.jsonObject["name"]!!.jsonPrimitive.content, done.summary!!.name)
        assertTrue(done.canCreate)
        assertEquals(1, localReads)
        assertEquals(2, done.file?.pages)
        val id = vm.create()
        assertEquals(done.summary.name, r.resumes.getResume(id).data.basics.name)
    }

    @Test fun exportsAreImportedAsTheyAreOnCreate() = runTest {
        val r = FakeRepositories()
        val vm = ImportViewModel(r.resumes, r.ai, r.account.session) { _, _ -> LocalImportResult(importData(r)) }
        vm.start(PickedFile("linkedin.zip", 10, "application/zip", ByteArray(10)))
        assertTrue(vm.state.value.canCreate)
        val id = vm.create()
        assertTrue(r.documents.listDocuments().any { it.id == id })
    }

    @Test fun switchingToAiSendsNothingUntilAsked() = runTest {
        val controls = FakeControls()
        val r = FakeRepositories(controls)
        controls.set("previewPdfImport", FakeMode.Error())
        val vm = ImportViewModel(r.resumes, r.ai, r.account.session) { _, _ -> throw LocalImportException("unreadable") }
        vm.start(PickedFile("cv.pdf", 10, "application/pdf", ByteArray(10)))
        assertEquals(ImportProblem.Unreadable, vm.state.first { it.problem != null }.problem)
        vm.setMethod(ImportMethod.Ai)
        val ai = vm.state.value
        assertEquals(0, ai.progress)
        assertNull(ai.problem)
        assertFalse(ai.canCreate)
    }

    @Test fun wordWithoutAiCannotBeRead() = runTest {
        val controls = FakeControls()
        controls.set("listAiProviders", FakeMode.Empty)
        val r = FakeRepositories(controls)
        val vm = ImportViewModel(r.resumes, r.ai, r.account.session) { _, _ -> error("Word requires AI") }
        vm.start(PickedFile("cv.docx", 10, null, ByteArray(10)))
        assertEquals(ImportProblem.WordNeedsAi, vm.state.first { it.problem != null }.problem)
    }

    @Test fun formatsAndLocale() {
        fun file(name: String, body: String = "") = PickedFile(name, 1, null, body.toByteArray())
        assertEquals(ImportFormat.Pdf, ImportViewModel.formatOf(file("a.PDF")))
        assertEquals(ImportFormat.Pdf, ImportViewModel.formatOf(file("untyped", "%PDF-1.7")))
        assertEquals(ImportFormat.Word, ImportViewModel.formatOf(file("a.docx")))
        assertEquals(ImportFormat.LinkedIn, ImportViewModel.formatOf(file("export.zip")))
        assertEquals(ImportFormat.ReactiveResume, ImportViewModel.formatOf(file("a.json", """{"basics":{},"sections":{}}""")))
        assertEquals(ImportFormat.JsonResume, ImportViewModel.formatOf(file("a.json", """{"basics":{},"work":[]}""")))
        assertEquals(ImportFormat.JsonResume, ImportViewModel.formatOf(file("untyped", """{"basics":{},"work":[]}""")))
        assertEquals(ImportFormat.Unsupported, ImportViewModel.formatOf(file("a.json", "not json")))
        assertEquals(ImportFormat.Unsupported, ImportViewModel.formatOf(file("a.png")))
        val localized = ImportViewModel.withLocale(ApiJson.parseToJsonElement("""{"metadata":{"page":{"locale":"en-US"}}}""").jsonObject, "pt-PT")
        assertEquals(JsonPrimitive("pt-PT"), localized["metadata"]!!.jsonObject["page"]!!.jsonObject["locale"])
    }

    @Test fun trashDaysLeft() {
        val now = java.time.Instant.parse("2026-11-07T09:00:00Z")
        assertEquals(27, daysLeft("2026-11-04T09:00:00Z", now))
        assertEquals(0, daysLeft("2026-09-01T09:00:00Z", now))
    }
}

/** Complete generated DTO fixture: storyboard skill entries intentionally omit write-only defaults. */
internal suspend fun importData(r: me.rxresu.core.data.RrRepositories): JsonObject {
    val full = kotlinx.serialization.json.Json(ApiJson) { encodeDefaults = true }
    val sample = full.encodeToJsonElement(me.rxresu.core.network.generated.ResumeData.serializer(), r.resumes.getResume(StoryboardIds.resume).data).jsonObject
    return JsonObject(sample + ("sections" to JsonObject(sample.getValue("sections").jsonObject.mapValues { (_, section) ->
        JsonObject(section.jsonObject + ("items" to JsonArray(emptyList())))
    })) + ("customSections" to JsonArray(emptyList())))
}
