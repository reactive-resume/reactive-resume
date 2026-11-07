package me.rxresu.feature.builder

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
        assertEquals("<ol><li><em>Led the <strong>redesign</strong>.</em></li><li>Ran 40+ interviews.</li></ol>", edited.toggle(0, "em").copy(kind = ListKind.Numbers).toHtml())
        assertNull(rich.replace("Not there", "x"))
        assertEquals("Ran &lt;10 interviews.", rich.replace("Ran interviews.", "Ran <10 interviews.")!!.lines[1])
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
