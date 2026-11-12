package me.rxresu.feature.builder

import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import me.rxresu.core.designsystem.*
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import me.rxresu.core.designsystem.LocalReducedMotion
import me.rxresu.core.designsystem.RrBottomSheet
import me.rxresu.core.designsystem.RrButton
import me.rxresu.core.designsystem.RrButtonSize
import me.rxresu.core.designsystem.RrButtonVariant
import me.rxresu.core.designsystem.RrCard
import me.rxresu.core.designsystem.RrHaptic
import me.rxresu.core.designsystem.RrListRow
import me.rxresu.core.designsystem.RrMenuItem
import me.rxresu.core.designsystem.RrMotion
import me.rxresu.core.designsystem.RrRowCaret
import me.rxresu.core.designsystem.RrSegment
import me.rxresu.core.designsystem.RrSegmentedControl
import me.rxresu.core.designsystem.RrShape
import me.rxresu.core.designsystem.RrSpinner
import me.rxresu.core.designsystem.RrText
import me.rxresu.core.designsystem.RrTextField
import me.rxresu.core.designsystem.RrTheme
import me.rxresu.core.designsystem.RrType
import me.rxresu.core.designsystem.rememberRrHaptics
import me.rxresu.core.navigation.CheckTab
import me.rxresu.core.network.generated.Application
import me.rxresu.core.strings.R as S
import me.rxresu.core.designsystem.R as D

/** The web's verdict thresholds (packages/resume/src/ats/merge.ts). */
internal fun verdict(score: Int, fragmented: Boolean) = when {
    score >= 80 && !fragmented -> S.string.reads_cleanly
    score >= 50 -> S.string.mostly_readable
    else -> S.string.hard_for_software_to_read
}

/** B9, B10 and Writing: the readability score, issues with one-tap fixes, and the job match. */
@Composable
internal fun CheckMode(
    state: BuilderUiState,
    tab: CheckTab,
    onTab: (CheckTab) -> Unit,
    actions: BuilderActions,
    onShowOnPage: (BlockTarget) -> Unit,
    onWrite: (BlockTarget) -> Unit,
    onAskAssistant: (String) -> Unit,
    onSetUpAi: () -> Unit,
    modifier: Modifier = Modifier,
    writingTab: Boolean = false,
    jobMatchChanging: Boolean = false,
    saveJobOpen: Boolean = false,
    onOpenApplication: (String) -> Unit = {},
) {
    val doc = state.doc ?: return
    val haptics = rememberRrHaptics()
    var writing by rememberSaveable { mutableStateOf(writingTab) }
    val checks = state.checks
    val issues = checks?.let { issueViews(doc, it.findings) }.orEmpty()
    Column(modifier.fillMaxSize().background(RrTheme.colors.bg).verticalScroll(rememberScrollState()).padding(bottom = 24.dp)) {
        RrPageTitle(stringResource(S.string.check))
        RrSegmentedControl(
            listOf(
                RrSegment(stringResource(S.string.issues)),
                RrSegment(stringResource(S.string.job_match)),
                RrSegment(stringResource(S.string.writing)),
            ),
            selectedIndex = if (writing) 2 else tab.ordinal,
            onSelect = { i -> writing = i == 2; if (i < 2) onTab(CheckTab.entries[i]) },
            modifier = Modifier.fillMaxWidth().padding(start = 24.dp, end = 24.dp, top = if (tab == CheckTab.JobMatch) 20.dp else 16.dp),
        )
        when {
            writing -> WritingTab(state, actions, onSetUpAi)
            tab == CheckTab.Issues -> {
                if (checks != null) ScoreHeader(checks.score.toInt(), issues.any { it.key.startsWith("FRAGMENTED_ENTRY") }, issues.size)
                IssuesTab(state, doc, issues, actions, onShowOnPage, onWrite)
            }
            else -> JobMatchTab(state, doc, actions, onShowOnPage, onAskAssistant, jobMatchChanging, saveJobOpen, onOpenApplication)
        }
    }
    LaunchedEffect(tab, state.application) { if (tab == CheckTab.JobMatch && state.match == MatchState.Idle) actions.matchPosting(null) }
}

