package me.rxresu.feature.share

import androidx.compose.animation.*
import androidx.compose.animation.core.tween
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.foundation.background
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.text.style.TextDirection
import androidx.compose.foundation.combinedClickable
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import me.rxresu.core.designsystem.*
import me.rxresu.core.designsystem.R as DsR
import me.rxresu.core.strings.R as CoreR
import me.rxresu.core.network.generated.*

internal enum class ShareAction { Pdf, Formats, Copy, ShortLink, Qr, Web, Visitors, Versions, Publish }
@Composable internal fun ShareContent(state: ShareState, modifier: Modifier = Modifier, action: (ShareAction) -> Unit) {
    val c = RrTheme.colors
    val resume = state.resume
    var linkActions by remember { mutableStateOf(false) }
    Column(modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(bottom = 24.dp)) {
        RrPageTitle(stringResource(CoreR.string.share))
        if (state.loading) { RrSkeletonText(Modifier.padding(24.dp), lines = 8); return@Column }
        if (resume == null) { Failure(action = { action(ShareAction.Web) }); return@Column }
        RrHeroCard {
            Row(horizontalArrangement = Arrangement.spacedBy(20.dp), verticalAlignment = Alignment.CenterVertically) {
                RrPageThumbnail(state.thumbnail, Modifier.width(72.dp), contentDescription = stringResource(CoreR.string.resume))
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(20.dp)) {
                    Column {
                        RrText(state.filename + ".pdf", style = RrType.label, maxLines = 1)
                        RrText(pluralStringResource(R.plurals.share_page_format, state.pageCount, state.pageCount, resume.data.metadata.page.format.wireValue.uppercase()), style = RrType.ui, color = c.ink3)
                    }
                    RrButton(stringResource(CoreR.string.share_pdf), { action(ShareAction.Pdf) }, Modifier.fillMaxWidth(), size = RrButtonSize.Large, icon = DsR.drawable.ic_ph_share_network)
                }
            }
        }
        RrText(stringResource(R.string.other_formats), Modifier.padding(horizontal = 24.dp, vertical = 12.dp).clickable { action(ShareAction.Formats) }, style = RrType.textLink, color = c.accentText)
        RrSectionHeader(stringResource(CoreR.string.web_page), topPadding = 20.dp)
        RrListGroup {
            RrSwitchRow(stringResource(CoreR.string.public_link), resume.isPublic, { action(ShareAction.Publish) }, enabled = state.editable,
                subtitle = if (resume.hasPassword) stringResource(CoreR.string.public_with_a_password) else if (resume.isPublic) stringResource(R.string.public_link_hint) else stringResource(R.string.p4_only_you_can_see_this_resume), divider = resume.isPublic)
            AnimatedVisibility(resume.isPublic, enter = expandVertically(tween(if (RrTheme.reducedMotion) 0 else RrMotion.D2)) + fadeIn(), exit = shrinkVertically(tween(if (RrTheme.reducedMotion) 0 else RrMotion.D2)) + fadeOut()) {
                LinkRow((if (resume.isPrimary) state.shortUrl else state.url).removePrefix("https://").removePrefix("http://"), if (resume.isPrimary) stringResource(R.string.your_short_link) else null, { action(if (resume.isPrimary) ShareAction.ShortLink else ShareAction.Copy) }, { linkActions = true })
            }
            if (!resume.isPublic) RrListRow(stringResource(R.string.p4_the_address_is_kept), subtitle = state.url)
            RrListRow(stringResource(R.string.p4_web_page_settings), onClick = { action(ShareAction.Web) }, trailing = { RrRowCaret() })
        }
        RrSectionHeader(stringResource(CoreR.string.activity))
        RrListGroup {
            RrListRow(stringResource(R.string.p4_visitors_and_feedback), subtitle = stringResource(R.string.share_activity, pluralStringResource(R.plurals.views_month, state.views.toInt(), state.views), pluralStringResource(R.plurals.feedback_comments, state.links.sumOf { it.openCommentCount }.toInt(), state.links.sumOf { it.openCommentCount })), onClick = { action(ShareAction.Visitors) }, trailing = { RrRowCaret() })
        }
        RrSectionHeader(stringResource(R.string.p4_versions))
        RrListRow(stringResource(R.string.p4_versions), subtitle = state.versions.firstOrNull { it.name != null }?.name, onClick = { action(ShareAction.Versions) }, trailing = { RrRowCaret() })
        if (state.failed) Failure(action = { action(ShareAction.Visitors) })
    }
    if (linkActions) RrBottomSheet({ linkActions = false }, title = state.url, fitContent = true) {
        RrListRow(stringResource(R.string.copy_full_address), onClick = { linkActions = false; action(ShareAction.Copy) })
        RrListRow(stringResource(CoreR.string.qr_code), onClick = { linkActions = false; action(ShareAction.Qr) })
    }
}

