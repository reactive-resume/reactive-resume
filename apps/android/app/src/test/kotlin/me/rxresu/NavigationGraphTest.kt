package me.rxresu

import androidx.compose.ui.test.*
import androidx.navigation.NavDestination.Companion.hasRoute
import androidx.navigation.toRoute
import me.rxresu.core.data.StoryboardIds
import me.rxresu.core.navigation.*
import org.junit.Assert.*
import org.junit.Test

/** Exercises the registration boundary used by RrApp, with real feature graphs and fake repositories. */
class NavigationGraphTest : ProductionNavigationTest() {
    @Test fun rootDockClicksRunProductionShellCallbacksIncludingReselect() {
        startShell()
        val tabs = listOf("Today" to TodayTab, "Documents" to DocumentsTab, "Applications" to ApplicationsTab(), "Career" to CareerTab)
        tabs.forEach { (_, source) ->
            rule.runOnIdle { nav.switchTab(source) }
            tabs.forEach { (label, target) ->
                rule.runOnIdle { nav.switchTab(source) }
                rule.onNode(hasText(label) and isSelectable()).performClick()
                rule.runOnIdle {
                    assertTrue("$source dock $label", requireNotNull(nav.currentDestination).hasRoute(target::class))
                    if (target is ApplicationsTab) assertEquals(target, requireNotNull(nav.currentBackStackEntry).toRoute<ApplicationsTab>())
                }
                rule.onNode(hasText(label) and isSelectable()).assertIsSelected()
            }
        }
    }

    @Test fun everyStoryboardEdgeResolvesTypedArgumentsPresentationAndReturnStack() {
        val edges = storyboardEdges()
        assertEquals("Storyboard edge inventory changed; audit new controls", 210, edges.map { it.source to it.designTarget }.distinct().size)
        assertEquals("More correction must retain B6 preview as well", 211, edges.map { it.source to it.target }.distinct().size)
        start(TodayTab)
        // Batch navigation before the next frame: this proves production graph contracts, not UI callbacks.
        rule.runOnIdle {
            edges.forEach { edge ->
                val source = storyboardRoute(edge.source)
                val target = storyboardRoute(edge.target)
                nav.navigate(source.route)
                source.assertEntry(requireNotNull(nav.currentBackStackEntry), "$edge source")
                val parent = requireNotNull(nav.currentBackStackEntry)
                nav.navigate(target.route)
                target.assertEntry(requireNotNull(nav.currentBackStackEntry), "$edge target")
                assertTrue("$edge cannot return", nav.popBackStack())
                if (source.sheet && !target.sheet) {
                    // Navigation dismisses floating windows when their action opens a full screen.
                    assertTrue("$edge expected underlying root", requireNotNull(nav.currentDestination).hasRoute<TodayTab>())
                    assertNull("$edge retained a dismissed sheet", nav.previousBackStackEntry)
                } else {
                    assertSame("$edge lost its source entry", parent, nav.currentBackStackEntry)
                    assertTrue("$edge leaked source entry", nav.popBackStack())
                }
            }
            assertTrue(requireNotNull(nav.currentDestination).hasRoute<TodayTab>())
        }
    }

    @Test fun builderEllipsisAlwaysOpensDocumentMenuAndReturnsToCurrentMode() {
        start(DocumentsTab)
        val routes = BuilderMode.entries.map { Builder(StoryboardIds.resume, mode = it) } +
            Builder(StoryboardIds.resume, mode = BuilderMode.Check, check = CheckTab.JobMatch)
        routes.forEach { route ->
            visit(route)
            rule.onNodeWithContentDescription("More", substring = false).performClick()
            rule.runOnIdle {
                assertEquals(BuilderMore(StoryboardIds.resume), requireNotNull(nav.currentBackStackEntry).toRoute<BuilderMore>())
                assertEquals("dialog", requireNotNull(nav.currentDestination).navigatorName)
                assertTrue(nav.popBackStack())
                assertEquals(route, requireNotNull(nav.currentBackStackEntry).toRoute<Builder>())
                assertTrue(nav.popBackStack())
            }
        }
    }

