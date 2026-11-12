package me.rxresu.feature.today

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import me.rxresu.core.data.FakeControls
import me.rxresu.core.data.FakeMode
import me.rxresu.core.data.FakeRepositories
import me.rxresu.core.data.StoryboardIds
import me.rxresu.core.data.TodayKind
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class TodayViewModelTest {
    @Before fun main() = Dispatchers.setMain(UnconfinedTestDispatcher())
    @After fun reset() = Dispatchers.resetMain()

    private fun vm(controls: FakeControls = FakeControls()) = FakeRepositories(controls).let { TodayViewModel(it.today, it.applications, it.account) }

    @Test fun joinsNeedsYouWithTheApplication() = runTest {
        val vm = vm()
        val state = vm.state.first { it.needsYou.isNotEmpty() && it.initials.isNotEmpty() }
        val briefing = state.needsYou.first()
        assertEquals(TodayKind.Briefing, briefing.item.kind)
        assertEquals("Senior product designer", briefing.role)
        assertEquals(StoryboardIds.interview, briefing.interview?.id)
        assertEquals("AM", state.initials)
        assertFalse(state.newAccount)
    }

    @Test fun markAsReadHidesTheItemAndUndoBringsItBack() = runTest {
        val vm = vm()
        val item = vm.state.first { it.needsYou.isNotEmpty() }.needsYou.first().item
        vm.dismiss(item)
        assertTrue(vm.state.first { s -> s.needsYou.none { it.item.id == item.id } }.needsYou.none { it.item.id == item.id })
        vm.undoDismiss(item)
        assertTrue(vm.state.first { s -> s.needsYou.any { it.item.id == item.id } }.needsYou.any { it.item.id == item.id })
    }

    @Test fun trackingSelectedRolesKeepsFailuresSelected() = runTest {
        val controls = FakeControls()
        val vm = vm(controls)
        val roles = vm.state.first { it.newRoles.size >= 2 }.newRoles
        vm.toggleRole(roles[0].id)
        vm.toggleRole(roles[1].id)
        controls.set("trackCareerOpportunity", FakeMode.Error())
        assertEquals(0 to 2, vm.applyToSelection(track = true))
        assertEquals(setOf(roles[0].id, roles[1].id), vm.state.value.selectedRoles)

        controls.reset()
        assertEquals(2 to 0, vm.applyToSelection(track = true))
        val after = vm.state.first { it.selectedRoles.isEmpty() }
        assertTrue(after.newRoles.none { it.id == roles[0].id || it.id == roles[1].id })
    }

    @Test fun checklistClosesOnceRemindersAreOn() = runTest {
        val vm = vm()
        assertTrue(vm.state.first { it.firstRun != null }.showChecklist)
        vm.setRemindersEnabled(true)
        assertFalse(vm.state.first { it.firstRun?.remindersEnabled == true }.showChecklist)
    }

    @Test fun newAccountShowsTheFirstRun() = runTest {
        val state = vm(FakeControls(FakeMode.Empty)).state.first { it.firstRun != null }
        assertTrue(state.newAccount)
        assertTrue(state.needsYou.isEmpty())
    }

    @Test fun initials() {
        assertEquals("AM", TodayViewModel.initials("Alex Morgan"))
        assertEquals("AR", TodayViewModel.initials(" Ana Maria  Rosa "))
        assertEquals("P", TodayViewModel.initials("Priya"))
        assertEquals("", TodayViewModel.initials(""))
    }
}
