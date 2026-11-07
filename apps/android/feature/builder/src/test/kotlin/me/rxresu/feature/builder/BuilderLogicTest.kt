package me.rxresu.feature.builder

import android.graphics.Rect
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.text.TextRange
import java.util.Locale
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import me.rxresu.core.network.ApiJson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** Pure builder logic: tap-to-block mapping, JSON edits, Fit steps, rich text, reorder and Check pointers. */
@RunWith(RobolectricTestRunner::class)
class BuilderLogicTest {
    private val doc = ResumeDoc(Fixtures.resume.toJson())

    private fun run(text: String, top: Float, left: Float = 0.07f, right: Float = 0.6f) = TextRun(text, left, top, right, top + 0.012f)

    /** The sample page's text as the PDF draws it, one run per line. */
    private val runs = listOf(
        run("Alex Morgan", 0.05f), run("Senior product designer", 0.09f), run("Lisbon, Portugal alex@morgan.design", 0.12f),
        run("Summary", 0.165f), run("Product designer with eight years in onboarding", 0.19f),
        run("Experience", 0.25f),
        run("Northwind Labs", 0.28f), run("Mar 2022 – Present", 0.28f, left = 0.75f, right = 0.93f), run("Senior product designer · Lisbon", 0.297f), run("Led the redesign of onboarding", 0.32f),
        run("Harbour Studio", 0.385f), run("Product designer · Porto", 0.402f),
        run("Education", 0.46f), run("University of Porto", 0.49f),
    )

    @Test fun tapOnAnEntryOpensThatEntry() {
        val blocks = PageBlocks.build(doc, listOf(runs), twoColumns = false)
        assertEquals(BlockTarget.Item("experience", "experience-northwind"), PageBlocks.hit(blocks, 0, 0.3f, 0.322f)?.target)
        assertEquals(BlockTarget.Item("experience", "experience-northwind"), PageBlocks.hit(blocks, 0, 0.85f, 0.285f)?.target)
        assertEquals(BlockTarget.Item("experience", "experience-harbour"), PageBlocks.hit(blocks, 0, 0.2f, 0.405f)?.target)
    }

    @Test fun tapOnTheNameOpensBasicsAndOnATitleTheSection() {
        val blocks = PageBlocks.build(doc, listOf(runs), twoColumns = false)
        assertEquals(BlockTarget.Header, PageBlocks.hit(blocks, 0, 0.1f, 0.095f)?.target)
        assertEquals(BlockTarget.Section("summary"), PageBlocks.hit(blocks, 0, 0.2f, 0.195f)?.target)
        assertEquals(BlockTarget.Section("experience"), PageBlocks.hit(blocks, 0, 0.1f, 0.255f)?.target)
    }

    @Test fun tapBetweenBlocksFallsBackToTheNearest() {
        val blocks = PageBlocks.build(doc, listOf(runs), twoColumns = false)
        // Below the last line on the page: the nearest block is Education's entry.
        assertEquals(BlockTarget.Item("education", "education-porto").section, (PageBlocks.hit(blocks, 0, 0.5f, 0.8f)?.target as BlockTarget.Item).section)
    }

    @Test fun twoColumnRunsJoinTheirOwnColumn() {
        val json = doc.json.set(listOf("data", "metadata", "layout", "pages"), JsonArray(listOf(JsonObject(mapOf(
            "fullWidth" to JsonPrimitive(false),
            "main" to JsonArray(listOf("experience").map(::JsonPrimitive)),
            "sidebar" to JsonArray(listOf("skills").map(::JsonPrimitive)),
        ))))).set(listOf("data", "metadata", "layout", "sidebarSide"), JsonPrimitive("left")).set(listOf("data", "metadata", "layout", "sidebarWidth"), JsonPrimitive(30)) as JsonObject
        val two = ResumeDoc(json)
        val page = listOf(
            run("Experience", 0.1f, left = 0.35f, right = 0.9f), run("Northwind Labs", 0.13f, left = 0.35f, right = 0.9f), run("Led the redesign", 0.2f, left = 0.35f, right = 0.9f),
            run("Skills", 0.1f, left = 0.05f, right = 0.25f), run("Figma", 0.2f, left = 0.05f, right = 0.25f),
        )
        val blocks = PageBlocks.build(two, listOf(page), twoColumns = true)
        // "Figma" sits beside Northwind's bullet but belongs to Skills in the sidebar.
        assertEquals(BlockTarget.Item("skills", "skill-6"), PageBlocks.hit(blocks, 0, 0.1f, 0.205f)?.target)
        assertEquals(BlockTarget.Section("skills"), PageBlocks.hit(blocks, 0, 0.1f, 0.103f)?.target)
        assertEquals(BlockTarget.Item("experience", "experience-northwind"), PageBlocks.hit(blocks, 0, 0.5f, 0.205f)?.target)
    }