@Composable
private fun ScoreHeader(score: Int, fragmented: Boolean, issueCount: Int) {
    val c = RrTheme.colors
    val reduced = LocalReducedMotion.current
    var explain by rememberSaveable { mutableStateOf(false) }
    val shown by animateFloatAsState(score.toFloat(), if (reduced) tween(0) else tween(RrMotion.D3, easing = RrMotion.ease), label = "score")
    Row(Modifier.padding(start = 24.dp, end = 24.dp, top = 24.dp).clickable { explain = !explain }, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        RrText("${shown.toInt()}", style = RrType.bigNumber)
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            RrText(stringResource(if (issueCount > 0 && score >= 80) S.string.mostly_readable else verdict(score, fragmented)), style = RrType.label)
            RrText(if (issueCount == 2) stringResource(R.string.builder_two_fixes) else if (issueCount == 0) stringResource(R.string.builder_nothing_to_review) else pluralStringResource(R.plurals.builder_fixes_count, issueCount, issueCount), style = RrType.ui, color = c.ink3)
        }
    }
    if (explain) RrText(stringResource(S.string.the_score_counts_how_reliably_software_reads_your_resume_it_doesn_t_predict_whether_you_ll_be_shortl), color = c.ink2, modifier = Modifier.padding(24.dp))
}

@Composable
private fun IssuesTab(state: BuilderUiState, doc: ResumeDoc, issues: List<IssueView>, actions: BuilderActions, onShowOnPage: (BlockTarget) -> Unit, onWrite: (BlockTarget) -> Unit) {
    val c = RrTheme.colors
    val haptics = rememberRrHaptics()
    val reduced = LocalReducedMotion.current
    val checks = state.checks ?: return
    var menu by remember { mutableStateOf<IssueView?>(null) }
    var open by rememberSaveable { mutableStateOf(false) }
    var previousCount by remember { androidx.compose.runtime.mutableIntStateOf(issues.size) }
    LaunchedEffect(issues.size) { if (issues.isEmpty() && previousCount > 0) haptics(RrHaptic.Success); previousCount = issues.size }
    issues.forEachIndexed { index, issue ->
        RrCard(Modifier.padding(start = 24.dp, end = 24.dp, top = if (index == 0) 20.dp else 12.dp).combinedClickable(onClick = {}, onLongClick = { menu = issue }).sizeMotion(reduced), contentPadding = PaddingValues(21.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                RrIssueMarker(issue.number)
                RrText(issue.title, style = RrType.rowTitle.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold))
            }
            if (issue.body.isNotEmpty()) RrText(issue.body, style = RrType.body, color = c.ink2)
            issue.fixLabel?.let { label ->
                RrButton(label, { haptics(RrHaptic.Light); issue.fix?.let(actions::applyFix) ?: issue.write?.let(onWrite) }, variant = RrButtonVariant.Secondary, enabled = !state.locked)
            }
        }
    }
    RrListRow(pluralStringResource(R.plurals.builder_passed_checks, checks.passedRules.toInt(), checks.passedRules.toInt()), modifier = Modifier.padding(top = 12.dp), icon = D.drawable.ic_ph_check_circle, onClick = { open = !open }, trailing = { RrRowCaret() })
    if (open) {
        val failing = issues.map { it.category }.toSet()
        CheckCategory.entries.filterNot { it in failing }.forEach { RrListRow(stringResource(it.title), subtitle = stringResource(it.description)) }
    }
    if (checks.ignored.isNotEmpty()) RrButton(stringResource(R.string.builder_show_ignored), actions::showIgnored, Modifier.padding(horizontal = 24.dp), variant = RrButtonVariant.GhostAccent)
    if (open) RrListRow(stringResource(S.string.also_check_the_exported_pdf), icon = D.drawable.ic_ph_file_pdf, onClick = actions::checkExportedPdf, trailing = { RrRowCaret() })
    menu?.let { issue -> RrBottomSheet(onDismissRequest = { menu = null }, title = issue.title, fitContent = true) {
        issue.target?.let { target -> RrMenuItem(stringResource(S.string.show_on_page), { onShowOnPage(target); menu = null }) }
        RrMenuItem(stringResource(S.string.ignore), { if (!state.locked) actions.ignoreIssue(issue.key); menu = null }, enabled = !state.locked)
    } }
}

