package me.rxresu.feature.today

import java.time.Instant
import java.time.ZoneId
import java.util.Locale
import me.rxresu.core.data.TodayItem
import me.rxresu.core.data.TodayKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import me.rxresu.core.testing.RrScreenshotTest

class TodayPresentationTest : RrScreenshotTest() {
    private val now = Instant.parse("2026-11-07T10:00:00Z")
    private fun entry(id: String, kind: TodayKind, at: String? = null) = TodayEntry(TodayItem(id, id, "Company", "technical", at, kind))

    @Test fun readyBriefingWinsButDistantInterviewDoesNotHideAnOffer() {
        val briefing = entry("briefing", TodayKind.Briefing, "2026-11-10T10:00:00Z")
        val offer = entry("offer", TodayKind.Offer, "2026-11-13T00:00:00Z")
        val interview = entry("interview", TodayKind.Interview, "2026-11-10T10:00:00Z")
        assertEquals(briefing, todayHero(listOf(offer, briefing), listOf(interview), now))
        assertEquals(offer, todayHero(listOf(offer), listOf(interview), now))
        assertNull(todayHero(listOf(entry("notice", TodayKind.Notification)), emptyList(), now))
    }

    @Test fun lisbonDatesKeepStoryboardDayMonthOrderAndTwentyFourHourClock() {
        val format = TodayFormat(Locale.forLanguageTag("en-PT"), ZoneId.of("Europe/Lisbon"), true)
        assertEquals("Saturday, 7 November", format.header(now.atZone(format.zone).toLocalDate()))
        val at = requireNotNull(format.parse("2026-11-10T10:00:00Z"))
        assertEquals("Tuesday 10 Nov", format.fullDay(at))
        assertEquals("10:00", format.time(at))
    }
}