    @Test fun noTextMeansNoBlocks() = assertTrue(PageBlocks.build(doc, listOf(emptyList()), false).isEmpty())

    @Test fun pdfContentsSplitIntoLines() {
        val r = PdfTextReader.runs(listOf("Northwind Labs\nSenior designer" to listOf(android.graphics.RectF(10f, 20f, 100f, 30f), android.graphics.RectF(10f, 32f, 90f, 42f))), 200, 400)
        assertEquals(listOf("Northwind Labs", "Senior designer"), r.map { it.text })
        assertEquals(0.05f, r[0].left, 0.0001f)
        assertEquals(0.08f, r[1].top, 0.0001f)
    }

    @Test fun everyNewEntryDecodesAsAResume() {
        for (kind in SectionKind.entries.filter { it != SectionKind.Summary }) {
            val ref = doc.section(kind.key) ?: continue
            val json = doc.json.update(ref.path + "items") { JsonArray(it.arr() + kind.newItem("new")) } as JsonObject
            val back = ResumeDoc(json.toResume().toJson())
            assertEquals(kind.name, "new", back.items(ref).last()["id"].str())
        }
    }

    @Test fun datesWriteStructuredAndLegacyText() {
        val item = SectionKind.Experience.newItem("x")
        val written = writeDates(item, SectionKind.Experience, YearMonth(2022, 3), null, present = true, raw = null, Locale.UK, "Present")
        assertEquals("2022-03", written["dates"].obj()["start"].str())
        assertEquals("Mar 2022 – Present", written["period"].str())
        val custom = writeDates(item, SectionKind.Awards, null, null, false, "Spring 2021", Locale.UK, "Present")
        assertEquals("Spring 2021", custom["date"].str())
        assertTrue(YearMonth(2020, 1) < YearMonth(2020, 2))
        assertEquals(YearMonth(2019, null), YearMonth.parse("2019"))
        assertNull(YearMonth.parse("March"))
    }

    @Test fun legacyDateTextBecomesStructuredDates() {
        val upgraded = LegacyDates.read("Mar 2022 – Present")
        assertEquals("2022-03", upgraded["start"].str())
        assertTrue(upgraded["present"].bool())
        assertEquals("2019", LegacyDates.read("2017 – 2019")["end"].str())
        assertEquals("Spring 2021", LegacyDates.read("Spring 2021")["raw"].str())
    }

    @Test fun fitTightensDensityThenMarginsThenSize() {
        var json = doc.json
        val seen = mutableListOf<String>()
        while (true) {
            val step = FitSteps.next(json) ?: break
            json = step(json)
            val m = ResumeDoc(json).metadata
            seen += "${Density.of(json)}/${Margins.of(json)}/${m["typography"].obj()["body"].obj()["fontSize"].num()}"
        }
        assertEquals("Compact/null/10.0", seen.first())
        assertEquals("Compact/Narrow/10.0", seen[1])
        assertEquals("Compact/Narrow/9.0", seen.last())
        assertEquals(4, seen.size)
    }

    @Test fun textSizeKeepsTheHeadingRatio() {
        val json = TextSize.apply(doc.json, 11.0)
        assertEquals(15.5, json.at(listOf("data", "metadata", "typography", "heading", "fontSize")).num()!!, 0.0)
    }

    @Test fun richTextKeepsMarkupOnUntouchedLines() {
        val rich = RichDoc.parse("<ul><li>Led the <strong>redesign</strong>.</li><li>Ran interviews.</li></ul>")
        assertEquals(ListKind.Bullets, rich.kind)
        assertEquals(listOf("Led the redesign.", "Ran interviews."), rich.plain)
        val edited = rich.withText("Led the redesign.\nRan 40+ interviews.")
        assertEquals("<ul><li>Led the <strong>redesign</strong>.</li><li>Ran 40+ interviews.</li></ul>", edited.toHtml())
        assertEquals("<ol><li><em>Led the <strong>redesign</strong>.</em></li><li>Ran 40+ interviews.</li></ol>", edited.toggle(edited.target(TextRange(0)), "em").copy(kind = ListKind.Numbers).toHtml())
        assertNull(rich.replace("Not there", "x"))
        assertEquals("Ran &lt;10 interviews.", rich.replace("Ran interviews.", "Ran <10 interviews.")!!.lines[1])
    }

