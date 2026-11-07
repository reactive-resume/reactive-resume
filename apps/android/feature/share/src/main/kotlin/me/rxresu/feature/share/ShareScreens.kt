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
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextDirection
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
    Column(modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(bottom = 16.dp)) {
        if (state.loading) { RrSkeletonText(Modifier.padding(16.dp), lines = 8); return@Column }
        if (resume == null) { Failure(action = { action(ShareAction.Web) }); return@Column }
        Row(Modifier.padding(16.dp), horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
            RrPageThumbnail(null, Modifier.width(64.dp), locked = resume.isLocked)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                RrButton(stringResource(CoreR.string.share_pdf), { action(ShareAction.Pdf) }, Modifier.fillMaxWidth(), size = RrButtonSize.Large, icon = DsR.drawable.ic_ph_share_network)
                RrButton(stringResource(R.string.p4_download_formats), { action(ShareAction.Formats) }, Modifier.fillMaxWidth(), variant = RrButtonVariant.Secondary, icon = DsR.drawable.ic_ph_download_simple)
            }
        }
        RrText(stringResource(CoreR.string.web_page), Modifier.padding(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 8.dp), style = RrType.eyebrow, color = c.ink3)
        RrListGroup(Modifier.padding(horizontal = 16.dp)) {
            RrSwitchRow(stringResource(CoreR.string.public_link), resume.isPublic, { action(ShareAction.Publish) }, enabled = state.editable,
                subtitle = if (resume.hasPassword) stringResource(CoreR.string.public_with_a_password) else if (resume.isPublic) stringResource(R.string.p4_on_anyone_with_the_link_can_see_it) else stringResource(R.string.p4_only_you_can_see_this_resume), icon = if (resume.hasPassword) DsR.drawable.ic_ph_lock_simple else DsR.drawable.ic_ph_globe_simple)
            AnimatedVisibility(resume.isPublic, enter = expandVertically(tween(if (RrTheme.reducedMotion) 0 else RrMotion.D2)) + fadeIn(), exit = shrinkVertically(tween(if (RrTheme.reducedMotion) 0 else RrMotion.D2)) + fadeOut()) {
                Column {
                    LinkRow(state.url.removePrefix("https://").removePrefix("http://"), null, { action(ShareAction.Copy) }, { action(ShareAction.Qr) })
                    if (resume.isPrimary) LinkRow(state.shortUrl.removePrefix("https://").removePrefix("http://"), stringResource(R.string.p4_short_link_this_is_your_primary_resume), { action(ShareAction.ShortLink) })
                }
            }
            if (!resume.isPublic) RrListRow(stringResource(R.string.p4_the_address_is_kept), subtitle = state.url)
            RrListRow(stringResource(R.string.p4_web_page_settings), subtitle = stringResource(R.string.p4_address_privacy_password_domain), icon = DsR.drawable.ic_ph_sliders_horizontal, onClick = { action(ShareAction.Web) }, trailing = { RrRowCaret() })
        }
        RrSectionHeader(stringResource(CoreR.string.activity))
        RrListGroup(Modifier.padding(horizontal = 16.dp)) {
            RrListRow(stringResource(CoreR.string.visitors), subtitle = stringResource(R.string.p4_1_s_views_2_s_downloads_30_days, state.views.toString(), state.downloads.toString()), icon = DsR.drawable.ic_ph_chart_bar, onClick = { action(ShareAction.Visitors) }, trailing = { RrRowCaret() })
            RrListRow(stringResource(CoreR.string.feedback_links), subtitle = stringResource(R.string.p4_1_s_active_2_s_new_comments, state.links.count { it.status == GetFeedbackLinkResponseStatus.Active }.toString(), state.links.sumOf { it.openCommentCount }.toString()), icon = DsR.drawable.ic_ph_chat_circle_text, onClick = { action(ShareAction.Visitors) }, trailing = { RrRowCaret() })
            RrListRow(stringResource(R.string.p4_versions), subtitle = state.versions.firstOrNull { it.name != null }?.name, icon = DsR.drawable.ic_ph_clock_counter_clockwise, onClick = { action(ShareAction.Versions) }, trailing = { RrRowCaret() })
        }
        if (state.failed) Failure(action = { action(ShareAction.Visitors) })
    }
}

@Composable internal fun Failure(action: () -> Unit) = RrCallout(stringResource(CoreR.string.couldn_t_load_try_again), Modifier.padding(16.dp), tone = RrTone.Danger, actionLabel = stringResource(CoreR.string.try_again), onAction = action)