/** B10: posting terms already in the resume and the ones it lacks. Never a percentage. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun JobMatchTab(
    state: BuilderUiState, doc: ResumeDoc, actions: BuilderActions, onShowOnPage: (BlockTarget) -> Unit, onAskAssistant: (String) -> Unit,
    initiallyChanging: Boolean = false, saveJobOpen: Boolean = false, onOpenApplication: (String) -> Unit,
) {
    val c = RrTheme.colors
    val resources = LocalResources.current
    val haptics = rememberRrHaptics()
    val reduced = LocalReducedMotion.current
    val app = state.application
    var pasted by rememberSaveable { mutableStateOf("") }
    var changing by rememberSaveable { mutableStateOf(initiallyChanging) }
    when (val m = state.match) {
        MatchState.Idle, MatchState.Reading -> Row(Modifier.padding(16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) { RrSpinner(); RrText(stringResource(R.string.builder_reading_posting), color = c.ink2) }
        MatchState.NoPosting, is MatchState.Failed -> Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (app != null && m is MatchState.NoPosting) {
                // A linked application without a saved posting takes one here, saved to the application.
                RrCard(Modifier.fillMaxWidth()) {
                    RrText("${app.role} · ${app.company}", style = RrType.label)
                    RrText(stringResource(R.string.builder_no_posting_saved), color = c.ink2)
                }
                RrTextField(pasted, { pasted = it }, Modifier.fillMaxWidth(), placeholder = stringResource(R.string.builder_paste_posting), singleLine = false, minLines = 5)
                RrButton(stringResource(R.string.builder_save_to_application), { actions.savePostingToApplication(pasted) }, enabled = pasted.isNotBlank() && !state.jobBusy)
                return@Column
            }
            if (app != null) RrCard(Modifier.fillMaxWidth()) {
                RrText("${app.role} · ${app.company}", style = RrType.label)
            } else {
                RrText(stringResource(R.string.builder_match_against_job), style = RrType.sectionHeading)
                RrText(stringResource(R.string.builder_match_not_linked), color = c.ink2)
                var picked by remember { mutableStateOf<Application?>(null) }
                ApplicationPicker(state, actions, current = null, onPick = { picked = it })
                picked?.let { CopyOrLink(it, state, actions) { picked = null } }
                RrText(stringResource(R.string.builder_or), style = RrType.small, color = c.ink3, modifier = Modifier.align(Alignment.CenterHorizontally))
            }
            if (m is MatchState.Failed) RrText(stringResource(S.string.couldn_t_load_the_linked_posting), color = c.dangerText)
            RrTextField(pasted, { pasted = it }, Modifier.fillMaxWidth(), placeholder = stringResource(R.string.builder_paste_posting), singleLine = false, minLines = 5)
            RrButton(stringResource(R.string.builder_match_this_posting), { actions.matchPosting(pasted) }, enabled = pasted.isNotBlank())
            RrText(stringResource(R.string.builder_pasted_can_be_saved), style = RrType.small, color = c.ink3)
        }
        is MatchState.Ready -> {
            RrListRow(if (m.pasted == null && app != null) "${app.company} · ${app.role}" else stringResource(S.string.for_this_visit_only),
                modifier = Modifier.padding(top = 12.dp), subtitle = stringResource(if (m.pasted == null) R.string.builder_posting_linked else R.string.builder_posting_pasted),
                onClick = { if (m.pasted == null && app != null) onOpenApplication(app.id) else { changing = !changing; actions.loadApplications() } }, trailing = {
                    Box(Modifier.heightIn(min = 44.dp).clickable { changing = !changing; actions.loadApplications() }, contentAlignment = Alignment.Center) {
                        RrText(stringResource(S.string.change), style = RrType.ui, color = c.ink3)
                    }
                })
            if (m.pasted != null) SaveAsJob(m.pasted, state, actions, startOpen = saveJobOpen)
            if (changing && m.pasted == null && app != null) Column(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                var picked by remember { mutableStateOf<Application?>(null) }
                ApplicationPicker(state, actions, current = app.id, onPick = { picked = it.takeIf { p -> p.id != app.id } })
                picked?.let { CopyOrLink(it, state, actions) { picked = null; changing = false } }
                RrButton(stringResource(R.string.builder_unlink_application), { changing = false; actions.linkApplication(null) }, variant = RrButtonVariant.Ghost, size = RrButtonSize.Small, enabled = !state.locked && !state.jobBusy)
            }
            Column(Modifier.padding(start = 24.dp, end = 24.dp, top = 16.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                RrText(stringResource(R.string.builder_terms_count, m.matched, m.total), style = RrType.bigNumber)
                RrText(stringResource(R.string.builder_terms_already), style = RrType.ui, color = c.ink3)
            }
            if (m.total == 0) RrText(stringResource(R.string.builder_no_terms), color = c.ink2, modifier = Modifier.padding(24.dp))
            if (m.missing.isNotEmpty()) {
                RrSectionHeading(stringResource(R.string.builder_missing_terms))
                RrText(stringResource(R.string.builder_terms_hint), style = RrType.ui, color = c.ink3, modifier = Modifier.padding(horizontal = 24.dp))
                var termMenu by remember { mutableStateOf<MatchTerm?>(null) }
                m.missing.forEachIndexed { index, term ->
                    RrListRow(term.label, divider = index < m.missing.lastIndex, onClick = { termMenu = term }, trailing = {
                        RrText(stringResource(S.string.add), style = RrType.linkSmall, color = c.accentText, modifier = Modifier.padding(vertical = 8.dp))
                    })
                }
                termMenu?.let { term -> RrBottomSheet(onDismissRequest = { termMenu = null }, title = term.label, fitContent = true) {
                    RrMenuItem(stringResource(S.string.add_to_skills), { haptics(RrHaptic.Light); actions.addSkill(term.label); termMenu = null }, enabled = !state.locked)
                    RrMenuItem(stringResource(S.string.ask_the_assistant_to_work_it_in), { onAskAssistant(resources.getString(R.string.builder_assistant_term_prompt, term.label)); termMenu = null })
                    RrMenuItem(stringResource(S.string.not_true_for_me_hide_it), { haptics(RrHaptic.Light); actions.hideTerm(term.term, term.label); termMenu = null }, enabled = !state.locked)
                } }
            }
            if (m.found.isNotEmpty()) {
                RrSectionHeading(stringResource(R.string.builder_covered))
                m.found.forEach { term -> RrListRow(term.label, onClick = { findTerm(doc, term.label)?.let(onShowOnPage) }) }
            }
            val hidden = doc.metadata["check"].obj()["hiddenTerms"].arr().map { it.str() }
            if (hidden.isNotEmpty()) Row(Modifier.padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                RrText(stringResource(R.string.builder_hidden_terms, hidden.joinToString(", ")), color = c.ink3, modifier = Modifier.weight(1f))
                RrButton(stringResource(R.string.builder_show_again), actions::showHiddenTerms, variant = RrButtonVariant.Ghost)
            }
        }
    }
}

/** "Link an application…": a row that opens the open applications ("role · company"); picking one calls [onPick]. */
@Composable
private fun ApplicationPicker(state: BuilderUiState, actions: BuilderActions, current: String?, onPick: (Application) -> Unit) {
    var open by remember { mutableStateOf(false) }
    val enabled = !state.locked && !state.jobBusy
    RrButton(stringResource(R.string.builder_link_application), { actions.loadApplications(); open = true }, variant = RrButtonVariant.Secondary, size = RrButtonSize.Small, icon = D.drawable.ic_ph_briefcase, enabled = enabled)
    if (open) RrBottomSheet(onDismissRequest = { open = false }, fitContent = true, title = stringResource(S.string.link_an_application)) {
        val apps = state.applications
        when {
            apps == null -> Row(Modifier.padding(16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) { RrSpinner() }
            apps.isEmpty() -> RrText(stringResource(S.string.no_applications_yet), color = RrTheme.colors.ink2, modifier = Modifier.padding(16.dp))
            else -> apps.forEach { a ->
                RrMenuItem("${a.role} · ${a.company}", { open = false; onPick(a) }, icon = if (a.id == current) D.drawable.ic_ph_check else D.drawable.ic_ph_briefcase)
            }
        }
    }
}

/**
 * A job picked for a resume that isn't its copy: make a copy for it (the default, so this resume stays as it is), or
 * link this resume itself (web job-match.tsx `CopyOrLink`).
 */
@Composable
private fun CopyOrLink(app: Application, state: BuilderUiState, actions: BuilderActions, onDone: () -> Unit) {
    val c = RrTheme.colors
    Column(Modifier.fillMaxWidth().clip(RrShape.lg).border(1.dp, c.line, RrShape.lg).padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        RrText(stringResource(S.string.tailor_a_copy_for_0_so_this_resume_stays_as_it_is_for_other_jobs_or_link_this_resume_itself, app.company), style = RrType.small, color = c.ink2)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            RrButton(stringResource(S.string.make_a_copy_for_this_job), { actions.copyForJob(app.id); onDone() }, size = RrButtonSize.Small, icon = D.drawable.ic_ph_copy, enabled = !state.jobBusy)
            RrButton(stringResource(S.string.link_this_resume), { actions.linkApplication(app.id); onDone() }, variant = RrButtonVariant.Ghost, size = RrButtonSize.Small, enabled = !state.locked && !state.jobBusy)
        }
    }
}