    @Test fun boldItalicAndLinksApplyToTheSelectionRange() {
        val rich = RichDoc.parse("<ul><li>Led the redesign of onboarding.</li><li>Ran interviews.</li></ul>")
        val redesign = rich.text.indexOf("redesign")
        val bold = rich.toggle(rich.target(TextRange(redesign, redesign + 8)), "strong")
        assertEquals("Led the <strong>redesign</strong> of onboarding.", bold.lines[0])
        assertTrue(bold.has(redesign until redesign + 8, "strong"))
        // Toggling a range that's partly bold makes all of it bold; toggling it again clears it.
        val wider = bold.toggle(rich.target(TextRange(redesign - 4, redesign + 8)), "strong")
        assertEquals("Led <strong>the redesign</strong> of onboarding.", wider.lines[0])
        assertEquals("Led the redesign of onboarding.", wider.toggle(redesign - 4 until redesign + 8, "strong").lines[0])
        val linked = bold.toggle(redesign until redesign + 8, "em").link(redesign until redesign + 8, "https://example.com/a?b=\"c\"")
        assertEquals("Led the <a href=\"https://example.com/a?b=&quot;c&quot;\"><strong><em>redesign</em></strong></a> of onboarding.", linked.lines[0])
        assertEquals("Led the redesign of onboarding.", linked.link(redesign until redesign + 8, "").toggle(redesign until redesign + 8, "strong").toggle(redesign until redesign + 8, "em").lines[0])
        // A selection across lines formats both lines and keeps the newline plain.
        val both = rich.toggle(rich.target(TextRange(20, 35)), "em")
        assertEquals(listOf("Led the redesign of <em>onboarding.</em>", "<em>Ran</em> interviews."), both.lines)
    }

    @Test fun typingKeepsMarksAroundTheEditAndUntouchedMarkup() {
        val rich = RichDoc.parse("<p>Led the <strong>redesign</strong>.</p><p>Kept <mark data-color=\"yellow\">this</mark>.</p>")
        // Typing inside a bold word stays bold; typing after the plain full stop doesn't.
        val typed = rich.withText(rich.text.replace("redesign.", "redesigns.")).let { it.withText(it.text.replace("redesigns.", "redesigns. Now")) }
        assertEquals("Led the <strong>redesigns</strong>. Now", typed.lines[0])
        // The untouched line keeps the highlight the editor doesn't draw.
        assertEquals("Kept <mark data-color=\"yellow\">this</mark>.", typed.lines[1])
        assertEquals("<p>Led the <strong>redesigns</strong>. Now</p><p>Kept <mark data-color=\"yellow\">this</mark>.</p>", typed.toHtml())
        // Typing at the end of a link doesn't extend it.
        val link = RichDoc.parse("<p>See <a href=\"https://a.b\">site</a></p>")
        assertEquals("See <a href=\"https://a.b\">site</a> now", link.withText("See site now").lines[0])
        // A new line splits marks cleanly.
        assertEquals(listOf("<strong>Led</strong>", "<strong>the</strong>"), RichDoc.parse("<p><b>Led the</b></p>").withText("Led\nthe").lines)
    }

    @Test fun cropFrameCoversAndClampsLikeTheWeb() {
        val photo = Size(4000f, 3000f)
        val frame = CropMath.frame(Size(1000f, 1200f), aspect = 1f, inset = 50f)
        assertEquals(Size(900f, 900f), frame)
        assertEquals(Size(500f, 1000f), CropMath.frame(Size(1100f, 1100f), aspect = 0.5f, inset = 50f))
        // Zoom 1 covers the frame by its short side: a centred 3000 × 3000 square.
        assertEquals(Rect(500, 0, 3500, 3000), CropMath.area(photo, frame, 1f, Offset.Zero))
        // Panning past the photo's edge stops at the edge.
        assertEquals(Rect(0, 0, 3000, 3000), CropMath.area(photo, frame, 1f, Offset(10_000f, 0f)))
        CropMath.clamp(Offset(10_000f, 10_000f), photo, frame, 1f).let { assertEquals(150f, it.x, 0.01f); assertEquals(0f, it.y, 0.01f) }
        // Zoom 2 halves the area; dragging right shows more of the left.
        assertEquals(Rect(1250, 750, 2750, 2250), CropMath.area(photo, frame, 2f, Offset.Zero))
        assertEquals(Rect(1125, 750, 2625, 2250), CropMath.area(photo, frame, 2f, Offset(75f, 0f)))
        // Over the limit, each pass shrinks by at most 0.9.
        assertEquals(0.9, CropMath.shrink(11, 10), 0.0)
        assertEquals(0.475, CropMath.shrink(40, 10), 1e-9)
    }