@Composable internal fun Failure(action: () -> Unit) = RrCallout(stringResource(CoreR.string.couldn_t_load_try_again), Modifier.padding(16.dp), tone = RrTone.Danger, actionLabel = stringResource(CoreR.string.try_again), onAction = action)

@Composable internal fun WebPageScreen(state: ShareState, onBack: () -> Unit, onOpen: () -> Unit, onSlug: (String) -> Unit,
    onSetting: (String, Boolean) -> Unit, onDomain: () -> Unit, onPassword: () -> Unit, retry: () -> Unit) {
    var downloads by remember { mutableStateOf(false) }
    androidx.activity.compose.BackHandler(downloads) { downloads = false }
    Column(Modifier.fillMaxSize().background(RrTheme.colors.bg)) {
        RrTopBar(onBack = { if (downloads) downloads = false else onBack() }) { if (!downloads) RrIconButton(DsR.drawable.ic_ph_arrow_square_out, stringResource(CoreR.string.open_web_page), onOpen, enabled = state.resume?.isPublic == true && !state.checking) }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).rrNavigationBarsPadding().padding(bottom = 24.dp)) {
            RrPageTitle(stringResource(if (downloads) CoreR.string.downloads else CoreR.string.web_page))
            if (state.loading) { RrSkeletonText(Modifier.padding(24.dp), lines = 8); return@Column }
            val resume = state.resume ?: return@Column
            if (downloads) {
                RrSwitchRow(stringResource(CoreR.string.visitors_can_download_the_pdf), resume.showDownloadButtons, { onSetting("pdf", it) }, enabled = state.editable, divider = true)
                RrSwitchRow(stringResource(CoreR.string.visitors_can_download_word), resume.allowWordDownload == true, { onSetting("word", it) }, enabled = state.editable, divider = true)
                RrSwitchRow(stringResource(CoreR.string.show_made_with_reactive_resume), resume.data.metadata.web?.showCredit != false, { onSetting("credit", it) }, enabled = state.editable)
            } else {
                AddressField(state, onSlug)
                RrSwitchRow(stringResource(CoreR.string.primary_resume), resume.isPrimary, { onSetting("primary", it) }, subtitle = if (!resume.isPublic && resume.isPrimary) stringResource(CoreR.string.your_short_link_says_this_resume_isn_t_shared_until_you_publish_it_again) else if (resume.isPrimary) stringResource(R.string.primary_link_hint, state.shortUrl.removePrefix("https://").removePrefix("http://")) else stringResource(CoreR.string.turn_this_on_to_open_this_resume_at_your_short_link), enabled = state.editable && (resume.isPublic || resume.isPrimary) && (state.primaryLoaded || resume.isPrimary))
                RrSectionHeader(stringResource(CoreR.string.privacy))
                RrListGroup {
                    RrSwitchRow(stringResource(CoreR.string.hide_contact_details), resume.hideContactDetails, { onSetting("contact", it) }, enabled = state.editable, divider = true)
                    RrSwitchRow(stringResource(CoreR.string.show_in_search_engines), resume.showInSearchEngines, { onSetting("search", it) }, enabled = state.editable && !resume.hasPassword && resume.isPublic, divider = true)
                    RrListRow(stringResource(R.string.visitors_download), subtitle = when { resume.allowWordDownload == true && resume.showDownloadButtons -> "PDF · Word"; resume.showDownloadButtons -> "PDF"; resume.allowWordDownload == true -> "Word"; else -> stringResource(CoreR.string.off) }, onClick = { downloads = true }, divider = true, trailing = { RrRowCaret() })
                    RrListRow(stringResource(CoreR.string.password), subtitle = stringResource(if (resume.hasPassword) CoreR.string.on else CoreR.string.off), onClick = onPassword, enabled = state.editable, trailing = { RrRowCaret() })
                }
                if (state.customDomains) {
                    RrSectionHeader(stringResource(CoreR.string.your_domain))
                    RrListRow(state.domain?.hostname ?: stringResource(R.string.p4_not_connected), onClick = onDomain, trailing = { RrButton(stringResource(CoreR.string.connect), onDomain, variant = RrButtonVariant.Secondary, size = RrButtonSize.Small) })
                }
            }
            if (state.failed) Failure(retry)
        }
    }
}