/**
 * "Save as a job…" under a pasted posting: company and role, then save with its own copy of this resume (the default)
 * or linked to this resume (web job-match.tsx `SaveAsApplication`).
 */
@Composable
private fun SaveAsJob(posting: String, state: BuilderUiState, actions: BuilderActions, startOpen: Boolean = false) {
    val c = RrTheme.colors
    var open by rememberSaveable { mutableStateOf(startOpen) }
    var company by rememberSaveable { mutableStateOf("") }
    var role by rememberSaveable { mutableStateOf("") }
    if (!open) {
        RrButton(stringResource(S.string.save_as_a_job), { open = true }, Modifier.padding(horizontal = 24.dp), variant = RrButtonVariant.Ghost, size = RrButtonSize.Small, icon = D.drawable.ic_ph_briefcase)
        return
    }
    val job = NewJob(company.trim(), role.trim(), posting.trim())
    val ready = job.company.isNotEmpty() && job.role.isNotEmpty() && !state.jobBusy
    Column(Modifier.fillMaxWidth().padding(start = 24.dp, end = 24.dp, top = 8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            RrTextField(company, { company = it }, Modifier.weight(1f), label = stringResource(S.string.company))
            RrTextField(role, { role = it }, Modifier.weight(1f), label = stringResource(S.string.role))
        }
        RrText(stringResource(S.string.the_copy_gets_the_job_s_posting_and_keeps_this_resume_as_it_is_for_other_jobs), style = RrType.small, color = c.ink3)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            RrButton(stringResource(S.string.save_job_and_make_a_copy), { actions.copyForJob(null, job) }, size = RrButtonSize.Small, icon = D.drawable.ic_ph_copy, enabled = ready)
            RrButton(stringResource(S.string.save_and_link_this_resume), { actions.saveJobAndLink(job); open = false }, variant = RrButtonVariant.Ghost, size = RrButtonSize.Small, enabled = ready && !state.locked)
            RrButton(stringResource(S.string.cancel), { open = false }, variant = RrButtonVariant.Ghost, size = RrButtonSize.Small, enabled = !state.jobBusy)
        }
    }
}