@Composable internal fun WebPageScreen(state: ShareState, onBack: () -> Unit, onOpen: () -> Unit, onSlug: (String) -> Unit,
    onSetting: (String, Boolean) -> Unit, onDomain: () -> Unit, onPassword: () -> Unit, retry: () -> Unit) {
    Column(Modifier.fillMaxSize().background(RrTheme.colors.bg)) {
        RrTopBar(stringResource(CoreR.string.web_page), onBack = onBack, status = { RrText(state.resume?.name.orEmpty()) }) { RrIconButton(DsR.drawable.ic_ph_arrow_square_out, stringResource(CoreR.string.open_web_page), onOpen, enabled = state.resume?.isPublic == true && !state.checking) }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).navigationBarsPadding().padding(bottom = 16.dp)) {
            if (state.loading) { RrSkeletonText(Modifier.padding(16.dp), lines = 8); return@Column }
            val resume = state.resume ?: return@Column
            AddressField(state, onSlug)
            RrSectionHeader(stringResource(if (state.customDomains) CoreR.string.short_link_and_domain else CoreR.string.short_link))
            RrListGroup(Modifier.padding(horizontal = 16.dp)) {
                RrSwitchRow(stringResource(CoreR.string.primary_resume), resume.isPrimary, { onSetting("primary", it) }, subtitle = if (!resume.isPublic && resume.isPrimary) stringResource(CoreR.string.your_short_link_says_this_resume_isn_t_shared_until_you_publish_it_again) else if (resume.isPrimary) stringResource(CoreR.string.your_short_link_opens_this_resume) else stringResource(CoreR.string.turn_this_on_to_open_this_resume_at_your_short_link), enabled = state.editable && (resume.isPublic || resume.isPrimary) && (state.primaryLoaded || resume.isPrimary))
                if (state.customDomains) RrListRow(stringResource(CoreR.string.your_domain), subtitle = state.domain?.hostname ?: stringResource(R.string.p4_not_connected), onClick = onDomain, trailing = { RrButton(stringResource(CoreR.string.connect), onDomain, variant = RrButtonVariant.Secondary, size = RrButtonSize.Small) })
            }
            RrSectionHeader(stringResource(CoreR.string.privacy))
            RrListGroup(Modifier.padding(horizontal = 16.dp)) {
                RrSwitchRow(stringResource(CoreR.string.hide_contact_details), resume.hideContactDetails, { onSetting("contact", it) }, enabled = state.editable)
                RrSwitchRow(stringResource(CoreR.string.show_in_search_engines), resume.showInSearchEngines, { onSetting("search", it) }, subtitle = if (resume.hasPassword) stringResource(CoreR.string.not_available_while_the_resume_needs_a_password) else stringResource(R.string.p4_let_recruiters_find_you_on_google_by_turning_this_on), enabled = state.editable && !resume.hasPassword && resume.isPublic)
                RrSwitchRow(stringResource(CoreR.string.visitors_can_download_the_pdf), resume.showDownloadButtons, { onSetting("pdf", it) }, enabled = state.editable)
                RrSwitchRow(stringResource(CoreR.string.visitors_can_download_word), resume.allowWordDownload == true, { onSetting("word", it) }, enabled = state.editable)
                RrSwitchRow(stringResource(CoreR.string.show_made_with_reactive_resume), resume.data.metadata.web?.showCredit != false, { onSetting("credit", it) }, enabled = state.editable)
            }
            RrSectionHeader(stringResource(CoreR.string.password))
            RrListGroup(Modifier.padding(horizontal = 16.dp)) { RrListRow(stringResource(CoreR.string.require_a_password), subtitle = stringResource(R.string.p4_visitors_enter_it_before_they_see_the_resume), icon = DsR.drawable.ic_ph_lock_simple, onClick = onPassword, enabled = state.editable, trailing = { RrRowValue(if (resume.hasPassword) stringResource(CoreR.string.on) else stringResource(CoreR.string.off)) }) }
            if (state.failed) Failure(retry)
        }
    }
}

