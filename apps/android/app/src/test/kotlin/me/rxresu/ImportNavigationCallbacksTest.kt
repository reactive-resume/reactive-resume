package me.rxresu

import android.app.Activity
import android.content.Intent
import android.net.Uri
import androidx.compose.ui.test.*
import androidx.navigation.NavDestination.Companion.hasRoute
import androidx.navigation.toRoute
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import kotlinx.coroutines.runBlocking
import me.rxresu.core.navigation.*
import me.rxresu.core.data.FakeControls
import me.rxresu.core.data.StoryboardIds
import me.rxresu.core.network.ApiJson
import me.rxresu.core.network.generated.ResumeData
import kotlinx.serialization.json.*
import me.rxresu.core.network.generated.CreateResumeImportRequestData
import org.junit.Assert.*
import org.junit.Test
import org.robolectric.Shadows.shadowOf

class ImportNavigationCallbacksTest : ProductionNavigationTest() {
    @Test fun newDocumentSystemPickerThenAiReviewCreatesAndOpensTheImportedResume() {
        val controls = FakeControls()
        start(TodayTab, controls)
        val parsed = runBlocking { repositories.resumes.getResume(StoryboardIds.resume).data }
        val full = Json(ApiJson) { encodeDefaults = true }
        val response = full.encodeToJsonElement(ResumeData.serializer(), parsed).jsonObject
        val sections = response.getValue("sections").jsonObject
        val skills = sections.getValue("skills").jsonObject
        // Display-only storyboard skills omit write defaults; a parsed AI reply has the complete import shape.
        val defaults = buildJsonObject { put("hidden", false); put("icon", ""); put("iconColor", ""); put("keywords", buildJsonArray {}); put("level", 0); put("proficiency", "") }
        val completeSkills = JsonObject(skills + ("items" to JsonArray(skills.getValue("items").jsonArray.map { JsonObject(defaults + it.jsonObject) })))
        val complete = JsonObject(response + ("sections" to JsonObject(sections + ("skills" to completeSkills))))
        assertEquals(skills.getValue("items").jsonArray.size, ApiJson.decodeFromJsonElement(CreateResumeImportRequestData.serializer(), complete).sections.skills.items.size)
        controls.responses.value = mapOf("parseResumeDocx" to complete)
        val file = Uri.parse("content://me.rxresu.navigation/fictional-resume.docx")
        val bytes = fictionalDocx()
        shadowOf(activity.contentResolver).registerInputStreamSupplier(file) { ByteArrayInputStream(bytes) }
        visit(DocumentsTab)
        visit(NewDocument())
        click("Import a resume")
        val picker = requireNotNull(shadowOf(activity).nextStartedActivityForResult)
        assertEquals(Intent.ACTION_OPEN_DOCUMENT, picker.intent.action)
        assertTrue(picker.intent.getStringArrayExtra(Intent.EXTRA_MIME_TYPES).orEmpty().contains("application/vnd.openxmlformats-officedocument.wordprocessingml.document"))
        rule.runOnIdle { shadowOf(activity).receiveResult(picker.intent, Activity.RESULT_OK, Intent().setData(file)) }
        expect(Import(file.toString()))
        ready("fictional-resume.docx")
        ready("Read with AI")
        // The method row selects AI; the second control explicitly authorizes reading.
        rule.onAllNodes(hasText("Read with AI") and hasClickAction()).onLast().assertIsEnabled().performClick()
        ready("Check what was found")
        click("Create resume")
        awaitRoute<Builder>()
        val id = rule.runOnIdle { requireNotNull(nav.currentBackStackEntry).toRoute<Builder>().resumeId }
        assertTrue(id.isNotBlank())
        val imported = runBlocking { repositories.resumes.getResume(id) }
        assertEquals(id, imported.id)
        assertEquals(parsed.basics.name, imported.data.basics.name)
        assertEquals(parsed.sections.experience.items.first().company, imported.data.sections.experience.items.first().company)
        rule.runOnIdle {
            assertFalse(requireNotNull(nav.previousBackStackEntry).destination.hasRoute<Import>())
        }
    }

    private fun fictionalDocx(): ByteArray = ByteArrayOutputStream().also { bytes ->
        ZipOutputStream(bytes).use { zip ->
            mapOf(
                "[Content_Types].xml" to """<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>""",
                "_rels/.rels" to """<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>""",
                "word/document.xml" to """<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Alex Morgan, product designer</w:t></w:r></w:p></w:body></w:document>""",
            ).forEach { (name, xml) ->
                zip.putNextEntry(ZipEntry(name))
                zip.write(xml.toByteArray())
                zip.closeEntry()
            }
        }
    }.toByteArray()
}
