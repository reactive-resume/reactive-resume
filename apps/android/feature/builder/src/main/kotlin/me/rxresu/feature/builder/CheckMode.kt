package me.rxresu.feature.builder

import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import me.rxresu.core.designsystem.LocalReducedMotion
import me.rxresu.core.designsystem.RrButton
import me.rxresu.core.designsystem.RrButtonSize
import me.rxresu.core.designsystem.RrButtonVariant
import me.rxresu.core.designsystem.RrCard
import me.rxresu.core.designsystem.RrEmptyState
import me.rxresu.core.designsystem.RrFilterChip
import me.rxresu.core.designsystem.RrHaptic
import me.rxresu.core.designsystem.RrIcon
import me.rxresu.core.designsystem.RrIconButton
import me.rxresu.core.designsystem.RrIconButtonSize
import me.rxresu.core.designsystem.RrListGroup
import me.rxresu.core.designsystem.RrListRow
import me.rxresu.core.designsystem.RrMotion
import me.rxresu.core.designsystem.RrRowCaret
import me.rxresu.core.designsystem.RrScoreRing
import me.rxresu.core.designsystem.RrSectionHeader
import me.rxresu.core.designsystem.RrSegment
import me.rxresu.core.designsystem.RrSegmentedControl
import me.rxresu.core.designsystem.RrShape
import me.rxresu.core.designsystem.RrSpinner
import me.rxresu.core.designsystem.RrText
import me.rxresu.core.designsystem.RrTextField
import me.rxresu.core.designsystem.RrTheme
import me.rxresu.core.designsystem.RrType
import me.rxresu.core.designsystem.RrStageDot
import me.rxresu.core.designsystem.RrStage
import me.rxresu.core.designsystem.rememberRrHaptics
import me.rxresu.core.navigation.CheckTab
import me.rxresu.core.strings.CatalogPlurals
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
) {
    val doc = state.doc ?: return
    val haptics = rememberRrHaptics()
    var writing by rememberSaveable { mutableStateOf(writingTab) }
    val checks = state.checks
    val issues = checks?.let { issueViews(doc, it.findings) }.orEmpty()
    Column(modifier.fillMaxSize().background(RrTheme.colors.bg).verticalScroll(rememberScrollState()).padding(bottom = 24.dp)) {
        if (tab == CheckTab.Issues && !writing && checks != null) ScoreHeader(checks.score.toInt(), issues.any { it.key.startsWith("FRAGMENTED_ENTRY") })
        RrSegmentedControl(
            listOf(
                RrSegment(stringResource(S.string.issues), count = if (issues.isNotEmpty()) "${issues.size}" else null),
                RrSegment(stringResource(S.string.job_match)),
                RrSegment(stringResource(S.string.writing)),
            ),
            selectedIndex = if (writing) 2 else tab.ordinal,
            onSelect = { i -> haptics(RrHaptic.Selection); writing = i == 2; if (i < 2) onTab(CheckTab.entries[i]) },
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
        )
        when {
            writing -> WritingTab(state, onSetUpAi)
            tab == CheckTab.Issues -> IssuesTab(state, doc, issues, actions, onShowOnPage, onWrite)
            else -> JobMatchTab(state, doc, actions, onShowOnPage, onAskAssistant)
        }
    }
    LaunchedEffect(tab, state.application) { if (tab == CheckTab.JobMatch && state.match == MatchState.Idle) actions.matchPosting(null) }
}

@Composable
private fun ScoreHeader(score: Int, fragmented: Boolean) {
    val c = RrTheme.colors
    val reduced = LocalReducedMotion.current
    var explain by rememberSaveable { mutableStateOf(false) }
    val shown by animateFloatAsState(score.toFloat(), if (reduced) tween(0) else tween(RrMotion.D3, easing = RrMotion.ease), label = "score")
    Column(Modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            val ringLabel = stringResource(S.string.readability_score_score_out_of_100, "$score")
            RrScoreRing(shown.toInt(), Modifier.semantics { contentDescription = ringLabel }, size = 64.dp, warnBelow = if (verdict(score, fragmented) == S.string.reads_cleanly) 0 else 101)
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    RrText(stringResource(verdict(score, fragmented)), style = RrType.sectionHeading, modifier = Modifier.weight(1f, fill = false))
                    RrIconButton(D.drawable.ic_ph_info, stringResource(R.string.builder_score_explainer_label), { explain = !explain }, size = RrIconButtonSize.Small, tint = c.ink3)
                }
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Box(Modifier.size(8.dp).clip(RrShape.sm).background(c.accent))
                    RrText(stringResource(S.string.live_updates_as_you_edit), color = c.ink3)
                }
            }
        }
        if (explain) RrText(stringResource(S.string.the_score_counts_how_reliably_software_reads_your_resume_it_doesn_t_predict_whether_you_ll_be_shortl), color = c.ink2, modifier = Modifier.padding(top = 8.dp))
    }
}