@Composable internal fun VisitorsScreen(state: ShareState, back: () -> Unit, create: () -> Unit, open: (String) -> Unit, retry: () -> Unit) {
    val c = RrTheme.colors
    var selected by remember { mutableStateOf<Int?>(null) }
    Column(Modifier.fillMaxSize().background(c.bg)) {
        RrTopBar(stringResource(R.string.p4_visitors_and_feedback), onBack = back, status = { RrText(state.resume?.name.orEmpty()) })
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).navigationBarsPadding()) {
            if (state.loading) RrSkeletonText(Modifier.padding(16.dp), lines = 6)
            RrCard(Modifier.padding(16.dp)) {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.Bottom) {
                        Column { RrText(state.views.toString(), style = RrType.display.copy(fontSize = 40.sp, lineHeight = 44.sp)); RrText(stringResource(CoreR.string.views_30_days), style = RrType.small, color = c.ink2) }
                        Column(horizontalAlignment = Alignment.End) { RrText(state.downloads.toString(), style = RrType.sheetTitle); RrText(stringResource(CoreR.string.downloads), style = RrType.small, color = c.ink2) }
                    }
                    if (state.daily.isEmpty()) RrText(stringResource(R.string.p4_no_visitors_yet_share_your_link_to_see_views_here), style = RrType.small)
                    else {
                        VisitorChart(state.daily.takeLast(30), selected) { selected = it }
                        selected?.let { index -> state.daily.takeLast(30).getOrNull(index)?.let { RrText(stringResource(R.string.p4_1_s_2_s_views, it.date, it.views.toLong().toString()), style = RrType.mono) } }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) { RrIcon(DsR.drawable.ic_ph_lock_simple, null, size = 14.dp, tint = c.ink3); RrText(stringResource(CoreR.string.only_you_see_these), style = RrType.small, color = c.ink3) }
                }
            }
            RrSectionHeader(stringResource(CoreR.string.feedback_links), actionLabel = stringResource(CoreR.string.new_feedback_link), onAction = create)
            RrListGroup(Modifier.padding(horizontal = 16.dp)) {
                state.links.forEach { link ->
                    val active = link.status == GetFeedbackLinkResponseStatus.Active
                    RrListRow(link.label, subtitle = listOf(if (link.allowComments) stringResource(R.string.p4_comments_on) else stringResource(R.string.p4_read_only), link.lastViewedAt?.let { stringResource(R.string.p4_opened, feedbackDate(it)) } ?: stringResource(CoreR.string.not_opened_yet), link.expiresAt?.let { stringResource(R.string.p4_expires, feedbackDate(it)) } ?: stringResource(CoreR.string.never)).joinToString(" · "), icon = if (link.allowComments) DsR.drawable.ic_ph_chat_circle_text else DsR.drawable.ic_ph_eye, onClick = { open(link.id) }, trailing = {
                        RrBadge(if (link.openCommentCount > 0) stringResource(R.string.p4_1_s_new, link.openCommentCount.toString()) else if (active) stringResource(CoreR.string.active) else if (link.status == GetFeedbackLinkResponseStatus.Revoked) stringResource(R.string.p4_revoked) else stringResource(R.string.p4_expired), tone = if (link.openCommentCount > 0) RrBadgeTone.Info else if (active) RrBadgeTone.Accent else RrBadgeTone.Neutral); RrRowCaret()
                    })
                }
            }
            if (state.links.isEmpty() && !state.loading) RrEmptyState(stringResource(CoreR.string.feedback_links), stringResource(R.string.p4_create_a_private_link_to_ask_for_feedback), Modifier.padding(16.dp), stringResource(CoreR.string.new_feedback_link), create)
            RrCallout(stringResource(R.string.p4_get_resume_feedback_on_discord_ask_the_community_remove_personal_details_before_posti), Modifier.padding(16.dp), icon = DsR.drawable.ic_ph_chats_circle)
            if (state.failed) Failure(retry)
        }
    }
}