    @Test fun outlineAutoScrollsOnlyInTheOuterEightPercent() {
        assertEquals(0f, ReorderMath.autoScrollStep(500f, 0f, 1000f, 12f), 0f)
        assertEquals(0f, ReorderMath.autoScrollStep(80f, 0f, 1000f, 12f), 0f)
        assertEquals(-6f, ReorderMath.autoScrollStep(40f, 0f, 1000f, 12f), 1e-4f)
        assertEquals(-12f, ReorderMath.autoScrollStep(-30f, 0f, 1000f, 12f), 0f)
        assertEquals(12f, ReorderMath.autoScrollStep(1000f, 0f, 1000f, 12f), 0f)
        assertEquals(3f, ReorderMath.autoScrollStep(940f, 0f, 1000f, 12f), 1e-4f)
    }

    @Test fun outsideChangesUseTheWebsAttribution() {
        assertEquals(R.string.builder_outside_agent, outsideChangeText("patch"))
        assertEquals(R.string.builder_outside_sharing, outsideChangeText("lock"))
        assertEquals(R.string.builder_outside_synced, outsideChangeText(null))
    }

    @Test fun reorderSwapsPastHalfANeighbour() {
        val heights = listOf(50, 50, 100, 50)
        assertEquals(0, ReorderMath.target(0, 20f, heights))
        assertEquals(1, ReorderMath.target(0, 30f, heights))
        assertEquals(2, ReorderMath.target(0, 101f, heights))
        assertEquals(1, ReorderMath.target(3, -130f, heights))
        assertEquals(listOf("b", "c", "a"), listOf("a", "b", "c").moved(0, 2))
        assertEquals(listOf("x", "summary", "b", "a"), mergeOrder(listOf("x", "a", "summary", "b"), listOf("summary", "b", "a")))
    }

    @Test fun checkPointersFindTheirBlock() {
        assertEquals(BlockTarget.Header, CheckPointer.target(doc, "/basics/website/url"))
        assertEquals(BlockTarget.Item("experience", "experience-harbour"), CheckPointer.target(doc, "/sections/experience/items/1/period"))
        assertEquals(BlockTarget.Section("skills"), CheckPointer.target(doc, "/sections/skills/columns"))
        assertNull(CheckPointer.target(doc, "/metadata/typography/body/lineHeight"))
        assertEquals(listOf("data", "basics", "website", "url"), CheckPointer.path("/basics/website/url"))
    }

    @Test fun oneColumnMovesTheSidebarIntoMain() {
        val pages = oneColumn(listOf(PageLayout(listOf("experience"), listOf("skills"), false)))
        assertEquals(listOf(PageLayout(listOf("experience", "skills"), emptyList(), true)), pages)
    }

    @Test fun accentsAndContrast() {
        assertEquals("rgba(47, 90, 138, 1)", Rgba.fromHex("#2F5A8A"))
        assertEquals("#2F5A8A", Rgba.toHex("rgba(47, 90, 138, 1)"))
        assertNull(Rgba.fromHex("#12"))
        assertTrue(Rgba.contrastOnWhite("#FFEE88") < 4.5)
        assertTrue(Rgba.contrastOnWhite(Rgba.darker("#FFEE88")) >= 4.6)
    }

    @Test fun emailHintsMatchTheWeb() {
        assertNull(emailProblem("alex@morgan.design"))
        assertEquals(me.rxresu.core.strings.R.string.add_an_and_the_domain_like_name_example_com, emailProblem("alex")?.first)
        assertEquals("alex", emailProblem("alex@")?.second)
        assertEquals("morgan", emailProblem("alex@morgan")?.second)
    }

    @Test fun designResetKeepsPaperAndLanguage() {
        val changed = Margins.Wide.apply(doc.json).set(listOf("data", "metadata", "page", "format"), JsonPrimitive("letter")) as JsonObject
        val reset = ResumeDoc(DesignDefaults.reset(changed))
        assertEquals(Margins.Normal, Margins.of(reset.json))
        assertEquals("letter", reset.metadata["page"].obj()["format"].str())
        assertNotNull(ApiJson.decodeFromJsonElement(me.rxresu.core.network.generated.Resume.serializer(), reset.json))
    }
}
