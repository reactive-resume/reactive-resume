package me.rxresu.feature.search

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import me.rxresu.core.data.SearchScope
import me.rxresu.core.designsystem.R as DS
import me.rxresu.core.designsystem.RrEmptyState
import me.rxresu.core.designsystem.RrListGroup
import me.rxresu.core.designsystem.RrListRow
import me.rxresu.core.designsystem.rrStatusBarsPadding
import me.rxresu.core.designsystem.rrNavigationBarsPadding
import me.rxresu.core.designsystem.RrTextField
import me.rxresu.core.designsystem.RrCompanyTile
import me.rxresu.core.designsystem.RrDocumentThumbnail
import me.rxresu.core.designsystem.RrIconTile
import me.rxresu.core.designsystem.RrRowCaret
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import me.rxresu.core.designsystem.RrSectionHeader
import me.rxresu.core.designsystem.RrSkeleton
import me.rxresu.core.designsystem.RrStage
import me.rxresu.core.designsystem.RrStrip
import me.rxresu.core.designsystem.RrText
import me.rxresu.core.designsystem.RrTheme
import me.rxresu.core.designsystem.RrType
import me.rxresu.core.network.generated.ApplicationStage
import me.rxresu.core.network.generated.Interview
import me.rxresu.core.strings.R as S

class SearchCallbacks(
    val onQuery: (String) -> Unit = {},
    val onScope: (SearchScope) -> Unit = {},
    val onOpen: (SearchRow) -> Unit = {},
    /** The Search key: opens the first result. */
    val onSubmit: () -> Unit = {},
    val onShowAll: (SearchGroupKey) -> Unit = {},
    val onCancel: () -> Unit = {},
)

/** Scope chips: All, Documents, Applications, Chats (assistant and coach conversations live in Career). */
private val Scopes = listOf(SearchScope.All, SearchScope.Documents, SearchScope.Applications, SearchScope.Career)

/** D5 Search everything. Field focused on open; results grouped, three per group with Show all; matches in bold. */
@Composable
fun SearchScreen(state: SearchUiState, now: Instant, zone: ZoneId, callbacks: SearchCallbacks, modifier: Modifier = Modifier, autoFocus: Boolean = true) {
    val c = RrTheme.colors
    val focus = remember { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current
    if (autoFocus) LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
    Column(modifier.fillMaxSize().background(c.bg).rrStatusBarsPadding().rrNavigationBarsPadding().imePadding()) {
        Row(
            Modifier.fillMaxWidth().height(56.dp).padding(start = 24.dp, end = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            RrTextField(state.query, callbacks.onQuery, Modifier.weight(1f).focusRequester(focus), placeholder = stringResource(R.string.search_placeholder), leadingIcon = DS.drawable.ic_ph_magnifying_glass, keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search), keyboardActions = KeyboardActions(onSearch = { keyboard?.hide(); callbacks.onSubmit() }))
            Box(Modifier.height(44.dp).clickable(onClick = callbacks.onCancel), contentAlignment = Alignment.Center) {
                RrText(stringResource(S.string.cancel), style = RrType.textLink, color = c.accentText)
            }
        }
        if (state.offline) RrStrip(stringResource(R.string.search_offline), Modifier.padding(top = 8.dp), icon = DS.drawable.ic_ph_cloud_slash)
        LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(bottom = 24.dp)) {
            when {
                state.failed -> item { RrEmptyState(stringResource(R.string.search_failed), "", Modifier.padding(16.dp)) }
                state.empty -> item {
                    RrText(
                        stringResource(R.string.search_no_matches, state.query.trim()),
                        Modifier.padding(16.dp),
                        style = RrType.ui,
                        color = c.ink2,
                    )
                }
                state.loading && state.groups.isEmpty() -> item {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        repeat(3) { RrSkeleton(Modifier.fillMaxWidth().padding(vertical = 4.dp).width(200.dp)) }
                    }
                }
            }
            state.groups.forEachIndexed { groupIndex, group ->
                if (state.empty && group.key == SearchGroupKey.Actions) return@forEachIndexed
                val open = group.key in state.expanded || group.key == SearchGroupKey.Recent && state.query.isEmpty()
                val shown = if (open) group.rows else group.rows.take(3)
                item {
                    RrSectionHeader(
                        groupLabel(group.key),
                        topPadding = if (groupIndex == 0) 20.dp else 32.dp,
                        actionLabel = if (shown.size < group.rows.size) stringResource(R.string.search_show_all_count, group.rows.size) else null,
                        onAction = { callbacks.onShowAll(group.key) },
                    )
                }
                item {
                    RrListGroup {
                        shown.forEachIndexed { index, row -> ResultRow(row, state.query.trim(), now, zone, callbacks, index < shown.lastIndex) }
                    }
                }
            }
        }
    }
}

@Composable
private fun groupLabel(key: SearchGroupKey) = when (key) {
    SearchGroupKey.Recent -> stringResource(R.string.search_recent)
    SearchGroupKey.Documents -> stringResource(S.string.documents)
    SearchGroupKey.Applications -> stringResource(S.string.applications)
    SearchGroupKey.Chats -> stringResource(R.string.search_notes_messages)
    SearchGroupKey.Career -> stringResource(R.string.search_career)
    SearchGroupKey.GoTo -> stringResource(S.string.go_to)
    SearchGroupKey.Actions -> stringResource(S.string.actions)
}

/** [text] with every case-insensitive occurrence of [query] in semibold. */
internal fun highlight(text: String, query: String): AnnotatedString = buildAnnotatedString {
    append(text)
    if (query.isBlank()) return@buildAnnotatedString
    var from = 0
    while (true) {
        val at = text.indexOf(query, from, ignoreCase = true)
        if (at < 0) break
        addStyle(SpanStyle(fontWeight = FontWeight.SemiBold), at, at + query.length)
        from = at + query.length
    }
}