@Composable internal fun VisitorsScreen(state: ShareState, back: () -> Unit, create: () -> Unit, open: (String) -> Unit, retry: () -> Unit) {
    val c = RrTheme.colors
    var selected by remember { mutableStateOf<Int?>(null) }
    val now = me.rxresu.core.data.LocalRepositories.current.time.now()
    Column(Modifier.fillMaxSize().background(c.bg)) {
        RrTopBar(onBack = back)
        BoxWithConstraints(Modifier.weight(1f)) {
        val firstViewport = maxHeight
        Column(Modifier.verticalScroll(rememberScrollState()).rrNavigationBarsPadding()) {
            val (active, past) = state.links.partition { it.status == GetFeedbackLinkResponseStatus.Active }
            @Composable fun links(values: List<CreateFeedbackLinkResponse>) {
                values.forEachIndexed { index, link ->
                    val days = link.expiresAt?.let { runCatching { feedbackDaysRemaining(now, java.time.Instant.parse(it)) }.getOrNull() }
                    val subtitle = if (link.openCommentCount > 0) pluralStringResource(R.plurals.feedback_comments, link.openCommentCount.toInt(), link.openCommentCount) + (days?.let { " · " + pluralStringResource(R.plurals.feedback_expires_days, it.toInt(), it) } ?: "")
                        else listOfNotNull(if (!link.allowComments) stringResource(R.string.p4_read_only) else null, link.lastViewedAt?.let { stringResource(R.string.p4_opened, feedbackDate(it)) } ?: stringResource(R.string.not_opened)).joinToString(" · ")
                    RrListRow(link.label, subtitle = subtitle, onClick = { open(link.id) }, divider = index < values.lastIndex, trailing = { RrRowCaret() })
                }
            }
        Column(Modifier.heightIn(min = firstViewport)) {
            RrPageTitle(stringResource(R.string.p4_visitors_and_feedback))
            if (state.loading) RrSkeletonText(Modifier.padding(24.dp), lines = 6)
            Column(Modifier.padding(start = 24.dp, end = 24.dp, top = 20.dp)) {
                RrText(state.views.toString(), style = RrType.statNumber.copy(fontSize = 40.sp, lineHeight = 44.sp))
                RrText(stringResource(R.string.visitor_totals, pluralStringResource(R.plurals.downloads, state.downloads.toInt(), state.downloads)), Modifier.padding(top = 2.dp), style = RrType.ui, color = c.ink3)
                if (state.daily.isEmpty()) RrText(stringResource(R.string.p4_no_visitors_yet_share_your_link_to_see_views_here), style = RrType.small)
                else Box(Modifier.padding(top = 16.dp)) { VisitorChart(state.daily.takeLast(30), selected) { selected = it } }
                selected?.let { index -> state.daily.takeLast(30).getOrNull(index)?.let { RrText(stringResource(R.string.p4_1_s_2_s_views, it.date, it.views.toLong().toString()), style = RrType.mono) } }
                RrText(stringResource(R.string.only_you_see_visitors), Modifier.padding(top = 10.dp), style = RrType.ui, color = c.ink3)
            }
            RrSectionHeader(stringResource(CoreR.string.feedback_links), actionLabel = stringResource(R.string.new_link), onAction = create)
            links(active)
            if (state.links.isEmpty() && !state.loading) RrEmptyState(stringResource(CoreR.string.feedback_links), stringResource(R.string.p4_create_a_private_link_to_ask_for_feedback), Modifier.padding(24.dp), stringResource(CoreR.string.new_feedback_link), create)
            if (state.failed) Failure(retry)
        }
        if (past.isNotEmpty()) { RrSectionHeader(stringResource(R.string.past_links)); links(past) }
        }
        }
    }
}