/** The entry (or section, or header) whose text mentions [label], so a covered term can be shown on the page. */
internal fun findTerm(doc: ResumeDoc, label: String): BlockTarget? {
    val needle = label.lowercase()
    fun has(element: kotlinx.serialization.json.JsonElement?): Boolean = element.toString().lowercase().contains(needle)
    for (ref in doc.sections) {
        if (doc.hidden(ref) || doc.pageOf(ref.key) == null) continue
        if (ref.kind == SectionKind.Summary) { if (has(doc.sectionJson(ref)["content"])) return BlockTarget.Section(ref.key); continue }
        doc.items(ref).firstOrNull { !it["hidden"].bool() && has(it) }?.let { return BlockTarget.Item(ref.key, it["id"].str()) }
    }
    return if (has(doc.basics)) BlockTarget.Header else null
}

/**
 * Writing: the saved writing review's notes, read-only, and Review writing to run a new one with the first usable AI
 * provider (Set up AI when there's none).
 */
@Composable
private fun WritingTab(state: BuilderUiState, actions: BuilderActions, onSetUpAi: () -> Unit) {
    val c = RrTheme.colors
    LaunchedEffect(Unit) { actions.loadAiProvider() }
    if (state.improve is ImproveState.NoProvider) LaunchedEffect(state.improve) { onSetUpAi(); actions.clearImprovement() }
    Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        val notes = state.writingNotes
        if (notes.isEmpty()) {
            RrText(stringResource(S.string.a_second_opinion_on_your_wording), style = RrType.sectionHeading)
            RrText(stringResource(S.string.the_checks_are_mechanical_this_asks_a_language_model_how_a_reader_might_react_to_your_bullets_and_su), color = c.ink2)
        }
        when {
            state.reviewing -> Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) { RrSpinner(); RrText(stringResource(R.string.builder_reviewing), color = c.ink2) }
            state.aiProvider == null && notes.isEmpty() -> RrButton(stringResource(S.string.set_up_ai), onSetUpAi, variant = RrButtonVariant.Secondary, icon = D.drawable.ic_ph_sparkle)
            else -> RrButton(stringResource(S.string.review_writing), actions::reviewWriting, variant = RrButtonVariant.Secondary, icon = D.drawable.ic_ph_sparkle)
        }
        notes.forEach { note ->
            RrCard(Modifier.fillMaxWidth()) {
                RrText(note.where, style = RrType.small, color = c.ink3)
                RrText(note.issue, style = RrType.body)
                if (note.rewrite.isNotBlank()) RrText(note.rewrite, style = RrType.body, color = c.ink2, modifier = Modifier.padding(top = 6.dp))
            }
        }
        RrText(stringResource(S.string.a_model_s_opinion_not_a_verdict_it_can_be_wrong), style = RrType.small, color = c.ink3)
        Spacer(Modifier.height(8.dp))
    }
}

/** Size changes animate, except under reduced motion, where they land at once. */
internal fun Modifier.sizeMotion(reduced: Boolean) = if (reduced) this else animateContentSize()
