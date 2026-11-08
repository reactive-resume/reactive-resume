package me.rxresu.feature.builder

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import me.rxresu.core.designsystem.LocalReducedMotion
import me.rxresu.core.designsystem.RrEmptyState
import me.rxresu.core.designsystem.RrIconButton
import me.rxresu.core.designsystem.RrTabBar
import me.rxresu.core.designsystem.RrTab
import me.rxresu.core.designsystem.RrHaptic
import me.rxresu.core.designsystem.rememberRrHaptics
import me.rxresu.core.designsystem.RrMotion
import me.rxresu.core.designsystem.RrSkeleton
import me.rxresu.core.designsystem.RrStrip
import me.rxresu.core.designsystem.RrTheme
import me.rxresu.core.designsystem.RrTopBar
import me.rxresu.core.navigation.BuilderMode
import me.rxresu.core.strings.R as S
import me.rxresu.core.designsystem.R as D

/**
 * The builder shell (B1, B6, B9–B11): bare top bar, mode content and shared dock. Mode
 * switches keep the bars still and crossfade the content. Share mode uses the slot filled by :feature:share.
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
    onDismissOutsideChange: () -> Unit = {},
    content: @Composable (BuilderMode) -> Unit,
) {
    val reduced = LocalReducedMotion.current
    val haptics = rememberRrHaptics()
    Column(modifier.fillMaxSize().background(RrTheme.colors.bg)) {
        RrTopBar(onBack = onBack, backLabel = stringResource(R.string.builder_back_to_documents)) {
            RrIconButton(D.drawable.ic_ph_sparkle, stringResource(S.string.assistant), onAssistant, tint = RrTheme.colors.accentText)
            RrIconButton(D.drawable.ic_ph_dots_three, stringResource(S.string.more), onMore)
        }
        // B1 "Changed elsewhere": someone else's change landed as one undo step.
        state.outsideChange?.takeUnless { state.locked }?.let { change ->
            val agent = change.mutation == "patch"
            RrStrip(
                stringResource(outsideChangeText(change.mutation)),
                icon = if (agent) D.drawable.ic_ph_sparkle else null,
                actionLabel = stringResource(S.string.undo),
                onAction = onUndo,
                onDismiss = onDismissOutsideChange,
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
        RrTabBar(
            tabs = listOf(
                RrTab(stringResource(R.string.builder_edit), D.drawable.ic_ph_pencil_simple, D.drawable.ic_ph_pencil_simple_fill),
                RrTab(stringResource(S.string.design), D.drawable.ic_ph_palette, D.drawable.ic_ph_palette_fill),
                RrTab(stringResource(S.string.check), D.drawable.ic_ph_seal_check, D.drawable.ic_ph_seal_check_fill, badgeDescription = checkDescription, warn = issues > 0 && mode != BuilderMode.Check),
                RrTab(stringResource(S.string.share), D.drawable.ic_ph_share_network, D.drawable.ic_ph_share_network_fill),
            ),
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
