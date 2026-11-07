package me.rxresu.feature.applications

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import me.rxresu.core.data.TimeSource
import me.rxresu.core.designsystem.R as D
import me.rxresu.core.designsystem.RrAddChip
import me.rxresu.core.designsystem.RrBottomSheet
import me.rxresu.core.designsystem.RrButton
import me.rxresu.core.designsystem.RrButtonSize
import me.rxresu.core.designsystem.RrButtonVariant
import me.rxresu.core.designsystem.RrContextChip
import me.rxresu.core.designsystem.RrDatePicker
import me.rxresu.core.designsystem.RrSheetDetents
import me.rxresu.core.designsystem.RrText
import me.rxresu.core.designsystem.RrTextField
import me.rxresu.core.designsystem.RrTheme
import me.rxresu.core.designsystem.RrType
import me.rxresu.core.network.generated.Application
import me.rxresu.core.network.generated.PatchApplicationRequest
import me.rxresu.core.strings.R as S

/** Sheet footer: a line, then actions at the end (or [start] content first). */
@Composable
internal fun SheetFooter(start: @Composable RowScope.() -> Unit = {}, content: @Composable RowScope.() -> Unit) {
    val c = RrTheme.colors
    Column {
        Box(Modifier.fillMaxWidth().height(1.dp).background(c.line))
        Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            start()
            Box(Modifier.weight(1f))
            content()
        }
    }
}

@Composable
internal fun SheetBody(content: @Composable ColumnScope.() -> Unit) = Column(
    Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(start = 16.dp, end = 16.dp, bottom = 16.dp),
    verticalArrangement = Arrangement.spacedBy(16.dp),
    content = content,
)

/** Edit details…: the posting facts and notes (web application-form-sheet, text fields only). */
@Composable
internal fun EditDetailsSheet(app: Application, onDismiss: () -> Unit, onSave: (PatchApplicationRequest, Set<String>) -> Unit) {
    var role by rememberSaveable { mutableStateOf(app.role) }
    var company by rememberSaveable { mutableStateOf(app.company) }
    var location by rememberSaveable { mutableStateOf(app.location.orEmpty()) }
    var salary by rememberSaveable { mutableStateOf(app.salary.orEmpty()) }
    var source by rememberSaveable { mutableStateOf(app.source.orEmpty()) }
    var link by rememberSaveable { mutableStateOf(app.sourceUrl.orEmpty()) }
    var notes by rememberSaveable { mutableStateOf(app.notes.orEmpty()) }
    val dirty = role != app.role || company != app.company || location != app.location.orEmpty() || salary != app.salary.orEmpty() ||
        source != app.source.orEmpty() || link != app.sourceUrl.orEmpty() || notes != app.notes.orEmpty()
    val valid = role.isNotBlank() && company.isNotBlank()
    RrBottomSheet(
        onDismissRequest = onDismiss,
        title = stringResource(R.string.app_edit_details_title),
        detents = RrSheetDetents.Full,
        confirmDiscard = dirty,
        footer = {
            SheetFooter {
                RrButton(stringResource(S.string.save), {
                    fun opt(v: String) = v.trim().ifEmpty { null }
                    val clear = buildSet {
                        if (opt(location) == null && app.location != null) add("/location")
                        if (opt(salary) == null && app.salary != null) add("/salary")
                        if (opt(source) == null && app.source != null) add("/source")
                        if (opt(link) == null && app.sourceUrl != null) add("/sourceUrl")
                        if (opt(notes) == null && app.notes != null) add("/notes")
                    }
                    onSave(PatchApplicationRequest(role = role.trim(), company = company.trim(), location = opt(location), salary = opt(salary), source = opt(source), sourceUrl = opt(link), notes = opt(notes)), clear)
                }, size = RrButtonSize.Large, enabled = dirty && valid)
            }
        },
    ) {
        SheetBody {
            RrTextField(role, { role = it }, label = stringResource(S.string.role), error = if (role.isBlank()) stringResource(S.string.role) else null)
            RrTextField(company, { company = it }, label = stringResource(S.string.company))
            RrTextField(location, { location = it }, label = stringResource(S.string.location))
            RrTextField(salary, { salary = it }, label = stringResource(S.string.salary))
            RrTextField(source, { source = it }, label = stringResource(S.string.source))
            RrTextField(link, { link = it }, label = stringResource(R.string.app_source_url), ltr = true, mono = true, leadingIcon = D.drawable.ic_ph_link_simple)
            RrTextField(notes, { notes = it }, label = stringResource(S.string.notes), singleLine = false, minLines = 3)
        }
    }
}