@Composable internal fun DownloadContent(state: ExportState, kind: me.rxresu.core.navigation.DocumentKind, onFormat: (FileFormat) -> Unit, onName: (String) -> Unit) {
    var more by remember { mutableStateOf(false) }
    Column(Modifier.verticalScroll(rememberScrollState()).padding(top = 8.dp)) {
        if (kind == me.rxresu.core.navigation.DocumentKind.Letter && state.paired) {
            RrSegmentedControl(listOf(RrSegment(stringResource(R.string.letter_only)), RrSegment(stringResource(R.string.resume_and_letter))), if (state.format == FileFormat.Pair) 1 else 0, { onFormat(if (it == 1) FileFormat.Pair else FileFormat.Pdf) }, Modifier.padding(horizontal = 24.dp), enabled = !state.busy)
            if (state.format == FileFormat.Pair) RrText(stringResource(R.string.p4_two_pdfs_named_to_match), Modifier.padding(horizontal = 24.dp, vertical = 8.dp), style = RrType.ui, color = RrTheme.colors.ink3)
        }
        RrListGroup(Modifier.selectableGroup()) {
            val formats = if (state.format == FileFormat.Pair) listOf(FileFormat.Pair) else listOf(FileFormat.Pdf, FileFormat.Word, FileFormat.Text, FileFormat.Json) + listOfNotNull(FileFormat.OpenDocument.takeIf { more })
            formats.forEach { format ->
                val label = when (format) { FileFormat.Pair -> stringResource(R.string.p4_resume_letter_2_files); FileFormat.Pdf -> stringResource(R.string.p4_pdf); FileFormat.Word -> stringResource(CoreR.string.word); FileFormat.OpenDocument -> stringResource(CoreR.string.opendocument); FileFormat.Text -> stringResource(R.string.plain_text); FileFormat.Json -> stringResource(R.string.json_backup) }
                val helper = when (format) { FileFormat.Pair -> stringResource(R.string.p4_two_pdfs_named_to_match); FileFormat.Pdf -> stringResource(R.string.p4_best_for_applying); FileFormat.Word -> stringResource(R.string.word_hint); FileFormat.OpenDocument -> stringResource(R.string.open_document_hint); FileFormat.Text -> stringResource(R.string.text_hint); FileFormat.Json -> stringResource(R.string.json_hint) }
                val offline = if (state.offline) stringResource(when (format) { FileFormat.Json -> R.string.p4_offline_json; FileFormat.Pdf, FileFormat.Pair -> R.string.p4_offline_pdf; else -> R.string.p4_offline_server_format }) else null
                RrOptionRow(label, state.format == format, { onFormat(format) }, helper = listOfNotNull(offline, helper).joinToString("\n"), enabled = !state.busy, divider = format != formats.last())
            }
        }
        RrTextField(state.name, onName, Modifier.padding(start = 24.dp, end = 24.dp, top = 16.dp), label = stringResource(CoreR.string.file_name), enabled = !state.busy, trailing = { RrText(".${state.format.extension}", style = RrType.mono, color = RrTheme.colors.ink3) })
        // OpenDocument stays reachable below the primary formats without crowding the fixed sheet.
        RrButton(stringResource(R.string.more_formats), { more = !more }, Modifier.padding(horizontal = 24.dp), variant = RrButtonVariant.GhostAccent, size = RrButtonSize.Small)
        if (state.failed) {
            RrCallout(stringResource(CoreR.string.download_failed_try_again), tone = RrTone.Danger)
            if (state.format != FileFormat.Pdf) RrButton(stringResource(CoreR.string.download_pdf_instead), { onFormat(FileFormat.Pdf) }, variant = RrButtonVariant.Secondary)
        }
    }
}