@Composable
private fun ResultRow(row: SearchRow, query: String, now: Instant, zone: ZoneId, callbacks: SearchCallbacks, divider: Boolean) {
    val hit = row.hit
    val locale = LocalConfiguration.current.locales[0]
    val title: AnnotatedString = when (hit.kind) {
        PREPARE -> buildAnnotatedString {
            val full = stringResource(S.string.prepare_for_company, hit.title)
            append(highlight(full, query))
        }
        ASK -> AnnotatedString(stringResource(R.string.search_ask_coach, hit.title))
        "destination", "command" -> highlight(shortcutLabel(hit.id, hit.title), query)
        "application" -> AnnotatedString(hit.title)
        else -> AnnotatedString(hit.title)
    }
    val subtitle: String? = when (hit.kind) {
        "resume", "letter" -> row.document?.let {
            val ago = relativeTime(it.editedAt, now, zone)
            stringResource(if (hit.kind == "letter") R.string.search_letter_meta else R.string.search_resume_meta, ago)
        } ?: hit.subtitle.ifBlank { null }
        "application" -> row.application?.let { app -> "${app.role} · ${stageLabel(app.status)}" } ?: hit.subtitle.ifBlank { null }
        "thread" -> stringResource(R.string.search_conversation)
        else -> hit.subtitle.ifBlank { null }
    }
    RrListRow(title, subtitle = subtitle, onClick = { callbacks.onOpen(row) }, leading = { Leading(row) }, divider = divider, trailing = { RrRowCaret() })
}

@Composable
private fun Leading(row: SearchRow) {
    val c = RrTheme.colors
    val hit = row.hit
    if (hit.kind == "application") {
        RrCompanyTile(hit.title, content = hit.title.take(2).uppercase())
        return
    }
    if (hit.kind in listOf("resume", "letter")) { RrDocumentThumbnail(letter = hit.kind == "letter"); return }
    val icon = when (hit.kind) {
        "resume" -> DS.drawable.ic_ph_file_text
        "letter" -> DS.drawable.ic_ph_note_pencil
        "thread", "message", "note" -> DS.drawable.ic_ph_envelope_simple
        "fact" -> DS.drawable.ic_ph_lightbulb
        "story" -> DS.drawable.ic_ph_book_open
        RECENT -> DS.drawable.ic_ph_clock_counter_clockwise
        PREPARE -> DS.drawable.ic_ph_sparkle
        ASK -> DS.drawable.ic_ph_chat_circle
        else -> when (hit.id) {
            "settings" -> DS.drawable.ic_ph_user_circle
            "knowledge" -> DS.drawable.ic_ph_book_bookmark
            "offers" -> DS.drawable.ic_ph_scales
            "ats-checker" -> DS.drawable.ic_ph_seal_check
            "trash" -> DS.drawable.ic_ph_trash
            "new-letter" -> DS.drawable.ic_ph_note_pencil
            "save-job" -> DS.drawable.ic_ph_briefcase
            "theme" -> DS.drawable.ic_ph_circle_half
            "language" -> DS.drawable.ic_ph_translate
            else -> DS.drawable.ic_ph_arrow_square_out
        }
    }
    RrIconTile(icon, accent = hit.kind == PREPARE)
}

private fun ApplicationStage?.rr(): RrStage = when (this) {
    ApplicationStage.Applied -> RrStage.Applied
    ApplicationStage.Screening -> RrStage.Screening
    ApplicationStage.Interview -> RrStage.Interview
    ApplicationStage.Offer -> RrStage.Offer
    ApplicationStage.Closed -> RrStage.Closed
    else -> RrStage.Saved
}

@Composable
private fun stageLabel(stage: ApplicationStage) = when (stage) {
    ApplicationStage.Applied -> stringResource(R.string.search_applied)
    ApplicationStage.Screening -> stringResource(S.string.screening)
    ApplicationStage.Interview -> stringResource(R.string.search_interviewing)
    ApplicationStage.Offer -> stringResource(R.string.search_offer)
    ApplicationStage.Closed -> stringResource(S.string.closed)
    else -> stringResource(R.string.search_saved)
}

/** Go to… and command titles come from the repository in English; show the catalog's words instead. */
@Composable
private fun shortcutLabel(id: String, fallback: String) = when (id) {
    "settings" -> stringResource(S.string.settings)
    "knowledge" -> stringResource(S.string.knowledge)
    "offers" -> stringResource(S.string.offers)
    "ats-checker" -> stringResource(S.string.ats_checker)
    "trash" -> stringResource(me.rxresu.core.strings.R.string.trash)
    "new-letter" -> stringResource(S.string.new_cover_letter)
    "save-job" -> stringResource(S.string.save_job)
    "theme" -> stringResource(S.string.change_theme_to)
    "language" -> stringResource(S.string.change_language_to)
    else -> fallback
}

/** "12 min ago" today, "Yesterday", "2 days ago", then a date (web formatRelativeTime, short). */
internal fun relativeTime(value: String, now: Instant, zone: ZoneId): String {
    val at = runCatching { Instant.parse(value) }.getOrNull() ?: return value
    val days = java.time.temporal.ChronoUnit.DAYS.between(at.atZone(zone).toLocalDate(), now.atZone(zone).toLocalDate())
    return when {
        days == 0L -> "${java.time.Duration.between(at, now).toHours()} h ago"
        days == 1L -> "yesterday"
        else -> DateTimeFormatter.ofPattern("d MMM", java.util.Locale.getDefault()).format(at.atZone(zone))
    }
}
