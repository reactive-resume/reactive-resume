package me.rxresu.feature.career

import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.font.FontWeight
import java.time.Instant
import java.time.ZoneId
import java.util.Locale
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class CareerFormatTest {
    private val now = Instant.parse("2026-11-07T09:00:00Z")
    private fun time(locale: Locale = Locale.UK, zone: String = "Europe/Lisbon", is24: Boolean = true) = CareerTime(locale, ZoneId.of(zone), is24, now)

    @Test fun daysReadRelativeThenAsWeekdayAndDate() {
        val t = time()
        assertEquals("Today", t.relativeDay("2026-11-07T00:30:00Z"))
        assertEquals("Yesterday", t.relativeDay("2026-11-06T18:00:00Z"))
        assertEquals("Tomorrow", t.relativeDay("2026-11-08"))
        assertEquals("Fri 13 Nov", t.relativeDay("2026-11-13"))
        assertEquals("Fri 13 Nov", t.day("2026-11-13"))
        assertEquals("4 Jan 2027", t.dateWithYear("2027-01-04"))
        assertEquals("Mon 9 Nov, 07:00", t.dayTime("2026-11-09T07:00:00Z"))
        assertNull(t.day("not a date"))
    }

    @Test fun theAccountTimezoneDecidesTheDay() {
        // 23:30 UTC on the 6th is still the 6th in Lisbon but already the 7th in Tokyo.
        assertEquals("Yesterday", time().relativeDay("2026-11-06T23:30:00Z"))
        assertEquals("Today", time(zone = "Asia/Tokyo").relativeDay("2026-11-06T23:30:00Z"))
        assertEquals("16:00", time(zone = "Asia/Tokyo").time("2026-11-09T07:00:00Z"))
    }

    @Test fun theLocaleDecidesOrderAndClock() {
        val us = time(Locale.US, is24 = false)
        assertEquals("Fri, Nov 13", us.day("2026-11-13"))
        assertTrue(us.time("2026-11-09T07:00:00Z")!!.startsWith("7:00"))
        assertEquals("Ayer", time(Locale.forLanguageTag("es-ES")).relativeDay("2026-11-06T18:00:00Z"))
    }

    @Test fun dateOnlyDeadlinesLastTheirWholeDay() {
        assertEquals(15L, time().hoursUntil("2026-11-07"))
        assertEquals(-1L, time().hoursUntil("2026-11-07T08:00:00Z"))
    }

    @Test fun replyBlocksFollowTypesetChat() {
        val blocks = markdownBlocks("Two roles fit:\n\n1. **Lumen**: hybrid\n   in Lisbon.\n2. Kiln Studio\nParcel asks for 3 days.\n\n- one\n  - nested\n\n> quoted\n> on\n\n```\ncode\n")
        assertEquals(listOf(
            MdBlock.Paragraph("Two roles fit:"),
            MdBlock.Item(0, "1.", "**Lumen**: hybrid in Lisbon."),
            MdBlock.Item(0, "2.", "Kiln Studio"),
            MdBlock.Paragraph("Parcel asks for 3 days."),
            MdBlock.Item(0, null, "one"),
            MdBlock.Item(1, null, "nested"),
            MdBlock.Quote("quoted on"),
            MdBlock.Code("code"),
        ), blocks)
        assertEquals(MdBlock.Table(listOf(listOf("Role", "Pay"), listOf("Lumen", "€72k"))), markdownBlocks("| Role | Pay |\n|---|---|\n| Lumen | €72k |").single())
        assertEquals(listOf(MdBlock.Heading("Plan"), MdBlock.Rule), markdownBlocks("## Plan\n---"))
    }

    @Test fun inlineRunsStyleWithoutLoadingImages() {
        val styled = markdownInline("**Lumen** and *Kiln*, `tokens`, [docs](https://example.com/a) ![tracker](https://evil.example/p.png) **open", SpanStyle(), TextLinkStyles())
        assertEquals("Lumen and Kiln, tokens, docs tracker **open", styled.text)
        assertEquals(FontWeight.SemiBold, styled.spanStyles.first { styled.text.substring(it.start, it.end) == "Lumen" }.item.fontWeight)
        val link = styled.getLinkAnnotations(0, styled.length).single()
        assertEquals("docs", styled.text.substring(link.start, link.end))
        assertEquals("https://example.com/a", (link.item as LinkAnnotation.Url).url)
        assertEquals("2_000 people", markdownInline("2_000 people", SpanStyle(), TextLinkStyles()).text)
    }

    @Test fun lookForTermsRoundTripThroughOneQuery() {
        assertEquals(listOf("Senior product designer", "Lisbon"), queryTerms(" Senior product designer, Lisbon,, Lisbon "))
        assertTrue(queryTerms("").isEmpty())
    }

    @Test fun prioritiesAreQuotedAsOneSentence() {
        assertNull(saidQuote("  "))
        assertEquals("At most 2 office days.", saidQuote("At most 2 office days"))
        assertEquals("First one.", saidQuote("First one. " + "x".repeat(170)))
    }
}