@Composable internal fun VersionsScreen(state: ShareState, selected: String?, onSelect: (String?) -> Unit, back: () -> Unit, name: (String?) -> Unit, restore: (String) -> Unit, delete: (String) -> Unit) {
    val c = RrTheme.colors
    val locale = androidx.compose.ui.platform.LocalConfiguration.current.locales[0]
    val now = me.rxresu.core.data.LocalRepositories.current.time.now().atZone(java.time.ZoneId.systemDefault()).toLocalDate()
    var menu by remember { mutableStateOf<ResumeVersionSummary?>(null) }
    Column(Modifier.fillMaxSize().background(c.bg)) {
        RrTopBar(onBack = back) { RrButton(stringResource(CoreR.string.name_this_version), { name(null) }, variant = RrButtonVariant.GhostAccent, size = RrButtonSize.Small, enabled = state.editable) }
        BoxWithConstraints(Modifier.weight(1f)) {
        val firstViewport = maxHeight
        Column(Modifier.verticalScroll(rememberScrollState()).rrNavigationBarsPadding()) {
        val (recent, older) = state.versions.partition { runCatching { java.time.LocalDate.parse(it.createdAt.take(10)) >= now.minusDays(7) }.getOrDefault(true) }
        @Composable fun history(values: List<ResumeVersionSummary>) {
            values.groupBy { it.createdAt.take(10) }.forEach { (date, versions) ->
                val parsed = runCatching { java.time.LocalDate.parse(date) }.getOrNull()
                val heading = if (parsed == now) stringResource(CoreR.string.today) else parsed?.format(java.time.format.DateTimeFormatter.ofPattern("d MMMM", locale)) ?: date
                RrSectionHeader(heading, topPadding = 20.dp)
                versions.forEachIndexed { index, version ->
                    val time = runCatching { java.time.Instant.parse(version.createdAt).atZone(java.time.ZoneId.systemDefault()).format(java.time.format.DateTimeFormatter.ofPattern("HH:mm")) }.getOrDefault(version.createdAt.drop(11).take(5))
                    val subtitle = time + when { version.kind == GetResumeVersionResponseKind.Ai -> " · " + stringResource(R.string.from_assistant); version.name != null -> " · " + stringResource(R.string.named); else -> "" }
                    RrListRow(version.name ?: versionLabel(version.kind), subtitle = subtitle,
                        leading = { Box(Modifier.size(8.dp).background(when (version.kind) { GetResumeVersionResponseKind.Ai -> c.infoText; GetResumeVersionResponseKind.Sent -> RrFixedColors.stageApplied; else -> RrFixedColors.stageSaved }, RrShape.full)) },
                        onClick = { onSelect(version.id) }, onLongClick = if (version.kind == GetResumeVersionResponseKind.Named) ({ menu = version }) else null,
                        divider = index < versions.lastIndex, trailing = { RrRowCaret() })
                }
            }
        }
        Column(Modifier.heightIn(min = firstViewport)) {
            RrPageTitle(stringResource(R.string.p4_versions), subtitle = stringResource(R.string.sessions_kept), subtitleColor = c.ink3)
            RrListRow(stringResource(CoreR.string.now), Modifier.padding(top = 20.dp), subtitle = stringResource(CoreR.string.the_resume_as_it_is), leading = { Box(Modifier.size(8.dp).background(c.accent, RrShape.full)) }, onClick = { onSelect(null) })
            history(recent)
            if (state.versions.size <= 1) RrText(stringResource(CoreR.string.only_one_version_so_far_every_editing_session_adds_one_automatically), Modifier.padding(24.dp), style = RrType.small)
            if (state.failed) RrCallout(stringResource(CoreR.string.couldn_t_save_your_changes_try_again_before_continuing), Modifier.padding(24.dp), tone = RrTone.Danger)
        }
        history(older)
        }
        }
    }
    menu?.let { version -> RrBottomSheet({ menu = null }, title = version.name, fitContent = true) {
        RrListRow(stringResource(CoreR.string.rename), onClick = { menu = null; name(version.id) }, enabled = state.editable)
        RrListRow(stringResource(CoreR.string.delete), onClick = { menu = null; delete(version.id) }, danger = true, enabled = state.editable)
    } }
}
@Composable private fun versionLabel(kind: GetResumeVersionResponseKind): String = when (kind) {
    GetResumeVersionResponseKind.Ai -> stringResource(CoreR.string.ai_edit); GetResumeVersionResponseKind.Auto -> stringResource(CoreR.string.editing_session); GetResumeVersionResponseKind.Import -> stringResource(CoreR.string.imported); GetResumeVersionResponseKind.Created -> stringResource(CoreR.string.created); GetResumeVersionResponseKind.BeforeRestore -> stringResource(R.string.p4_before_restoring); GetResumeVersionResponseKind.Restored -> stringResource(CoreR.string.restored); GetResumeVersionResponseKind.Sent -> stringResource(R.string.p4_sent_to); else -> stringResource(CoreR.string.named_version)
}

