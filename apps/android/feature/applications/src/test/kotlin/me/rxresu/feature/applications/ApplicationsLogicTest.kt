package me.rxresu.feature.applications

import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.util.Locale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import me.rxresu.core.data.ApplicationQuery
import me.rxresu.core.data.CalendarItem
import me.rxresu.core.data.FakeRepositories
import me.rxresu.core.data.StoryboardIds
import me.rxresu.core.network.generated.ApplicationStage
import me.rxresu.core.network.generated.PatchApplicationClosedReason
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ApplicationsLogicTest {
    private val repos = FakeRepositories()
    private val zone = ZoneId.of("Europe/Lisbon")

    @Before fun main() = Dispatchers.setMain(UnconfinedTestDispatcher())
    @After fun reset() = Dispatchers.resetMain()

    private suspend fun vm(): ApplicationsViewModel {
        val vm = ApplicationsViewModel(repos.applications, repos.career, repos.documents, repos.account, repos.time)
        vm.state.first { it.rows != null && it.lanes.isNotEmpty() }
        return vm
    }

    @Test fun listGroupsWhatNeedsYouFirstAndHidesClosed() = runTest {
        val state = vm().state.first { it.rows != null && it.lanes.isNotEmpty() }
        val groups = groupRows(state.rows!!, state.lanes).map { it.second.first().app.status }
        assertEquals(listOf(ApplicationStage.Interview, ApplicationStage.Offer, ApplicationStage.Screening, ApplicationStage.Applied), groups)
        assertTrue(state.rows!!.none { it.app.status == ApplicationStage.Closed })
    }

    @Test fun filtersCombine() = runTest {
        val vm = vm()
        vm.setFilters(ApplicationFilters(showClosed = true, stage = ApplicationStage.Closed))
        val closed = vm.state.first { it.filters.stage == ApplicationStage.Closed }.rows!!
        assertTrue(closed.isNotEmpty() && closed.all { it.app.status == ApplicationStage.Closed })
        vm.setFilters(ApplicationFilters(needsYou = true))
        val needs = vm.state.first { it.filters.needsYou }
        assertEquals(needs.needsYouCount, needs.rows!!.size)
        assertTrue(needs.rows!!.all { it.attention })
        vm.setFilters(ApplicationFilters(text = "orbital"))
        assertEquals(listOf(StoryboardIds.orbital), vm.state.first { it.filters.text == "orbital" }.rows!!.map { it.app.id })
    }

    @Test fun swipeToNextStageMovesAndUndoRestores() = runTest {
        val lanes = repos.applications.getApplicationLanes().lanes
        val moves = ApplicationMoves(repos.applications)
        val before = repos.applications.getApplication(StoryboardIds.fieldnote)
        val next = nextLane(lanes, displayLane(lanes, before))!!
        assertEquals(ApplicationStage.Screening, next.category)
        assertEquals(ApplicationStage.Screening, moves.move(before.id, next, next.category).status)
        assertEquals(ApplicationStage.Applied, moves.restore(before.id, before.snapshot()).status)
        assertNull(nextLane(lanes, categoryLane(lanes, ApplicationStage.Offer)))
    }

    @Test fun closingKeepsTheReasonAndTrashCanBeUndone() = runTest {
        val moves = ApplicationMoves(repos.applications)
        val lanes = repos.applications.getApplicationLanes().lanes
        val closed = moves.move(StoryboardIds.kiln, categoryLane(lanes, ApplicationStage.Closed), ApplicationStage.Closed, PatchApplicationClosedReason.Withdrew)
        assertEquals(PatchApplicationClosedReason.Withdrew, closed.closedReason)
        assertEquals(ApplicationStage.Applied, stageBeforeClosed(closed))
        val stamp = moves.trash(StoryboardIds.kiln)
        assertTrue(repos.applications.observe(ApplicationQuery(showClosed = true)).first { it.data != null }.data!!.none { it.id == StoryboardIds.kiln })
        moves.untrash(StoryboardIds.kiln, stamp)
        assertTrue(repos.applications.observe(ApplicationQuery(showClosed = true)).first { r -> r.data?.any { it.id == StoryboardIds.kiln } == true }.data != null)
    }

    @Test fun calendarGroupsByLocalDayAndOpensOnTodayOrTheNextBusyDay() {
        val items = listOf(
            CalendarItem("a", "x", "Lumen", "technical", "2026-11-10T10:00:00Z", "interview"),
            CalendarItem("b", "y", "Orbital", "screening", "2026-11-09T23:30:00Z", "interview"),
            CalendarItem("c", "z", "Parcel", "Respond", "2026-11-13T00:00:00Z", "offer"),
        )
        val byDay = itemsByDay(items, zone)
        // 23:30 UTC on 9 Nov is still 9 Nov in Lisbon (UTC+0 in November).
        assertEquals(listOf(LocalDate.of(2026, 11, 9), LocalDate.of(2026, 11, 10), LocalDate.of(2026, 11, 13)), byDay.keys.toList())
        assertEquals(LocalDate.of(2026, 11, 9), initialDay(byDay, LocalDate.of(2026, 11, 7)))
        assertEquals(LocalDate.of(2026, 11, 10), initialDay(byDay, LocalDate.of(2026, 11, 10)))
        assertEquals(LocalDate.of(2026, 11, 20), initialDay(byDay, LocalDate.of(2026, 11, 20)))
        assertEquals(LocalDate.of(2026, 11, 9), weekOf(LocalDate.of(2026, 11, 12), Locale.UK).first())
        assertEquals(LocalDate.of(2026, 11, 8), weekOf(LocalDate.of(2026, 11, 12), Locale.US).first())
    }

    @Test fun insightsCompareTailoredOnlyWithThreeOfEach() = runTest {
        val apps = repos.applications.listApplications()
        val resumes = repos.documents.listDocuments().associateBy { it.id }
        val comparison = compareTailored(apps, resumes)
        assertEquals(apps.count { wasSent(it) && it.resumeId != null }, comparison.tailoredSent + comparison.baseSent)
        assertFalse(Comparison(2, 1, 9, 3).enough)
        assertTrue(Comparison(3, 1, 3, 0).enough)
        // A "not selected" closing is a reply; "no response" isn't.
        assertTrue(repliedTo(apps.first { it.id == "application-closed-1" }))
        assertFalse(repliedTo(apps.first { it.id == "application-closed-3" }))
    }

    @Test fun interviewTimesThatDontExistInTheZoneAreRefused() {
        val gap = InterviewDraft("x", date = LocalDate.of(2026, 3, 29), time = LocalTime.of(1, 30), zone = zone)
        assertTrue(gap.timeMissingInZone())
        assertNull(gap.at())
        val ok = gap.copy(time = LocalTime.of(10, 0))
        assertEquals("2026-03-29T09:00:00Z", ok.at().toString())
    }

    @Test fun followUpsAreDateOnlyAtUtcMidnight() {
        val body = followUpRequest(LocalDate.of(2026, 11, 16), "  ")
        assertEquals("2026-11-16T00:00:00Z", body.followUpAt)
        assertEquals(true, body.followUpDateOnly)
        assertNull(body.followUpNote)
    }

    @Test fun icsEscapesTextAndMarksCancellations() {
        val event = CalendarEvent("i1", "Lumen; technical, round 1", java.time.Instant.parse("2026-11-10T10:00:00Z"), 60, "Rua do Alecrim 12")
        val ics = icsFor(event, java.time.Instant.parse("2026-11-07T09:00:00Z"), cancel = true)
        assertTrue(ics.contains("SUMMARY:Lumen\\; technical\\, round 1"))
        assertTrue(ics.contains("DTEND:20261110T110000Z"))
        assertTrue(ics.contains("METHOD:CANCEL") && ics.contains("STATUS:CANCELLED"))
    }

    @Test fun saveJobReadsThePostingAndSavesTheJob() = runTest {
        val vm = SaveJobViewModel(repos.applications, repos.documents, repos.time, signedIn = true, initialUrl = null)
        vm.setInput("Senior designer at Lumen")
        assertFalse(vm.state.value.isLink)
        vm.update { it.copy(role = "Senior product designer", company = "Lumen") }
        val id = vm.save()!!
        assertEquals("Lumen", repos.applications.getApplication(id).company)
    }

    @Test fun moveSheetReportsAFailedWriteAndKeepsTheSheet() = runTest {
        val controls = me.rxresu.core.data.FakeControls()
        val failing = FakeRepositories(controls)
        val vm = MoveViewModel(failing.applications, failing.documents, failing.time, StoryboardIds.lumen)
        controls.set("patchApplication", me.rxresu.core.data.FakeMode.Error())
        assertFalse(vm.apply(MoveChoice(null, ApplicationStage.Offer)))
        assertEquals(WriteError.Failed, vm.state.first { it.error != null }.error)
    }

    @Test fun markAsAppliedSendsTheDayNotAnInstant() {
        val patch = appliedPatch(MoveChoice(null, ApplicationStage.Applied), AppliedDetails(java.time.LocalDate.of(2026, 11, 8), null, null))
        assertEquals("2026-11-08", patch.stageEnteredAt)
    }
}