    @Test fun builderDockChangesRealModeContentAndSelectedItem() {
        start(DocumentsTab)
        val failures = mutableListOf<String>()
        val sources = BuilderMode.entries.map { Builder(StoryboardIds.resume, mode = it) } +
            Builder(StoryboardIds.resume, mode = BuilderMode.Check, check = CheckTab.JobMatch)
        sources.forEach { source ->
            listOf("Edit" to "Basics", "Design" to "Template", "Check" to "Issues", "Share" to "Other formats").forEach { (label, content) ->
                try {
                    visit(source)
                    rule.onNode(hasText(label) and isSelectable()).performClick().assertIsSelected()
                    val modeContent = rule.onAllNodes(hasText(content)).onFirst()
                    if (!modeContent.isDisplayed()) modeContent.performScrollTo()
                    modeContent.assertIsDisplayed()
                    if (label == "Check") rule.onNode(hasText(if (source.check == CheckTab.JobMatch) "Job match" else "Issues") and isSelectable()).assertIsSelected()
                    rule.runOnIdle {
                        assertTrue(requireNotNull(nav.currentDestination).hasRoute<Builder>())
                        assertTrue(nav.popBackStack())
                    }
                } catch (failure: AssertionError) {
                    failures += "$source dock $label: ${failure.message}"
                    rule.runOnIdle { nav.resetTo(DocumentsTab) }
                }
            }
        }
        assertTrue(failures.joinToString("\n"), failures.isEmpty())
    }

    @Test fun letterDockChangesModeAndExportsTheLetterIdentity() {
        start(DocumentsTab)
        LetterMode.entries.forEach { source ->
            listOf("Write", "Design", "Export").forEach { label ->
                visit(Letter(StoryboardIds.lumenLetter, source))
                val control = rule.onNode(hasText(label) and isSelectable())
                control.performClick()
                if (label != "Export") control.assertIsSelected()
                rule.runOnIdle {
                    if (label == "Export") {
                        assertEquals(Download(StoryboardIds.lumenLetter, DocumentKind.Letter), requireNotNull(nav.currentBackStackEntry).toRoute<Download>())
                        assertEquals("dialog", requireNotNull(nav.currentDestination).navigatorName)
                        assertTrue(nav.popBackStack())
                    } else {
                        assertEquals(StoryboardIds.lumenLetter, requireNotNull(nav.currentBackStackEntry).toRoute<Letter>().letterId)
                    }
                    assertTrue(nav.popBackStack())
                }
            }
        }
    }

    @Test fun settingsRowsPushRealDestinationsAndBackReturnsToSettings() {
        start(TodayTab)
        visit(Settings)
        listOf(
            "Account and security" to SettingsAccount,
            "Preferences" to SettingsPreferences,
            "Application profile" to SettingsProfile,
            "AI and developer" to SettingsAi,
        ).forEach { (label, route) ->
            rule.onNodeWithText(label).performClick()
            rule.runOnIdle { assertTrue("$label callback", requireNotNull(nav.currentDestination).hasRoute(route::class)) }
            rule.onNodeWithContentDescription("Back", substring = true).performClick()
            rule.runOnIdle { assertTrue(requireNotNull(nav.currentDestination).hasRoute<Settings>()) }
        }
    }

    @Test fun storyboardBackAndCloseControlsReturnThroughProductionCallbacks() {
        start(TodayTab)
        val cases = listOf(
            Triple("A2-SignIn", "A1-Welcome", "Back"),
            Triple("A3-TwoStep", "A2-SignIn", "Back"),
            Triple("A4-Allow", "A1-Welcome", "Close"),
            Triple("B1-Overview", "D1-Library", "Back"),
            Triple("B2-Section", "B1-Overview", "Back"),
            Triple("B3-Entry", "B2-Section", "Back"),
            Triple("B4-Improve", "B3-Entry", "Back"),
            Triple("B5-Basics", "B1-Overview", "Back"),
            Triple("B6-Design", "D1-Library", "Back"),
            Triple("B7-Template", "B6-Design", "Back"),
            Triple("B8-Layout", "B6-Design", "Back"),
            Triple("B9-Check", "D1-Library", "Back"),
            Triple("B10-JobMatch", "D1-Library", "Back"),
            Triple("B11-Share", "D1-Library", "Back"),
            Triple("B12-WebPage", "B11-Share", "Back"),
            Triple("B13-Visitors", "B11-Share", "Back"),
            Triple("B14-Download", "B11-Share", "Close"),
            Triple("B15-Versions", "B11-Share", "Back"),
            Triple("B16-Assistant", "B1-Overview", "Close"),
            Triple("B17-Proposals", "B16-Assistant", "Back"),
            Triple("B18-Preview", "B1-Overview", "Close"),
            Triple("B19-More", "B1-Overview", "Close"),
            Triple("C2-Coach", "C1-Career", "Back"),
            Triple("C3-Facts", "C1-Career", "Back"),
            Triple("C4-Story", "C1-Career", "Back"),
            Triple("C5-Preferences", "C1-Career", "Back"),
            Triple("C6-Offers", "C1-Career", "Back"),
            Triple("C7-Schedule", "C1-Career", "Close"),
            Triple("D4-Import", "D1-Library", "Close"),
            Triple("D5-Search", "T1-Today", "Cancel"),
            Triple("D6-Trash", "D1-Library", "Back"),
            Triple("J4-Insights", "J1-List", "Back"),
            Triple("J5-SaveJob", "J1-List", "Close"),
            Triple("J6-Detail", "J1-List", "Back"),
            Triple("J7-Stage", "J6-Detail", "Close"),
            Triple("J8-Interview", "J6-Detail", "Close"),
            Triple("L1-Letter", "D1-Library", "Back"),
            Triple("L2-LetterDesign", "D1-Library", "Back"),
            Triple("P2-ATS", "T1-Today", "Back"),
            Triple("S1-Settings", "T1-Today", "Close"),
            Triple("S6-Provider", "S5-AI", "Close"),
            Triple("W1-Fit", "J6-Detail", "Back"),
            Triple("W2-Apply", "J6-Detail", "Back"),
            Triple("W3-Prep", "J6-Detail", "Back"),
            Triple("W4-Practice", "J6-Detail", "Back"),
            Triple("W5-Messages", "J6-Detail", "Back"),
        )
        val failures = mutableListOf<String>()
        cases.forEach { (sourceId, parentId, label) ->
            try {
                val source = storyboardRoute(sourceId)
                val parent = storyboardRoute(parentId)
                val settingsOwner = parentId == "S5-AI"
                if (settingsOwner) visit(Settings)
                visit(parent.route)
                visit(source.route)
                val control = hasContentDescription(label, substring = true) or hasText(label)
                rule.onNode(control).performClick()
                rule.runOnIdle { parent.assertEntry(requireNotNull(nav.currentBackStackEntry), "$sourceId → $parentId via $label") }
                rule.runOnIdle {
                    assertTrue(nav.popBackStack())
                    if (settingsOwner) assertTrue(nav.popBackStack())
                    assertTrue(requireNotNull(nav.currentDestination).hasRoute<TodayTab>())
                }
            } catch (failure: AssertionError) {
                failures += "$sourceId → $parentId via $label: ${failure.message}"
                rule.runOnIdle { nav.resetTo(TodayTab) }
            }
        }
        assertTrue(failures.joinToString("\n"), failures.isEmpty())
    }