@Composable internal fun MoreContent(state: ShareState, action: (String) -> Unit) {
    val haptics = rememberRrHaptics()
    val resume = state.resume ?: return
    val now = me.rxresu.core.data.LocalRepositories.current.time.now()
    val locale = androidx.compose.ui.platform.LocalConfiguration.current.locales[0]
    val created = runCatching { java.time.Instant.parse(resume.createdAt).atZone(java.time.ZoneId.systemDefault()).format(java.time.format.DateTimeFormatter.ofPattern("d MMM yyyy", locale)) }.getOrDefault(resume.createdAt.take(10))
    val minutes = runCatching { java.time.Duration.between(java.time.Instant.parse(resume.updatedAt), now).toMinutes().coerceAtLeast(0) }.getOrNull()
    Column(Modifier.verticalScroll(rememberScrollState())) {
        Column(Modifier.padding(start = 24.dp, end = 24.dp, top = 12.dp, bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) { RrKeyValue(stringResource(CoreR.string.created), created, Modifier.weight(1f)); RrKeyValue(stringResource(CoreR.string.last_edited), minutes?.let { stringResource(R.string.minutes_ago, it) } ?: resume.updatedAt.take(10), Modifier.weight(1f)) }
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) { RrKeyValue(stringResource(CoreR.string.language), if (resume.data.metadata.page.locale == "en-GB") stringResource(R.string.english_uk) else java.util.Locale.forLanguageTag(resume.data.metadata.page.locale).getDisplayName(locale), Modifier.weight(1f)); RrKeyValue(stringResource(CoreR.string.length), pluralStringResource(R.plurals.page_count, state.pageCount, state.pageCount), Modifier.weight(1f)) }
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) { RrKeyValue(stringResource(CoreR.string.sharing), if (resume.isPublic) stringResource(CoreR.string.message_public) else stringResource(R.string.p4_private), Modifier.weight(1f)); RrKeyValue(stringResource(CoreR.string.tags), resume.tags.joinToString(), Modifier.weight(1f).clickable { action("tags") }) }
        }
        RrListGroup {
            RrListRow(if (resume.isLocked) stringResource(CoreR.string.unlock_editing) else stringResource(CoreR.string.lock_editing), leading = { RrIconTile(DsR.drawable.ic_ph_lock_simple_open, accent = resume.isLocked) }, onClick = { haptics(if (resume.isLocked) RrHaptic.ToggleOff else RrHaptic.ToggleOn); action("lock") }, enabled = !state.busy, divider = true)
            RrListRow(stringResource(R.string.rename_menu), leading = { RrIconTile(DsR.drawable.ic_ph_pencil_simple) }, onClick = { action("rename") }, enabled = !state.busy, divider = true)
            RrListRow(stringResource(CoreR.string.duplicate), leading = { RrIconTile(DsR.drawable.ic_ph_copy) }, onClick = { action("duplicate") }, enabled = !state.busy, divider = true)
            RrListRow(stringResource(R.string.translate_menu), leading = { RrIconTile(DsR.drawable.ic_ph_translate) }, onClick = { action("translate") }, enabled = !state.busy, divider = true)
            RrListRow(stringResource(R.string.copy_job_menu), leading = { RrIconTile(DsR.drawable.ic_ph_briefcase) }, onClick = { action("job") }, enabled = !state.busy, divider = true)
            RrListRow(stringResource(CoreR.string.notes), subtitle = stringResource(R.string.p4_only_you_can_see_these), leading = { RrIconTile(DsR.drawable.ic_ph_note) }, onClick = { action("notes") }, enabled = !state.busy, divider = true)
            RrListRow(stringResource(CoreR.string.print), leading = { RrIconTile(DsR.drawable.ic_ph_printer) }, onClick = { action("print") }, divider = true)
            RrListRow(stringResource(R.string.trash_menu), leading = { RrIconTile(DsR.drawable.ic_ph_trash) }, danger = true, enabled = state.editable, onClick = { action("trash") })
        }
        if (state.failed) Failure { action("retry") }
    }
}

