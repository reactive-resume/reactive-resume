package me.rxresu.feature.builder

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import me.rxresu.core.database.SaveStatus
import me.rxresu.core.designsystem.LocalReducedMotion
import me.rxresu.core.designsystem.RrEmptyState
import me.rxresu.core.designsystem.RrHaptic
import me.rxresu.core.designsystem.RrIcon
import me.rxresu.core.designsystem.RrIconButton
import me.rxresu.core.designsystem.RrModeBar
import me.rxresu.core.designsystem.RrMotion
import me.rxresu.core.designsystem.RrOfflineStrip
import me.rxresu.core.designsystem.RrSkeleton
import me.rxresu.core.designsystem.RrSpinner
import me.rxresu.core.designsystem.RrStrip
import me.rxresu.core.designsystem.RrText
import me.rxresu.core.designsystem.RrTheme
import me.rxresu.core.designsystem.RrTone
import me.rxresu.core.designsystem.RrTopBar
import me.rxresu.core.designsystem.rememberRrHaptics
import me.rxresu.core.designsystem.rrBuilderModes
import me.rxresu.core.navigation.BuilderMode
import me.rxresu.core.strings.R as S
import me.rxresu.core.designsystem.R as D

/**
 * The builder shell (B1, B3, B6–B11): top bar with the save status, the mode's content, and the mode bar. Mode
 * switches keep the bars still and crossfade the content. Share mode draws [share], the slot :feature:share fills.
 */
@Composable
internal fun BuilderScreen(
    state: BuilderUiState,
    mode: BuilderMode,
    onMode: (BuilderMode) -> Unit,
    onBack: () -> Unit,
    onUndo: () -> Unit,
    onRedo: () -> Unit,
    onRetrySave: () -> Unit,
    onAssistant: () -> Unit,
    onMore: () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable (BuilderMode) -> Unit,
) {
    val haptics = rememberRrHaptics()
    val reduced = LocalReducedMotion.current
    Column(modifier.fillMaxSize().background(RrTheme.colors.bg)) {
        RrTopBar(
            title = state.resume?.name.orEmpty(),
            onBack = onBack,
            status = if (state.resume == null) null else { { SaveStatusLine(state, onRetrySave) } },
        ) {
            if (mode == BuilderMode.Write || mode == BuilderMode.Design) {
                RrIconButton(D.drawable.ic_ph_arrow_counter_clockwise, stringResource(S.string.undo), onUndo, enabled = state.canUndo && !state.locked)
                RrIconButton(D.drawable.ic_ph_arrow_clockwise, stringResource(S.string.redo), onRedo, enabled = state.canRedo && !state.locked)
            }
            RrIconButton(D.drawable.ic_ph_sparkle, stringResource(S.string.assistant), onAssistant, tint = RrTheme.colors.accentText)
            RrIconButton(D.drawable.ic_ph_dots_three, stringResource(S.string.more), onMore)
        }
        if (state.locked) RrStrip(stringResource(S.string.locked_unlock_to_edit), tone = RrTone.Warn, icon = D.drawable.ic_ph_lock_simple)
        if (state.status == SaveStatus.Offline) RrOfflineStrip(text = stringResource(R.string.builder_offline_banner))
        // B1 "Changed elsewhere": someone else's change landed as one undo step.
        state.outsideChange?.takeUnless { state.locked }?.let { change ->
            val agent = change.mutation == "patch"
            RrStrip(
                stringResource(outsideChangeText(change.mutation)),
                icon = if (agent) D.drawable.ic_ph_sparkle else null,
                actionLabel = stringResource(S.string.undo),
                onAction = onUndo,
            )
        }
        Box(Modifier.weight(1f).fillMaxWidth()) {
            when {
                state.loadFailed -> RrEmptyState(stringResource(R.string.builder_load_failed), "", Modifier, stringResource(S.string.try_again), onBack)
                state.resume == null -> RrSkeleton(Modifier.fillMaxSize())
                else -> AnimatedContent(
                    targetState = mode,
                    transitionSpec = { fadeIn(tween(if (reduced) RrMotion.D1 else RrMotion.D2)) togetherWith fadeOut(tween(RrMotion.exit(RrMotion.D2))) },
                    label = "builder-mode",
                ) { content(it) }
            }
        }
        val issues = state.issueCount
        val checkDescription = if (issues > 0) pluralStringResource(R.plurals.builder_check_issues, issues, issues) else stringResource(R.string.builder_check_no_issues)
        RrModeBar(
            rrBuilderModes(stringResource(S.string.write), stringResource(S.string.design), stringResource(S.string.check), stringResource(S.string.share), checkWarn = issues > 0, checkDescription = checkDescription),
            selectedIndex = mode.ordinal,
            onSelect = { i -> if (i != mode.ordinal) { haptics(RrHaptic.Selection); onMode(BuilderMode.entries[i]) } },
        )
    }
}

/** The web's attribution for a change made elsewhere (draft.ts `externalUpdateMessage`). */
internal fun outsideChangeText(mutation: String?) = when (mutation) {
    "patch" -> R.string.builder_outside_agent
    "lock", "password" -> R.string.builder_outside_sharing
    else -> R.string.builder_outside_synced
}

/** "Saved", "Saving…", "Offline · saved on this device", "Not saved · Retry" (web save-status.tsx). */
@Composable
private fun RowScope.SaveStatusLine(state: BuilderUiState, onRetry: () -> Unit) {
    when {
        state.locked -> { RrIcon(D.drawable.ic_ph_lock_simple, null, size = 14.dp); RrText(stringResource(R.string.builder_status_locked)) }
        state.status == SaveStatus.Saving -> { RrSpinner(); RrText(stringResource(S.string.saving)) }
        state.status == SaveStatus.Offline -> { RrIcon(D.drawable.ic_ph_cloud_slash, null, size = 14.dp); RrText(stringResource(S.string.offline_saved_on_this_device)) }
        state.status == SaveStatus.CouldntSave -> {
            val label = stringResource(S.string.retry_saving)
            RrIcon(D.drawable.ic_ph_warning, null, size = 14.dp, tint = RrTheme.colors.dangerText)
            RrText(
                stringResource(R.string.builder_status_not_saved),
                color = RrTheme.colors.dangerText,
                modifier = Modifier.clickable(role = Role.Button, onClickLabel = label, onClick = onRetry).semantics { onClick(label) { onRetry(); true } },
            )
        }
        else -> { RrIcon(D.drawable.ic_ph_cloud_check, null, size = 14.dp); RrText(stringResource(S.string.saved)) }
    }
}