    @Test fun builderOverviewAndFocusedDesignRowsUseProductionPushCallbacks() {
        start(DocumentsTab)
        val resume = StoryboardIds.resume
        val cases = listOf(
            Triple(Builder(resume), "Preview the page", PagePreview(resume)),
            Triple(Builder(resume), "Basics", BuilderBasics(resume)),
            Triple(Builder(resume), "Experience", BuilderSection(resume, "experience")),
            Triple(Builder(resume, mode = BuilderMode.Design), "Preview the page", PagePreview(resume)),
            Triple(Builder(resume, mode = BuilderMode.Design), "Template", BuilderDesign(resume, DesignPicker.Template)),
            Triple(Builder(resume, mode = BuilderMode.Design), "Colour", BuilderDesign(resume, DesignPicker.Colour)),
            Triple(Builder(resume, mode = BuilderMode.Design), "Typography", BuilderDesign(resume, DesignPicker.Typography)),
            Triple(Builder(resume, mode = BuilderMode.Design), "Page", BuilderDesign(resume, DesignPicker.Page)),
            Triple(Builder(resume, mode = BuilderMode.Design), "Layout", BuilderDesign(resume, DesignPicker.Layout)),
        )
        val failures = mutableListOf<String>()
        cases.forEach { (source, label, target) ->
            try {
                visit(source)
                val control = (hasText(label) or hasContentDescription(label)) and hasClickAction()
                rule.onNode(control).performClick()
                rule.runOnIdle {
                    assertTrue("$label must push $target", requireNotNull(nav.currentDestination).hasRoute(target::class))
                    when (target) {
                        is PagePreview -> assertEquals(target, requireNotNull(nav.currentBackStackEntry).toRoute<PagePreview>())
                        is BuilderBasics -> assertEquals(target, requireNotNull(nav.currentBackStackEntry).toRoute<BuilderBasics>())
                        is BuilderSection -> assertEquals(target, requireNotNull(nav.currentBackStackEntry).toRoute<BuilderSection>())
                        is BuilderDesign -> assertEquals(target, requireNotNull(nav.currentBackStackEntry).toRoute<BuilderDesign>())
                    }
                    assertTrue(nav.popBackStack())
                    assertEquals(source, requireNotNull(nav.currentBackStackEntry).toRoute<Builder>())
                    assertTrue(nav.popBackStack())
                }
            } catch (failure: AssertionError) {
                failures += "$source via $label: ${failure.message}"
                rule.runOnIdle { nav.resetTo(DocumentsTab) }
            }
        }
        assertTrue(failures.joinToString("\n"), failures.isEmpty())
    }