@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable private fun LinkRow(url: String, subtitle: String?, copy: () -> Unit, qr: (() -> Unit)? = null) {
    val c = RrTheme.colors
    Row(Modifier.fillMaxWidth().padding(horizontal = 24.dp).rrDesignTag(DesignTag(component = "ListRow")).heightIn(min = 64.dp).combinedClickable(onClick = copy, onLongClick = qr)
        .drawBehind { drawLine(c.line, androidx.compose.ui.geometry.Offset(0f, size.height - 0.5.dp.toPx()), androidx.compose.ui.geometry.Offset(size.width, size.height - 0.5.dp.toPx()), 1.dp.toPx()) }
        .padding(top = 12.dp, bottom = 13.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            RrText(url, style = RrType.mono.copy(fontSize = 14.sp, lineHeight = 20.sp, fontWeight = androidx.compose.ui.text.font.FontWeight.Medium, textDirection = TextDirection.Ltr))
            if (subtitle != null) RrText(subtitle, style = RrType.ui, color = c.ink3)
        }
        RrIconButton(DsR.drawable.ic_ph_copy, stringResource(R.string.p4_copy_link), copy, size = RrIconButtonSize.Small)
    }
}

@Composable internal fun VisitorChart(days: List<GetResumeDailyStatisticsResponseItem>, selected: Int?, onSelect: (Int) -> Unit) {
    val rtl = LocalLayoutDirection.current == LayoutDirection.Rtl
    val select by rememberUpdatedState(onSelect)
    val haptics = rememberRrHaptics()
    val peak = days.maxOf { it.views }.coerceAtLeast(1.0)
    val summary = stringResource(CoreR.string.daily_views_over_30_days_peak_0, peak.toLong().toString())
    val value = selected?.let { days.getOrNull(it) }?.let { stringResource(R.string.p4_1_s_2_s_views, it.date, it.views.toLong().toString()) }
    // RrBarChart owns drawing, taps and TalkBack actions; this adapter keeps date values and drag scrubbing.
    RrBarChart(days.map { it.views.toFloat() }, listOfNotNull(summary, value).joinToString(". "),
        Modifier.height(64.dp).pointerInput(days, rtl) {
            detectHorizontalDragGestures(onDragStart = { point ->
                haptics(RrHaptic.Selection)
                select(visitorDayAt(point.x, size.width.toFloat(), days.size, rtl))
            }) { change, _ ->
                change.consume()
                select(visitorDayAt(change.position.x, size.width.toFloat(), days.size, rtl))
            }
        }, selected = selected, onSelect = onSelect,
        previousLabel = stringResource(R.string.p4_previous_day), nextLabel = stringResource(R.string.p4_next_day))
}

internal fun visitorDayAt(x: Float, width: Float, count: Int, rtl: Boolean): Int {
    require(count > 0 && width > 0)
    val index = (x / width * count).toInt().coerceIn(0, count - 1)
    return if (rtl) count - 1 - index else index
}
internal fun feedbackDate(value: String): String = runCatching { java.time.Instant.parse(value).atZone(java.time.ZoneId.systemDefault()).format(java.time.format.DateTimeFormatter.ofLocalizedDate(java.time.format.FormatStyle.MEDIUM)) }.getOrDefault(value)

internal fun feedbackDaysRemaining(now: java.time.Instant, expiry: java.time.Instant): Long =
    ((java.time.Duration.between(now, expiry).seconds.coerceAtLeast(0) + 86399) / 86400)