@Composable internal fun DownloadContent(state: ExportState, kind: me.rxresu.core.navigation.DocumentKind, onFormat: (FileFormat) -> Unit, onName: (String) -> Unit) {
    Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        RrListGroup(Modifier.selectableGroup()) {
            val formats = listOfNotNull(FileFormat.Pair.takeIf { kind == me.rxresu.core.navigation.DocumentKind.Letter && state.paired }) + FileFormat.entries.filter { it != FileFormat.Pair }
            formats.forEach { format ->
                val label = when (format) { FileFormat.Pair -> stringResource(R.string.p4_resume_letter_2_files); FileFormat.Pdf -> stringResource(R.string.p4_pdf); FileFormat.Word -> stringResource(CoreR.string.word); FileFormat.OpenDocument -> stringResource(CoreR.string.opendocument); FileFormat.Text -> stringResource(CoreR.string.markdown); FileFormat.Json -> stringResource(CoreR.string.json) }
                val helper = when (format) { FileFormat.Pair -> stringResource(R.string.p4_two_pdfs_named_to_match); FileFormat.Pdf -> stringResource(CoreR.string.looks_exactly_like_the_page_use_it_for_applications_and_email); FileFormat.Word -> stringResource(CoreR.string.for_portals_or_recruiters_who_ask_for_word_layout_is_simplified); FileFormat.OpenDocument -> stringResource(CoreR.string.for_libreoffice_and_other_open_source_editors_layout_is_simplified); FileFormat.Text -> stringResource(CoreR.string.plain_text_with_headings_paste_into_application_forms_and_notes); FileFormat.Json -> stringResource(CoreR.string.complete_data_backup_imports_back_into_reactive_resume) }
                val offline = if (state.offline) stringResource(when (format) { FileFormat.Json -> R.string.p4_offline_json; FileFormat.Pdf, FileFormat.Pair -> R.string.p4_offline_pdf; else -> R.string.p4_offline_server_format }) else null
                RrOptionRow(label, state.format == format, { onFormat(format) }, helper = listOfNotNull(offline, helper).joinToString("\n"), enabled = !state.busy,
                    badge = if (format == FileFormat.Pdf) ({ RrBadge(stringResource(R.string.p4_best_for_applying), tone = RrBadgeTone.Accent) }) else null)
            }
        }
        RrTextField(state.name, onName, label = stringResource(CoreR.string.file_name), enabled = !state.busy, trailing = { RrText(".${state.format.extension}", style = RrType.mono, color = RrTheme.colors.ink3) }, helper = stringResource(CoreR.string.recruiters_see_this_name_your_name_plus_resume_works_well))
        if (state.failed) RrCallout(stringResource(CoreR.string.download_failed_try_again), tone = RrTone.Danger, actionLabel = stringResource(CoreR.string.download_pdf_instead), onAction = { onFormat(FileFormat.Pdf) })
    }
}

@Composable internal fun VersionsScreen(state: ShareState, selected: String?, onSelect: (String?) -> Unit, back: () -> Unit, name: (String?) -> Unit, restore: (String) -> Unit, delete: (String) -> Unit) {
    val chosen = state.versions.firstOrNull { it.id == selected }
    val haptics = rememberRrHaptics()
    Column(Modifier.fillMaxSize().background(RrTheme.colors.bg)) {
        RrTopBar(stringResource(R.string.p4_versions), onBack = back, status = { RrText(state.resume?.name.orEmpty()) }) { RrButton(stringResource(CoreR.string.name_this_version), { name(null) }, variant = RrButtonVariant.Secondary, size = RrButtonSize.Small, enabled = state.editable) }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).navigationBarsPadding()) {
            if (chosen != null) Column(Modifier.fillMaxWidth().background(RrTheme.colors.sunken).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                RrText(chosen.name ?: versionLabel(chosen.kind), style = RrType.label)
                RrText(chosen.createdAt, style = RrType.mono, color = RrTheme.colors.ink3)
                RrText(stringResource(R.string.p4_preview_unavailable_for_saved_versions), style = RrType.small, color = RrTheme.colors.ink3)
                RrButton(stringResource(CoreR.string.restore_this_version), { restore(chosen.id) }, Modifier.fillMaxWidth(), enabled = state.editable)
                RrButton(stringResource(CoreR.string.back_to_now), { onSelect(null) }, Modifier.fillMaxWidth(), variant = RrButtonVariant.Secondary)
            }
            RrListRow(stringResource(CoreR.string.now), subtitle = stringResource(CoreR.string.the_resume_as_it_is), selected = selected == null, onClick = { onSelect(null) })
            state.versions.groupBy { it.createdAt.take(10) }.forEach { (date, versions) ->
                RrSectionHeader(date)
                versions.forEach { version -> RrListRow(version.name ?: versionLabel(version.kind), subtitle = version.createdAt.drop(11).take(5), selected = version.id == selected,
                    icon = if (version.kind == GetResumeVersionResponseKind.Ai) DsR.drawable.ic_ph_sparkle else DsR.drawable.ic_ph_clock_counter_clockwise,
                    onClick = { haptics(RrHaptic.Selection); onSelect(version.id) }, trailing = {
                        if (version.kind == GetResumeVersionResponseKind.Named) {
                            RrIconButton(DsR.drawable.ic_ph_pencil_simple, stringResource(CoreR.string.rename), { name(version.id) }, size = RrIconButtonSize.Small, enabled = state.editable)
                            RrIconButton(DsR.drawable.ic_ph_trash, stringResource(CoreR.string.delete), { delete(version.id) }, size = RrIconButtonSize.Small, enabled = state.editable)
                        }
                    }) }
            }
            if (state.versions.size <= 1) RrText(stringResource(CoreR.string.only_one_version_so_far_every_editing_session_adds_one_automatically), Modifier.padding(16.dp), style = RrType.small)
            if (state.failed) RrCallout(stringResource(CoreR.string.couldn_t_save_your_changes_try_again_before_continuing), Modifier.padding(16.dp), tone = RrTone.Danger)
        }
    }
}
@Composable private fun versionLabel(kind: GetResumeVersionResponseKind): String = when (kind) {
    GetResumeVersionResponseKind.Ai -> stringResource(CoreR.string.ai_edit); GetResumeVersionResponseKind.Auto -> stringResource(CoreR.string.editing_session); GetResumeVersionResponseKind.Import -> stringResource(CoreR.string.imported); GetResumeVersionResponseKind.Created -> stringResource(CoreR.string.created); GetResumeVersionResponseKind.BeforeRestore -> stringResource(R.string.p4_before_restoring); GetResumeVersionResponseKind.Restored -> stringResource(CoreR.string.restored); GetResumeVersionResponseKind.Sent -> stringResource(R.string.p4_sent_to); else -> stringResource(CoreR.string.named_version)
}

