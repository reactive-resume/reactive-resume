package me.rxresu.core.designsystem

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.Modifier
import me.rxresu.core.testing.RrScreenshotTest
import me.rxresu.core.testing.captureComponent
import me.rxresu.core.testing.captureScreen
import org.junit.Test

/** Light and dark captures of every component preview, plus a check that the harness reports storyboard insets. */
class ComponentScreenshotTest : RrScreenshotTest() {
    private val previews: List<Pair<String, @Composable () -> Unit>> = listOf(
        "RrAiComposer" to { RrAiComposerPreview() },
        "RrAlertDialog" to { RrAlertDialogPreview() },
        "RrAvatar" to { RrAvatarPreview() },
        "RrBadge" to { RrBadgePreview() },
        "RrBarChart" to { RrBarChartPreview() },
        "RrBottomSheet" to { RrBottomSheetPreview() },
        "RrBottomSheetDocked" to { RrBottomSheetDockedPreview() },
        "RrButton" to { RrButtonPreview() },
        "RrCallout" to { RrCalloutPreview() },
        "RrCard" to { RrCardPreview() },
        "RrChip" to { RrChipPreview() },
        "RrChoiceCard" to { RrChoiceCardPreview() },
        "RrCompanyTile" to { RrCompanyTilePreview() },
        "RrControls" to { RrControlsPreview() },
        "RrDatePicker" to { RrDatePickerPreview() },
        "RrDisclosureLine" to { RrDisclosureLinePreview() },
        "RrEmptyState" to { RrEmptyStatePreview() },
        "RrEvidencePill" to { RrEvidencePillPreview() },
        "RrHoldToDeleteButton" to { RrHoldToDeleteButtonPreview() },
        "RrIconButton" to { RrIconButtonPreview() },
        "RrLargeTitleHeader" to { RrLargeTitleHeaderPreview() },
        "RrList" to { RrListPreview() },
        "RrMenu" to { RrMenuPreview() },
        "RrMonthPicker" to { RrMonthPickerPreview() },
        "RrModeBar" to { RrModeBarPreview() },
        "RrOptionRow" to { RrOptionRowPreview() },
        "RrPaperPage" to { RrPaperPagePreview() },
        "RrProposalCard" to { RrProposalCardPreview() },
        "RrQuestionCard" to { RrQuestionCardPreview() },
        "RrQuickActionTile" to { RrQuickActionTilePreview() },
        "RrRecorder" to { RrRecorderPreview() },
        "RrPullToRefresh" to { RrPullToRefreshPreview() },
        "RrScoreRing" to { RrScoreRingPreview() },
        "RrSegmentedControl" to { RrSegmentedControlPreview() },
        "RrSkeleton" to { RrSkeletonPreview() },
        "RrSlider" to { RrSliderPreview() },
        "RrSpinner" to { RrSpinnerPreview() },
        "RrStage" to { RrStagePreview() },
        "RrStepper" to { RrStepperPreview() },
        "RrStepList" to { RrStepListPreview() },
        "RrStepMarker" to { RrStepMarkerPreview() },
        "RrSwipeRow" to { RrSwipeRowPreview() },
        "RrTabBar" to { RrTabBarPreview() },
        "RrTextField" to { RrTextFieldPreview() },
        "RrTimePicker" to { RrTimePickerPreview() },
        "RrToast" to { RrToastPreview() },
        "RrTopBar" to { RrTopBarPreview() },
        "RrTraceSteps" to { RrTraceStepsPreview() },
        "RrUnderlineTabs" to { RrUnderlineTabsPreview() },
        "RrUsedChip" to { RrUsedChipPreview() },
        "RrWeekStrip" to { RrWeekStripPreview() },
        "RrWorkingLabel" to { RrWorkingLabelPreview() },
    )

    @Test fun light() = previews.forEach { (name, preview) -> captureComponent(name, dark = false) { preview() } }