/** Tags…: the job's tags as removable chips, plus a field to add one. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun TagsSheet(current: List<String>, onDismiss: () -> Unit, onSave: (List<String>) -> Unit) {
    var tags by remember { mutableStateOf(current) }
    var draft by rememberSaveable { mutableStateOf("") }
    fun add() {
        val t = draft.trim()
        if (t.isNotEmpty() && t !in tags) tags = tags + t
        draft = ""
    }
    RrBottomSheet(
        onDismissRequest = onDismiss,
        title = stringResource(R.string.app_tags_title),
        fitContent = true,
        confirmDiscard = tags != current,
        footer = { SheetFooter { RrButton(stringResource(S.string.save), { add(); onSave(tags) }, size = RrButtonSize.Large) } },
    ) {
        SheetBody {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (tags.isEmpty()) RrText(stringResource(R.string.app_no_tags), style = RrType.small, color = RrTheme.colors.ink3)
                tags.forEach { tag -> RrContextChip(tag, icon = D.drawable.ic_ph_tag, onRemove = { tags = tags - tag }) }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                RrTextField(draft, { draft = it }, Modifier.weight(1f), placeholder = stringResource(R.string.app_tag_placeholder))
                RrAddChip(stringResource(S.string.add_a_tag), ::add)
            }
        }
    }
}

/**
 * Set a follow-up…: a date reminder with what to do, shown as the next step until done (web follow-up dialog). The
 * time of day is left to the date-only reminder (09:00 in the account's timezone).
 */
@Composable
internal fun FollowUpSheet(app: Application, time: TimeSource, onDismiss: () -> Unit, onSave: (PatchApplicationRequest, Set<String>) -> Unit) {
    val zone = time.timezone()
    val initial = app.followUpAt?.let { runCatching { Instant.parse(it) }.getOrNull() }?.atZone(zone)?.toLocalDate()
    var date by remember { mutableStateOf(initial ?: time.today().plusDays(7)) }
    var note by rememberSaveable { mutableStateOf(app.followUpNote.orEmpty()) }
    RrBottomSheet(
        onDismissRequest = onDismiss,
        title = stringResource(S.string.follow_up_2a747118b4),
        detents = RrSheetDetents.Full,
        confirmDiscard = date != initial || note != app.followUpNote.orEmpty(),
        footer = {
            SheetFooter(start = {
                if (app.followUpAt != null) RrButton(stringResource(S.string.clear), {
                    onSave(PatchApplicationRequest(), setOf("/followUpAt", "/followUpNote", "/followUpDateOnly"))
                }, variant = RrButtonVariant.Ghost, size = RrButtonSize.Large)
            }) {
                RrButton(stringResource(S.string.save), {
                    onSave(followUpRequest(date, note), if (note.isBlank() && app.followUpNote != null) setOf("/followUpNote") else emptySet())
                }, size = RrButtonSize.Large)
            }
        },
    ) {
        SheetBody {
            RrText(stringResource(S.string.a_reminder_to_check_in_shown_as_the_next_step_until_you_do), style = RrType.small, color = RrTheme.colors.ink2)
            RrDatePicker(date, { date = it }, today = time.today(), min = time.today())
            RrTextField(note, { note = it }, label = stringResource(S.string.what_to_do), placeholder = stringResource(S.string.email_the_recruiter))
        }
    }
}

/** A date-only follow-up is stored at UTC midnight with `followUpDateOnly` (packages/schema follow-up). */
internal fun followUpRequest(date: LocalDate, note: String) = PatchApplicationRequest(
    followUpAt = date.atStartOfDay(ZoneOffset.UTC).toInstant().toString(),
    followUpDateOnly = true,
    followUpNote = note.trim().ifEmpty { null },
)

/** Log an update…: a note on the timeline. */
@Composable
internal fun NoteSheet(onDismiss: () -> Unit, onSave: (String) -> Unit) {
    var text by rememberSaveable { mutableStateOf("") }
    RrBottomSheet(
        onDismissRequest = onDismiss,
        title = stringResource(S.string.log_an_update_0da350a096).removeSuffix("…"),
        fitContent = true,
        confirmDiscard = text.isNotBlank(),
        footer = { SheetFooter { RrButton(stringResource(S.string.save), { onSave(text.trim()) }, size = RrButtonSize.Large, enabled = text.isNotBlank()) } },
    ) {
        SheetBody {
            RrTextField(text, { text = it }, label = stringResource(R.string.app_note_label), placeholder = stringResource(R.string.app_note_placeholder), singleLine = false, minLines = 3)
        }
    }
}

/** The saved posting, read-only, with its link. */
@Composable
internal fun PostingSheet(app: Application, onDismiss: () -> Unit, onOpenLink: (String) -> Unit) {
    RrBottomSheet(
        onDismissRequest = onDismiss,
        title = stringResource(S.string.posting),
        footer = app.sourceUrl?.takeIf(String::isNotBlank)?.let { url ->
            { SheetFooter { RrButton(stringResource(S.string.view_posting), { onOpenLink(url) }, variant = RrButtonVariant.Secondary, size = RrButtonSize.Large, icon = D.drawable.ic_ph_arrow_square_out) } }
        },
    ) {
        SheetBody {
            if (app.requirements.isNotEmpty()) Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                app.requirements.forEach { RrText("· $it", style = RrType.ui) }
            }
            RrText(app.jobDescription?.takeIf(String::isNotBlank) ?: stringResource(R.string.app_no_posting), style = RrType.body)
        }
    }
}