@Composable
private fun IssuesTab(state: BuilderUiState, doc: ResumeDoc, issues: List<IssueView>, actions: BuilderActions, onShowOnPage: (BlockTarget) -> Unit, onWrite: (BlockTarget) -> Unit) {
    val c = RrTheme.colors
    val haptics = rememberRrHaptics()
    val resources = LocalResources.current
    val checks = state.checks
    if (checks == null) { Column(Modifier.padding(16.dp)) { repeat(3) { me.rxresu.core.designsystem.RrSkeleton(Modifier.fillMaxWidth().height(96.dp).padding(bottom = 12.dp)) } }; return }
    if (issues.isEmpty()) RrEmptyState(stringResource(R.string.builder_nothing_to_fix), stringResource(S.string.every_check_passes), Modifier.padding(16.dp))
    val firstFix = issues.firstOrNull { it.fix != null }
    var previousCount by remember { androidx.compose.runtime.mutableIntStateOf(issues.size) }
    LaunchedEffect(issues.size) { if (issues.isEmpty() && previousCount > 0) haptics(RrHaptic.Success); previousCount = issues.size }
    issues.groupBy { it.category }.toSortedMap(compareBy { it.ordinal }).forEach { (category, list) ->
        RrSectionHeader(stringResource(category.title))
        list.forEach { issue ->
            RrCard(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp).animateContentSize()) {
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Box(Modifier.padding(top = 3.dp).size(18.dp).clip(RrShape.sm).background(c.warn), contentAlignment = Alignment.Center) {
                        RrText("${issue.number}", style = RrType.caption, color = c.warnInk)
                    }
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        RrText(issue.title, style = RrType.label)
                        if (issue.body.isNotEmpty()) RrText(issue.body, style = RrType.ui.copy(fontSize = RrType.body.fontSize), color = c.ink2)
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            val label = issue.fixLabel
                            if (label != null) RrButton(
                                label,
                                {
                                    haptics(RrHaptic.Light)
                                    val fix = issue.fix
                                    if (fix != null) actions.applyFix(fix) else issue.write?.let(onWrite)
                                },
                                variant = if (issue === firstFix) RrButtonVariant.Primary else RrButtonVariant.Secondary,
                                size = RrButtonSize.Small,
                                enabled = !state.locked,
                            )
                            issue.target?.let { t -> RrButton(stringResource(S.string.show_on_page), { onShowOnPage(t) }, variant = RrButtonVariant.Ghost, size = RrButtonSize.Small) }
                            RrButton(stringResource(if (issue.keepLabel) S.string.keep else S.string.ignore), { haptics(RrHaptic.Light); actions.ignoreIssue(issue.key) }, variant = RrButtonVariant.Ghost, size = RrButtonSize.Small, enabled = !state.locked)
                        }
                    }
                }
            }
        }
    }
    val ignored = checks.ignored.size
    if (ignored > 0) {
        RrButton(
            CatalogPlurals.get(resources, S.plurals.message_0_plural_one_show_ignored_issue_again_other_show_ignored_issues_again, ignored, "$ignored"),
            actions::showIgnored, Modifier.padding(horizontal = 8.dp, vertical = 8.dp), RrButtonVariant.Ghost,
        )
    }
    RrSectionHeader(stringResource(R.string.builder_checks_by_category))
    var open by rememberSaveable { mutableStateOf(false) }
    val failing = issues.map { it.category }.toSet()
    val passing = CheckCategory.entries.filter { it !in failing && (checks.categories[it.key]?.total ?: 1.0) > 0 }
    RrListGroup(Modifier.padding(horizontal = 16.dp)) {
        Column {
            if (passing.isNotEmpty()) {
                RrListRow(
                    passing.map { stringResource(it.title) }.joinToString(" · "),
                    subtitle = stringResource(R.string.builder_nothing_to_review),
                    icon = D.drawable.ic_ph_check_circle,
                    onClick = { open = !open },
                    trailing = { RrIcon(if (open) D.drawable.ic_ph_caret_up else D.drawable.ic_ph_caret_down, null, size = 20.dp, tint = c.ink2) },
                )
                if (open) passing.forEach { RrText(stringResource(it.description), color = c.ink2, modifier = Modifier.padding(start = 52.dp, end = 16.dp, bottom = 12.dp)) }
            }
            when (val pdf = state.pdfCheck) {
                PdfCheckState.Checking -> RrListRow(stringResource(R.string.builder_checking_pdf), icon = D.drawable.ic_ph_file_pdf, trailing = { RrSpinner() })
                else -> RrListRow(stringResource(S.string.also_check_the_exported_pdf), icon = D.drawable.ic_ph_file_pdf, onClick = actions::checkExportedPdf, trailing = { RrRowCaret() }, subtitle = (pdf as? PdfCheckState.Done)?.let { if (it.findings == 0) stringResource(R.string.builder_pdf_clean) else null })
            }
        }
    }
}

