package me.rxresu.core.designsystem

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** A run of a proposed edit: unchanged, removed (struck, ink-2) or added (on accent-soft). */
sealed interface RrEditRun {
    val text: String

    data class Same(override val text: String) : RrEditRun
    data class Removed(override val text: String) : RrEditRun
    data class Added(override val text: String) : RrEditRun
}

/**
 * Proposed edit from the assistant, never applied silently: number, location in mono, the text with removed words
 * struck and added words on accent-soft, then [details] (reason, Used chips, warn callouts) and the actions. Accepting or
 * rejecting plays `light` (the caller performs it with [rememberRrHaptics]).
 *
 * @param badge e.g. an [RrBadge] "New detail: check it's true" at the end of the header.
 * @param acceptPrimary the accent Accept; false when the edit needs a check first (secondary Accept).
 */
@Composable
fun RrProposalCard(
    number: Int,
    location: String,
    runs: List<RrEditRun>,
    onAccept: () -> Unit,
    onReject: () -> Unit,
    modifier: Modifier = Modifier,
    onEdit: (() -> Unit)? = null,
    acceptPrimary: Boolean = true,
    focused: Boolean = false,
    badge: (@Composable () -> Unit)? = null,
    details: @Composable ColumnScope.() -> Unit = {},
) {
    val c = RrTheme.colors
    val haptics = rememberRrHaptics()
    val numberLabel = stringResource(R.string.ds_proposal_number, number)
    RrCard(modifier = modifier, focused = focused) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            ProposalNumber(number, c.accent, c.onAccent, Modifier.semantics { contentDescription = numberLabel })
            RrText(location, style = RrType.mono, color = c.ink3, maxLines = 1, modifier = Modifier.weight(1f))
            badge?.invoke()
        }
        RrText(proposalText(runs), style = RrType.ui, color = c.ink)
        details()
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            RrButton(stringResource(R.string.ds_accept), { haptics(RrHaptic.Light); onAccept() }, size = RrButtonSize.Small, variant = if (acceptPrimary) RrButtonVariant.Primary else RrButtonVariant.Secondary)
            if (onEdit != null) RrButton(stringResource(R.string.ds_edit), onEdit, size = RrButtonSize.Small, variant = RrButtonVariant.Secondary)
            RrButton(stringResource(R.string.ds_reject), { haptics(RrHaptic.Light); onReject() }, size = RrButtonSize.Small, variant = RrButtonVariant.Ghost)
        }
    }
}

/** A decided edit, collapsed to one line with Undo ("Skills · Accepted"). */
@Composable
fun RrDecidedProposal(number: Int, summary: String, onUndo: () -> Unit, modifier: Modifier = Modifier) {
    val c = RrTheme.colors
    Row(
        modifier.fillMaxWidth().rrDesignTag(DesignTag(component = "Card", radius = RrRadius.xl, bgName = "raised")).clip(RrShape.xl).background(c.raised).border(1.dp, c.line, RrShape.xl).padding(start = 12.dp, end = 8.dp, top = 8.dp, bottom = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        ProposalNumber(number, c.sunken, c.ink2)
        RrText(summary, style = RrType.small, color = c.ink2, modifier = Modifier.weight(1f))
        RrButton(stringResource(R.string.ds_undo), onUndo, size = RrButtonSize.Small, variant = RrButtonVariant.Ghost)
    }
}

@Composable
private fun ProposalNumber(number: Int, bg: androidx.compose.ui.graphics.Color, fg: androidx.compose.ui.graphics.Color, modifier: Modifier = Modifier) {
    Box(modifier.size(20.dp).rrDesignTag(DesignTag(component = "NumberTag", radius = RrRadius.xs, bgName = RrTheme.colors.tokenName(bg))).clip(RrShape.xs).background(bg), contentAlignment = Alignment.Center) {
        RrText("$number", style = RrType.mono.copy(fontWeight = FontWeight.SemiBold, lineHeight = 20.sp), color = fg, textAlign = TextAlign.Center)
    }
}

@Composable
private fun proposalText(runs: List<RrEditRun>): AnnotatedString {
    val c = RrTheme.colors
    return buildAnnotatedString {
        runs.forEach { run ->
            when (run) {
                is RrEditRun.Same -> append(run.text)
                is RrEditRun.Removed -> withStyle(SpanStyle(color = c.ink2, textDecoration = TextDecoration.LineThrough)) { append(run.text) }
                is RrEditRun.Added -> withStyle(SpanStyle(background = c.accentSoft, color = c.ink)) { append(run.text) }
            }
        }
    }
}

@RrPreviews
@Composable
internal fun RrProposalCardPreview() = RrPreviewSurface {
    RrProposalCard(
        number = 1,
        location = "Experience › Northwind Labs",
        runs = listOf(
            RrEditRun.Same("Built the design system "),
            RrEditRun.Removed("now used by six product teams"),
            RrEditRun.Added(" used by six product teams, with accessibility audits built in"),
            RrEditRun.Same("."),
        ),
        onAccept = {},
        onReject = {},
        onEdit = {},
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) { RrUsedChip("Knowledge: design system fact", R.drawable.ic_ph_book_open) }
    }
    RrProposalCard(
        number = 2,
        location = "Summary",
        runs = listOf(RrEditRun.Same("…for business software. "), RrEditRun.Added("I lead accessibility audits and"), RrEditRun.Same(" turn research into shipped, measurable changes.")),
        onAccept = {},
        onReject = {},
        onEdit = {},
        acceptPrimary = false,
        badge = { RrBadge("New detail: check it's true", tone = RrBadgeTone.Warn) },
    )
    RrDecidedProposal(3, "Skills · Accepted", onUndo = {})
}
