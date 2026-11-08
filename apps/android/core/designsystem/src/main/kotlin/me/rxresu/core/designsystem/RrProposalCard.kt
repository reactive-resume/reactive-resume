package me.rxresu.core.designsystem

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.foundation.text.InlineTextContent
import androidx.compose.foundation.text.appendInlineContent
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.Placeholder
import androidx.compose.ui.text.PlaceholderVerticalAlign
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
    showActions: Boolean = true,
    details: @Composable ColumnScope.() -> Unit = {},
) {
    val c = RrTheme.colors
    val haptics = rememberRrHaptics()
    val numberLabel = stringResource(R.string.ds_proposal_number, number)
    RrCard(modifier = modifier, focused = focused, contentPadding = PaddingValues(21.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
            ProposalNumber(number, c.accent, c.onAccent, Modifier.semantics { contentDescription = numberLabel })
            RrText(location, style = RrType.mono.copy(fontWeight = FontWeight.Medium), color = c.ink3, maxLines = 1, modifier = Modifier.weight(1f))
            badge?.invoke()
        }
        var layout by remember { mutableStateOf<TextLayoutResult?>(null) }
        val text = proposalText(proposalPhraseRuns(runs))
        val additions = text.spanStyles.filter { it.item.textDecoration != TextDecoration.LineThrough }.map { it.start until it.end }
        RrText(text, Modifier.rrAddedTextBackground(layout, additions, c.accentSoft), style = RrType.body, color = c.ink,
            inlineContent = mapOf("padding" to InlineTextContent(Placeholder(2.sp, 18.sp, PlaceholderVerticalAlign.TextCenter)) { Box(Modifier.fillMaxSize()) }),
            measureUnstyledText = true, onTextLayout = { layout = it })
        details()
        if (showActions) Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            RrButton(stringResource(R.string.ds_accept), { haptics(RrHaptic.Light); onAccept() }, variant = if (acceptPrimary) RrButtonVariant.Primary else RrButtonVariant.Secondary)
            if (onEdit != null) RrButton(stringResource(R.string.ds_edit), onEdit, variant = RrButtonVariant.Ghost)
            RrButton(stringResource(R.string.ds_reject), { haptics(RrHaptic.Light); onReject() }, variant = RrButtonVariant.Ghost)
        }
    }
}

/** Keep a shared connector with both replacement phrases without changing either reconstructed passage. */
internal fun proposalPhraseRuns(runs: List<RrEditRun>): List<RrEditRun> {
    val result = runs.toMutableList()
    for (index in 0 until result.size - 2) {
        val removed = result[index] as? RrEditRun.Removed ?: continue
        val added = result[index + 1] as? RrEditRun.Added ?: continue
        val same = result[index + 2] as? RrEditRun.Same ?: continue
        if (removed.text.isEmpty() || added.text.isEmpty()) continue
        val word = same.text.takeWhile { !it.isWhitespace() }
        if (word !in setOf("by", "with", "for", "from", "to", "in", "on", "at", "of", "as")) continue
        val length = word.length + same.text.drop(word.length).takeWhile { it.isWhitespace() }.length
        if (length == word.length) continue
        val connector = same.text.take(length)
        result[index] = RrEditRun.Removed(removed.text + connector)
        result[index + 1] = RrEditRun.Added(added.text + connector)
        result[index + 2] = RrEditRun.Same(same.text.drop(length))
    }
    return result
}

/** A decided edit, collapsed to one line with Undo ("Skills · Accepted"). */
@Composable
fun RrDecidedProposal(number: Int, summary: String, onUndo: () -> Unit, modifier: Modifier = Modifier) {
    val c = RrTheme.colors
    Row(
        modifier.fillMaxWidth().heightIn(min = RrLayout.listRowMin).padding(vertical = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        ProposalNumber(number, c.sunken, c.ink2)
        RrText(summary, style = RrType.rowTitle, color = c.ink, modifier = Modifier.weight(1f))
        Box(Modifier.clickable(role = androidx.compose.ui.semantics.Role.Button, onClick = onUndo).padding(vertical = 8.dp)) {
            RrText(stringResource(R.string.ds_undo), style = RrType.buttonMd, color = c.accentText)
        }
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
                is RrEditRun.Removed, is RrEditRun.Added -> {
                    val leading = run.text.takeWhile { it.isWhitespace() }
                    val words = run.text.trim()
                    append(leading)
                    if (words.isNotEmpty()) {
                        if (run is RrEditRun.Added) { appendInlineContent("padding", "\u2060"); append('\u2060') }
                        withStyle(if (run is RrEditRun.Removed) SpanStyle(color = c.ink2, textDecoration = TextDecoration.LineThrough) else SpanStyle(color = c.ink)) { append(words) }
                        if (run is RrEditRun.Added) { append('\u2060'); appendInlineContent("padding", "\u2060") }
                        append(run.text.takeLastWhile { it.isWhitespace() })
                    }
                }
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