@Composable internal fun MoreContent(state: ShareState, action: (String) -> Unit) {
    val resume = state.resume ?: return
    val haptics = rememberRrHaptics()
    Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        RrListGroup {
            Column(Modifier.padding(horizontal = 14.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row { RrKeyValue(stringResource(CoreR.string.created), resume.createdAt.take(10), Modifier.weight(1f)); RrKeyValue(stringResource(CoreR.string.last_edited), resume.updatedAt.take(10), Modifier.weight(1f)) }
                Row { RrKeyValue(stringResource(CoreR.string.language), resume.data.metadata.page.locale, Modifier.weight(1f)); RrKeyValue(stringResource(CoreR.string.length), stringResource(R.string.p4_page_count_available_in_preview), Modifier.weight(1f)) }
                Row { RrKeyValue(stringResource(CoreR.string.sharing), if (resume.isPublic) stringResource(CoreR.string.message_public) else stringResource(R.string.p4_private), Modifier.weight(1f)); RrKeyValue(stringResource(CoreR.string.tags), resume.tags.joinToString(), Modifier.weight(1f).clickable { action("tags") }) }
            }
        }
        RrListGroup {
            RrListRow(if (resume.isLocked) stringResource(CoreR.string.unlock_editing) else stringResource(CoreR.string.lock_editing), icon = DsR.drawable.ic_ph_lock_simple_open, onClick = { haptics(if (resume.isLocked) RrHaptic.ToggleOff else RrHaptic.ToggleOn); action("lock") }, enabled = !state.busy)
            RrListRow(stringResource(CoreR.string.rename_267f020548), icon = DsR.drawable.ic_ph_pencil_simple, onClick = { action("rename") }, enabled = state.editable)
            RrListRow(stringResource(CoreR.string.duplicate), icon = DsR.drawable.ic_ph_copy, onClick = { action("duplicate") }, enabled = !state.busy)
            RrListRow(stringResource(CoreR.string.translate_into), icon = DsR.drawable.ic_ph_translate, onClick = { action("translate") }, enabled = state.editable)
            RrListRow(stringResource(CoreR.string.copy_for_a_job), icon = DsR.drawable.ic_ph_briefcase, onClick = { action("job") }, enabled = state.editable)
            RrListRow(stringResource(CoreR.string.notes), subtitle = stringResource(R.string.p4_only_you_can_see_these), icon = DsR.drawable.ic_ph_note, onClick = { action("notes") }, enabled = state.editable)
            RrListRow(stringResource(CoreR.string.print), icon = DsR.drawable.ic_ph_printer, onClick = { action("print") })
            RrListRow(stringResource(CoreR.string.move_to_trash), icon = DsR.drawable.ic_ph_trash, danger = true, modifier = Modifier.alpha(if (state.editable) 1f else 0.45f), enabled = state.editable, onClick = { haptics(RrHaptic.Light); action("trash") })
        }
        if (state.failed) Failure { action("retry") }
    }
}

@Composable private fun LinkRow(url: String, subtitle: String?, copy: () -> Unit, qr: (() -> Unit)? = null) {
    Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(start = 14.dp, end = 8.dp, top = 8.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            RrText(url, style = RrType.mono.copy(textDirection = TextDirection.Ltr))
            if (subtitle != null) RrText(subtitle, style = RrType.small, color = RrTheme.colors.ink3)
        }
        RrIconButton(DsR.drawable.ic_ph_copy, stringResource(R.string.p4_copy_link), copy, size = RrIconButtonSize.Small)
        if (qr != null) RrIconButton(DsR.drawable.ic_ph_qr_code, stringResource(CoreR.string.qr_code), qr, size = RrIconButtonSize.Small)
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
        Modifier.pointerInput(days, rtl) {
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