    @Test fun applicationOverviewToolsPushAndKeepApplicationIdentity() {
        start(ApplicationsTab())
        val application = StoryboardIds.lumen
        val failures = mutableListOf<String>()
        listOf(
            "Fit" to WorkspaceTab.Fit,
            "Apply" to WorkspaceTab.Apply,
            "Interview prep" to WorkspaceTab.Prepare,
            "Practice" to WorkspaceTab.Practise,
            "Debrief" to WorkspaceTab.Debrief,
            "Messages" to WorkspaceTab.Messages,
            "Library" to WorkspaceTab.Saved,
            "Open briefing" to WorkspaceTab.Prepare,
        ).forEach { (label, tab) ->
            try {
                visit(me.rxresu.core.navigation.Application(application))
                val control = hasText(label) and hasClickAction()
                rule.onNode(control).performScrollTo().performClick()
                rule.runOnIdle {
                    assertTrue("$label must push workspace", requireNotNull(nav.currentDestination).hasRoute<ApplicationWorkspace>())
                    assertEquals(ApplicationWorkspace(application, tab), requireNotNull(nav.currentBackStackEntry).toRoute<ApplicationWorkspace>())
                    assertTrue(nav.popBackStack())
                    assertEquals(me.rxresu.core.navigation.Application(application), requireNotNull(nav.currentBackStackEntry).toRoute<me.rxresu.core.navigation.Application>())
                    assertTrue(nav.popBackStack())
                }
            } catch (failure: AssertionError) {
                failures += "$label: ${failure.message}"
                rule.runOnIdle { nav.resetTo(ApplicationsTab()) }
            }
        }
        assertTrue(failures.joinToString("\n"), failures.isEmpty())
    }

    @Test fun sectionEntryAndFocusedDesignPushAndReturnToTheirParent() {
        start(Builder(StoryboardIds.resume))
        visit(BuilderSection(StoryboardIds.resume, "experience"))
        visit(BuilderEntry(StoryboardIds.resume, "experience", "experience-northwind"))
        rule.runOnIdle { assertTrue(nav.popBackStack()) }
        rule.runOnIdle { assertTrue(requireNotNull(nav.currentDestination).hasRoute<BuilderSection>()) }
        rule.runOnIdle { assertTrue(nav.popBackStack()) }
        for (picker in DesignPicker.entries) {
            visit(BuilderDesign(StoryboardIds.resume, picker))
            rule.runOnIdle {
                assertEquals(picker, requireNotNull(nav.currentBackStackEntry).toRoute<BuilderDesign>().picker)
                assertTrue(nav.popBackStack())
            }
        }
        rule.runOnIdle { assertTrue(requireNotNull(nav.currentDestination).hasRoute<Builder>()) }
    }

    @Test fun workspaceToolsPreserveApplicationAndPracticeQuestionOnTheRealGraph() {
        start(me.rxresu.core.navigation.Application(StoryboardIds.lumen))
        for (tab in WorkspaceTab.entries.filter { it != WorkspaceTab.Overview }) {
            val question = if (tab == WorkspaceTab.Practise) "Tell me about the design system." else null
            visit(ApplicationWorkspace(StoryboardIds.lumen, tab, question))
            rule.runOnIdle {
                val route = requireNotNull(nav.currentBackStackEntry).toRoute<ApplicationWorkspace>()
                assertEquals(StoryboardIds.lumen, route.applicationId)
                assertEquals(question, route.practiceQuestion)
                assertTrue(nav.popBackStack())
            }
        }
        rule.runOnIdle { assertTrue(requireNotNull(nav.currentDestination).hasRoute<me.rxresu.core.navigation.Application>()) }
    }

    @Test fun legacyWorkspaceLinkReturnsToOverviewWithoutForwardingAgain() {
        start(me.rxresu.core.navigation.Application(StoryboardIds.lumen, WorkspaceTab.Prepare))
        rule.waitUntil { nav.currentDestination?.hasRoute<ApplicationWorkspace>() == true }
        rule.runOnIdle { assertTrue(nav.popBackStack()) }
        rule.runOnIdle { assertTrue(requireNotNull(nav.currentDestination).hasRoute<me.rxresu.core.navigation.Application>()) }
    }

    @Test fun assistantPreviewAndProviderUseFullScreenDestinationsWhileFormatsIsASheet() {
        start(Builder(StoryboardIds.resume))
        for (route in listOf(Assistant(StoryboardIds.resume), PagePreview(StoryboardIds.resume), AiProviderSheet())) {
            visit(route)
            rule.runOnIdle {
                assertEquals("composable", requireNotNull(nav.currentDestination).navigatorName)
                assertTrue(nav.popBackStack())
            }
        }
        visit(Download(StoryboardIds.resume, DocumentKind.Resume))
        rule.runOnIdle { assertEquals("dialog", requireNotNull(nav.currentDestination).navigatorName) }
    }
}
