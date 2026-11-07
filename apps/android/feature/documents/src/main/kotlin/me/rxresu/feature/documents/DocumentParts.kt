package me.rxresu.feature.documents

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import me.rxresu.core.designsystem.R as DS
import me.rxresu.core.designsystem.RrBadge
import me.rxresu.core.designsystem.RrBadgeTone
import me.rxresu.core.designsystem.RrButton
import me.rxresu.core.designsystem.RrButtonVariant
import me.rxresu.core.designsystem.RrFilterChip
import me.rxresu.core.designsystem.RrPageThumbnail
import me.rxresu.core.designsystem.RrTextField
import me.rxresu.core.designsystem.RrType
import me.rxresu.core.network.generated.DocumentSummary

internal val CardName = RrType.ui.copy(fontWeight = FontWeight.SemiBold)
internal val CardMeta = RrType.caption.copy(fontWeight = FontWeight.Normal)

/** Small first-page thumbnail for rows and sheet headers (board: 36 dp in Trash, 40 dp in the actions sheet). */
@Composable
internal fun SmallThumbnail(doc: DocumentSummary, modifier: Modifier = Modifier, width: Dp = 36.dp) {
    RrPageThumbnail(rememberThumbnail(doc, 40.dp), modifier.width(width), letter = doc.isLetter)
}

private data class BadgeSpec(val text: String, val tone: RrBadgeTone, val icon: Int?)

/** At most two badges: sharing or lock first, then the linked application, then tags in outline. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun DocumentBadges(doc: DocumentSummary, modifier: Modifier = Modifier) {
    val badges = buildList {
        if (doc.isPublic) {
            add(BadgeSpec(stringResource(if (doc.hasPassword) R.string.docs_public_password else R.string.docs_public), RrBadgeTone.Accent, DS.drawable.ic_ph_globe_simple))
        }
        if (doc.isLocked) add(BadgeSpec(stringResource(R.string.docs_locked), RrBadgeTone.Neutral, DS.drawable.ic_ph_lock_simple))
        doc.application?.let { add(BadgeSpec(it.company, RrBadgeTone.Neutral, DS.drawable.ic_ph_briefcase)) }
        doc.tags.forEach { add(BadgeSpec(it, RrBadgeTone.Outline, null)) }
    }.take(2)
    if (badges.isEmpty()) return
    FlowRow(modifier, horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        badges.forEach { RrBadge(it.text, tone = it.tone, icon = it.icon) }
    }
}

/**
 * Tags for one or more documents: chips toggle a tag on all of them, the field adds a new one.
 * [initial] is the tags every document already has.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun TagsEditor(
    known: List<String>,
    initial: Set<String>,
    onSave: (add: Set<String>, remove: Set<String>) -> Unit,
    modifier: Modifier = Modifier,
    saving: Boolean = false,
) {
    var chosen by rememberSaveable { mutableStateOf(initial.toList()) }
    var extra by rememberSaveable { mutableStateOf(listOf<String>()) }
    var draft by rememberSaveable { mutableStateOf("") }
    fun addDraft() {
        val tag = draft.trim()
        if (tag.isNotEmpty()) {
            if (tag !in known && tag !in extra) extra = extra + tag
            if (tag !in chosen) chosen = chosen + tag
        }
        draft = ""
    }
    Column(modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            (known + extra).distinct().forEach { tag ->
                RrFilterChip(tag, tag in chosen, { on -> chosen = if (on) chosen + tag else chosen - tag }, icon = DS.drawable.ic_ph_tag)
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            RrTextField(
                draft,
                { draft = it },
                Modifier.weight(1f),
                placeholder = stringResource(R.string.docs_add_tag),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { addDraft() }),
            )
            RrButton(stringResource(me.rxresu.core.strings.R.string.add_a_tag), ::addDraft, variant = RrButtonVariant.Secondary, enabled = draft.isNotBlank())
        }
        RrButton(
            stringResource(R.string.docs_save_tags),
            { onSave(chosen.toSet() - initial, initial - chosen.toSet()) },
            Modifier.padding(bottom = 16.dp),
            loading = saving,
        )
    }
}