    @Test fun dark() = previews.forEach { (name, preview) -> captureComponent(name, dark = true) { preview() } }

    /** Rows, buttons and fields at 200% font scale: text wraps instead of clipping. */
    @Test fun fontScale200() = captureScreen("Harness-Mixed", dark = false, fontScale = 2f) { Mixed() }

    /** Root-tab headers at 200%: a title that no longer fits beside the actions moves below them, unbroken. */
    @Test fun largeTitleFontScale200() = captureScreen("Harness-LargeTitle", dark = false, fontScale = 2f) {
        Column(Modifier.windowInsetsPadding(WindowInsets.systemBars)) {
            RrLargeTitleHeader("Applications", rememberRrLargeTitleState(), applyStatusBarInset = false) {
                RrIconButton(R.drawable.ic_ph_magnifying_glass, "Search", {})
                RrButton("Save job", {}, size = RrButtonSize.Small, icon = R.drawable.ic_ph_plus)
                RrAvatar("AM", onClick = {}, contentDescription = "Settings")
            }
            RrLargeTitleHeader("Today", rememberRrLargeTitleState(), subtitle = "Saturday, 7 November", applyStatusBarInset = false) {
                RrAvatar("AM", onClick = {}, contentDescription = "Settings")
            }
        }
    }

    /** Sheet headers at 200%: the title wraps between words, or the actions move under it ("Northwind Labs", B2). */
    @Test fun sheetHeaderFontScale200() = captureScreen("Harness-SheetHeader", dark = false, fontScale = 2f) {
        Column(Modifier.windowInsetsPadding(WindowInsets.systemBars).background(RrTheme.colors.raised)) {
            RrSheetHeader("Northwind Labs") {
                RrIconButton(R.drawable.ic_ph_caret_up, "Previous entry", {})
                RrIconButton(R.drawable.ic_ph_caret_down, "Next entry", {})
                RrIconButton(R.drawable.ic_ph_dots_three, "Entry options", {})
                RrButton("Done", {}, variant = RrButtonVariant.Secondary)
            }
            RrSheetHeader("Edit interview") { RrIconButton(R.drawable.ic_ph_x, "Close", {}, size = RrIconButtonSize.Small) }
            RrTopBar("Import a resume", onClose = {}, applyStatusBarInset = false)
            RrAvatar("", onClick = {}, contentDescription = "Settings")
        }
    }

    /** Right-to-left: carets, the segment indicator, swipe side and fuse mirror; the email stays left-to-right. */
    @Test fun rtl() = captureScreen("Harness-Mixed-rtl", dark = true, wrap = { content ->
        CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) { content() }
    }) { Mixed() }

    @Composable
    private fun Mixed() = Column(Modifier.windowInsetsPadding(WindowInsets.systemBars)) {
        RrTopBar("Product designer", onBack = {}, applyStatusBarInset = false, status = { RrText("Saved") }) {
            RrIconButton(R.drawable.ic_ph_dots_three, "More", {})
        }
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            RrSegmentedControl(listOf(RrSegment("Issues", count = "2"), RrSegment("Job match"), RrSegment("Writing")), 1, {})
            RrListGroup {
                RrListRow("Account", subtitle = "alex@morgan.design", icon = R.drawable.ic_ph_user, onClick = {}, trailing = { RrRowCaret() })
                RrListRow("Theme", icon = R.drawable.ic_ph_moon, onClick = {}, trailing = { RrRowValue("Match system") })
            }
            RrButton("Save interview", {}, size = RrButtonSize.Large)
            RrTextField("alex@morgan.design", {}, label = "Email", ltr = true)
            RrToast("“Lumen letter” moved to Trash", actionLabel = "Undo", fuse = 0.6f)
        }
    }

    /** Accent-soft between the 47 dp status bar and 34 dp gesture bar, `bg` above and below. */
    @Test fun insets() = captureScreen("Harness-Insets", dark = false) {
        Box(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.systemBars).background(RrTheme.colors.accentSoft))
    }
}