/** B10: posting terms already in the resume and the ones it lacks. Never a percentage. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun JobMatchTab(state: BuilderUiState, doc: ResumeDoc, actions: BuilderActions, onShowOnPage: (BlockTarget) -> Unit, onAskAssistant: (String) -> Unit) {
    val c = RrTheme.colors
    val resources = LocalResources.current
    val haptics = rememberRrHaptics()
    val app = state.application
    var pasted by rememberSaveable { mutableStateOf("") }
    when (val m = state.match) {
        MatchState.Idle, MatchState.Reading -> Row(Modifier.padding(16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) { RrSpinner(); RrText(stringResource(R.string.builder_reading_posting), color = c.ink2) }
        MatchState.NoPosting, is MatchState.Failed -> Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (app != null) RrCard(Modifier.fillMaxWidth()) {
                RrText("${app.company} · ${app.role}", style = RrType.label)
                RrText(stringResource(R.string.builder_no_posting_saved), color = c.ink2)
            } else {
                RrText(stringResource(R.string.builder_match_against_job), style = RrType.sectionHeading)
                RrText(stringResource(R.string.builder_match_not_linked), color = c.ink2)
            }
            if (m is MatchState.Failed) RrText(stringResource(S.string.couldn_t_load_the_linked_posting), color = c.dangerText)
            RrTextField(pasted, { pasted = it }, Modifier.fillMaxWidth(), placeholder = stringResource(R.string.builder_paste_posting), singleLine = false, minLines = 5)
            RrButton(stringResource(R.string.builder_match_this_posting), { actions.matchPosting(pasted) }, enabled = pasted.isNotBlank())
            RrText(stringResource(R.string.builder_pasted_can_be_saved), style = RrType.small, color = c.ink3)
        }
        is MatchState.Ready -> {
            RrCard(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    if (m.pasted == null && app != null) RrStageDot(RrStage.Interview)
                    Column(Modifier.weight(1f)) {
                        RrText(stringResource(if (m.pasted == null) R.string.builder_posting_linked else R.string.builder_posting_pasted), style = RrType.small, color = c.ink3)
                        RrText(if (m.pasted == null && app != null) "${app.company} · ${app.role}" else stringResource(S.string.for_this_visit_only), style = RrType.label)
                    }
                    if (m.pasted != null) RrButton(stringResource(S.string.clear), { pasted = ""; actions.matchPosting("") }, variant = RrButtonVariant.Ghost)
                }
            }
            val reduced = LocalReducedMotion.current
            val share by animateFloatAsState(if (m.total == 0) 0f else m.found.size / m.total.toFloat(), if (reduced) tween(0) else tween(RrMotion.D2, easing = RrMotion.ease), label = "match")
            Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 20.dp, bottom = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                RrText(stringResource(R.string.builder_posting_terms), style = RrType.body, modifier = Modifier.weight(1f))
                RrText(stringResource(S.string.done_of_total, "${m.found.size}", "${m.total}"), style = RrType.mono)
            }
            Box(Modifier.fillMaxWidth().padding(horizontal = 16.dp).height(8.dp).clip(RrShape.sm).background(c.sunken)) {
                Box(Modifier.fillMaxWidth(share).height(8.dp).background(c.accent))
            }
            if (m.total == 0) RrText(stringResource(R.string.builder_no_terms), color = c.ink2, modifier = Modifier.padding(16.dp))
            if (m.missing.isNotEmpty()) {
                RrSectionHeader(stringResource(S.string.not_in_your_resume_add_only_if_true))
                var open by rememberSaveable(m.missing.size) { mutableStateOf(m.missing.first().term) }
                RrListGroup(Modifier.padding(horizontal = 16.dp)) {
                    Column {
                        m.missing.forEach { term ->
                            if (open == term.term) Column(Modifier.background(c.surface).padding(16.dp).animateContentSize(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                RrText(term.label, style = RrType.label)
                                RrText(CatalogPlurals.get(resources, S.plurals.message_0_plural_one_1_appears_once_in_the_posting_if_it_s_part_of_your_experience_add_it_where_it_belongs_o, term.postingCount, "${term.postingCount}", term.label, term.label), color = c.ink2)
                                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                    RrButton(stringResource(S.string.add_to_skills), { haptics(RrHaptic.Light); actions.addSkill(term.label) }, variant = RrButtonVariant.Secondary, size = RrButtonSize.Small, enabled = !state.locked)
                                    RrButton(stringResource(S.string.ask_the_assistant_to_work_it_in), { onAskAssistant(resources.getString(R.string.builder_assistant_term_prompt, term.label)) }, variant = RrButtonVariant.Secondary, size = RrButtonSize.Small, icon = D.drawable.ic_ph_sparkle, iconTint = c.accentText)
                                    RrButton(stringResource(S.string.not_true_for_me_hide_it), { haptics(RrHaptic.Light); actions.hideTerm(term.term, term.label) }, variant = RrButtonVariant.Ghost, size = RrButtonSize.Small, enabled = !state.locked)
                                }
                            } else RrListRow(term.label, onClick = { open = term.term }, trailing = { RrIcon(D.drawable.ic_ph_caret_down, null, size = 20.dp, tint = c.ink2) })
                        }
                    }
                }
            }
            if (m.found.isNotEmpty()) {
                RrSectionHeader(stringResource(S.string.already_covered_pick_one_to_find_it_on_the_page))
                FlowRow(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    m.found.forEach { term ->
                        RrFilterChip(term.label, selected = false, onSelectedChange = { findTerm(doc, term.label)?.let(onShowOnPage) }, icon = D.drawable.ic_ph_check)
                    }
                }
            }
            val hidden = doc.metadata["check"].obj()["hiddenTerms"].arr().map { it.str() }
            if (hidden.isNotEmpty()) Row(Modifier.padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                RrText(stringResource(R.string.builder_hidden_terms, hidden.joinToString(", ")), color = c.ink3, modifier = Modifier.weight(1f))
                RrButton(stringResource(R.string.builder_show_again), actions::showHiddenTerms, variant = RrButtonVariant.Ghost)
            }
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

/** Writing: the saved writing review's notes, read-only (running a new review stays on the web for now). */
@Composable
private fun WritingTab(state: BuilderUiState, onSetUpAi: () -> Unit) {
    val c = RrTheme.colors
    Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        val notes = state.writingNotes
        if (notes.isEmpty()) {
            RrText(stringResource(S.string.a_second_opinion_on_your_wording), style = RrType.sectionHeading)
            RrText(stringResource(S.string.the_checks_are_mechanical_this_asks_a_language_model_how_a_reader_might_react_to_your_bullets_and_su), color = c.ink2)
            RrButton(stringResource(S.string.set_up_ai), onSetUpAi, variant = RrButtonVariant.Secondary, icon = D.drawable.ic_ph_sparkle)
        } else notes.forEach { note ->
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
