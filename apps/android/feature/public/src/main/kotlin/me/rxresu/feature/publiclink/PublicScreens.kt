@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
package me.rxresu.feature.publiclink


import androidx.compose.ui.res.stringResource
import me.rxresu.core.strings.R as CoreStrings

import android.graphics.Bitmap
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.rememberTransformableState
import androidx.compose.foundation.gestures.transformable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextDirection
import androidx.compose.ui.unit.dp
import me.rxresu.core.designsystem.*
import me.rxresu.core.designsystem.R as Icons
import me.rxresu.core.network.generated.CreatePdfCheckResponse
import me.rxresu.core.network.generated.CreatePdfCheckResponseTipsItem
import me.rxresu.core.page.PageRenderer
import me.rxresu.core.page.RenderedDocument

@Composable internal fun PublicScreen(state: PublicState, link: String, renderer: PageRenderer, password: (String) -> Unit, retry: () -> Unit, back: () -> Unit, share: () -> Unit, download: () -> Unit, word: () -> Unit, edit: () -> Unit, browser: () -> Unit, comments: () -> Unit) {
    // The bottom bar's surface runs under the gesture area; its content stays above it.
    Column(Modifier.fillMaxSize().background(RrTheme.colors.bg).imePadding()) {
        RrTopBar(state.feedback?.ownerName ?: state.resume?.data?.basics?.name ?: stringResource(R.string.public_resume_b3bd0b), onBack = back, status = { RrText(link.removePrefix("https://"), style = RrType.small.copy(textDirection = TextDirection.Ltr), maxLines = 1) }, actions = {
            if (state.owner) RrButton(stringResource(R.string.public_edit_530164), edit, variant = RrButtonVariant.GhostAccent, size = RrButtonSize.Small)
            if (state.feedback != null) RrIconButton(Icons.drawable.ic_ph_chat_circle, stringResource(R.string.public_comments_fce06e), comments)
            RrIconButton(Icons.drawable.ic_ph_share_network, stringResource(R.string.public_share_link_3c1362), share)
        })
        Box(Modifier.weight(1f).fillMaxWidth().background(RrTheme.colors.sunken)) {
            when {
                state.loading -> Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) { RrSkeletonText(lines = 3); RrSkeleton(Modifier.fillMaxWidth().aspectRatio(RrLayout.PAGE_ASPECT)) }
                state.problem == PublicProblem.Password || state.problem == PublicProblem.WrongPassword -> Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    RrTextField(state.password, password, label = stringResource(R.string.public_password_8be3c9), visualTransformation = PasswordVisualTransformation(), error = if (state.problem == PublicProblem.WrongPassword) stringResource(R.string.public_incorrect_password_please_try_again_f6a1b2) else null)
                    RrButton(stringResource(R.string.public_view_resume_e59ef3), retry, Modifier.fillMaxWidth(), enabled = state.password.isNotEmpty(), size = RrButtonSize.Large)
                }
                state.document != null -> DocumentPages(requireNotNull(state.document), renderer)
                else -> Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    val (title, body) = publicProblem(state.problem)
                    RrEmptyState(title, body, actionLabel = if (state.problem == PublicProblem.Offline) stringResource(R.string.public_retry_9f5cd8) else stringResource(R.string.public_open_in_browser_052269), onAction = if (state.problem == PublicProblem.Offline) retry else browser)
                    state.feedback?.applications?.forEach { application -> RrCard {
                        RrText(application.company, style = RrType.label); RrText(application.role, style = RrType.small)
                        RrStageLabel(when (application.status.wireValue) { "offer" -> RrStage.Offer; "interview" -> RrStage.Interview; "applied" -> RrStage.Applied; "screening" -> RrStage.Screening; "closed" -> RrStage.Closed; else -> RrStage.Saved }, application.stageLabel ?: application.status.wireValue)
                    } }
                    if (state.feedback != null) RrButton(stringResource(R.string.public_comments_fce06e), comments, variant = RrButtonVariant.Secondary)
                }
            }
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(RrTheme.colors.line))
        Row(Modifier.fillMaxWidth().background(RrTheme.colors.surface).windowInsetsPadding(WindowInsets.navigationBars).padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            RrText(stringResource(R.string.public_made_with_reactive_resume_21751a), Modifier.weight(1f), style = RrType.small, color = RrTheme.colors.ink3)
            if (state.resume?.allowWordDownload == true) RrButton(stringResource(R.string.public_word_44363c), word, variant = RrButtonVariant.Secondary, size = RrButtonSize.Large)
            if (state.resume?.showDownloadButtons == true && state.document != null) RrButton(stringResource(R.string.public_download_pdf_98e5ef), download, size = RrButtonSize.Large, icon = Icons.drawable.ic_ph_download_simple)
        }
    }
}
@Composable private fun publicProblem(problem: PublicProblem?): Pair<String, String> = when (problem) {
    PublicProblem.Revoked -> stringResource(R.string.public_this_link_was_turned_off_9fc1f6) to stringResource(R.string.public_ask_the_person_who_shared_it_for_a_new_link_56d5ff)
    PublicProblem.Expired -> stringResource(R.string.public_this_link_has_expired_a6b173) to stringResource(R.string.public_ask_the_person_who_shared_it_for_a_new_link_56d5ff)
    PublicProblem.NotShared -> stringResource(R.string.public_this_resume_isn_t_shared_right_now_90bffc) to stringResource(R.string.public_ask_the_person_who_shared_it_to_turn_sharing_on_fcfa09)
    PublicProblem.PreviewUnavailable -> stringResource(R.string.public_open_this_resume_in_your_browser_1eed68) to stringResource(R.string.public_this_server_doesn_t_provide_a_pdf_preview_for_this_link_11e537)
    PublicProblem.Offline -> stringResource(R.string.public_couldn_t_load_try_again_b45e5d) to stringResource(R.string.public_check_your_connection_and_try_again_563862)
    else -> stringResource(R.string.public_this_link_doesn_t_open_506bbe) to stringResource(R.string.public_ask_the_person_who_shared_it_for_a_new_link_56d5ff)
}

internal data class PdfMarker(val number: Int, val x: Float, val y: Float)
internal fun pdfMarkers(findings: List<CreatePdfCheckResponseTipsItem>, page: Int, width: Int, height: Int): List<PdfMarker> {
    if (width <= 0 || height <= 0) return emptyList()
    return findings.mapIndexedNotNull { index, finding ->
        val evidence = finding.evidence ?: return@mapIndexedNotNull null
        val box = evidence.box ?: return@mapIndexedNotNull null
        if (evidence.page != (page + 1).toDouble() || !box.x.isFinite() || !box.y.isFinite() || box.x < 0 || box.y < 0 || box.x >= width || box.y >= height) return@mapIndexedNotNull null
        PdfMarker(index + 1, (box.x / width).toFloat(), (box.y / height).toFloat())
    }
}
@Composable internal fun DocumentPages(document: RenderedDocument, renderer: PageRenderer, findings: List<CreatePdfCheckResponseTipsItem> = emptyList()) {
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        items(document.pageCount, key = { it }) { index ->
            var attempt by remember(document, index) { mutableIntStateOf(0) }
            var failed by remember(document, index) { mutableStateOf(false) }
            val page by produceState<Bitmap?>(null, document, index, attempt) {
                failed = false
                try { value = renderer.page(document, index, 1080) }
                catch (e: kotlinx.coroutines.CancellationException) { throw e }
                catch (_: Exception) { failed = true }
            }
            val dimensions by produceState<Pair<Int, Int>?>(null, document, index) {
                value = if (findings.isEmpty()) null else kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                    runCatching { android.os.ParcelFileDescriptor.open(document.file, android.os.ParcelFileDescriptor.MODE_READ_ONLY).use { fd ->
                        android.graphics.pdf.PdfRenderer(fd).use { pdf -> pdf.openPage(index).use { it.width to it.height } }
                    } }.getOrNull()
                }
            }
            var scale by remember { mutableFloatStateOf(1f) }; var pan by remember { mutableStateOf(Offset.Zero) }
            val transform = rememberTransformableState { zoom, offset, _ -> scale = (scale * zoom).coerceIn(1f, 4f); pan = if (scale == 1f) Offset.Zero else pan + offset }
            Column {
                if (failed) RrCallout(stringResource(R.string.public_couldn_t_load_try_again_b45e5d), tone = RrTone.Warn, actionLabel = stringResource(R.string.public_retry_9f5cd8), onAction = { attempt++ })
                RrPaperPage(page?.asImageBitmap(), stringResource(R.string.public_page_1_s_6654d7, (index + 1).toString()), Modifier
                    .then(page?.let { Modifier.aspectRatio(it.width.toFloat() / it.height) } ?: Modifier)
                    .graphicsLayer { scaleX = scale; scaleY = scale; translationX = pan.x; translationY = pan.y }.transformable(transform), overlay = {
                    dimensions?.let { (width, height) ->
                        BoxWithConstraints(Modifier.fillMaxSize()) {
                            pdfMarkers(findings, index, width, height).forEach { marker ->
                                RrBadge(marker.number.toString(), Modifier.offset(x = maxWidth * marker.x, y = maxHeight * marker.y), tone = RrBadgeTone.Warn)
                            }
                        }
                    }
                })
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    RrIconButton(Icons.drawable.ic_ph_minus, stringResource(R.string.public_zoom_out_a4ae4b), { scale = (scale - .5f).coerceAtLeast(1f); if (scale == 1f) pan = Offset.Zero }, enabled = scale > 1f)
                    RrIconButton(Icons.drawable.ic_ph_plus, stringResource(R.string.public_zoom_in_4fc05f), { scale = (scale + .5f).coerceAtMost(4f) }, enabled = scale < 4f)
                }
            }
        }
    }
}

@Composable internal fun FeedbackSheet(state: PublicState, close: () -> Unit, send: (String, String, () -> Unit) -> Unit) {
    var name by rememberSaveable { mutableStateOf("") }; var comment by rememberSaveable { mutableStateOf("") }
    val feedback = state.feedback ?: return
    RrBottomSheet(close, title = stringResource(R.string.public_comments_fce06e), initialDetent = 1, confirmDiscard = comment.isNotBlank(), footer = {
        if (feedback.allowComments) RrButton(stringResource(R.string.public_send_comment_591e0e), { send(name, comment) { comment = "" } }, Modifier.fillMaxWidth(), enabled = name.isNotBlank() && name.length <= 100 && comment.isNotBlank() && comment.length <= 4000 && !state.sending, loading = state.sending, size = RrButtonSize.Large)
    }) {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            feedback.comments.forEach { row -> RrCard { RrText(row.authorName, style = RrType.label); SelectionContainer { RrText(row.body, style = RrType.body) } } }
            if (feedback.allowComments) {
                RrTextField(name, { name = it }, label = stringResource(R.string.public_your_name_ab4229))
                RrTextField(comment, { comment = it }, label = stringResource(R.string.public_comment_153d7a), singleLine = false, minLines = 3)
                if (state.commentError) RrCallout(stringResource(R.string.public_couldn_t_send_your_comment_try_again_25a6da), tone = RrTone.Warn)
            }
        }
    }
}

@Composable internal fun AtsScreen(state: AtsState, renderer: PageRenderer, localDocument: RenderedDocument?, back: () -> Unit, choose: () -> Unit, sample: () -> Unit, posting: (String) -> Unit, check: () -> Unit, edit: () -> Unit, blank: () -> Unit, browser: () -> Unit, wordImport: () -> Unit = edit) {
    var parser by rememberSaveable { mutableStateOf(true) }
    Column(Modifier.fillMaxSize().background(RrTheme.colors.bg).windowInsetsPadding(WindowInsets.navigationBars).imePadding()) {
        RrTopBar(stringResource(R.string.public_ats_checker_6eb166), onBack = back, actions = { if (state.selected != null || state.result != null) RrButton(stringResource(R.string.public_check_another_file_020567), choose, variant = RrButtonVariant.Ghost, size = RrButtonSize.Small) })
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
            if (state.working) Column(Modifier.padding(16.dp)) { RrWorkingLabel(listOf(stringResource(R.string.public_opening_the_file_d9f543), stringResource(R.string.public_reading_the_text_da8da4), stringResource(R.string.public_checking_layout_and_content_03e79c))) }
            state.problem?.let { problem -> RrCallout(when (problem) { PdfProblem.TooLarge -> stringResource(R.string.public_that_file_is_too_large_to_check_pdfs_up_to_25_mb_work_9b9382); PdfProblem.Password -> stringResource(R.string.public_this_pdf_is_password_protected_save_an_unprotected_copy_and__18793f); PdfProblem.Unreadable -> stringResource(R.string.public_this_file_could_not_be_read_try_another_pdf_148f35); PdfProblem.Failed -> stringResource(R.string.public_couldn_t_check_this_file_try_again_20af9a) }, Modifier.padding(16.dp), tone = RrTone.Warn) }
            val result = state.result
            if (result == null) Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                RrText(stringResource(R.string.public_can_software_read_your_resume_09d20e), style = RrType.title)
                RrButton(stringResource(R.string.public_choose_a_pdf_4d98a4), choose, Modifier.fillMaxWidth(), size = RrButtonSize.Large, enabled = !state.working)
                RrButton(stringResource(R.string.public_try_a_sample_file_417ea1), sample, variant = RrButtonVariant.GhostAccent, enabled = !state.working)
                RrTextField(state.posting, posting, label = stringResource(R.string.public_paste_the_posting_to_see_which_of_its_terms_your_resume_alre_43dbfe), singleLine = false, minLines = 3)
                if (state.selected != null) {
                    RrText(state.selected.name, style = RrType.mono)
                    RrDisclosureLine(stringResource(R.string.public_when_you_choose_check_pdf_this_pdf_and_the_optional_posting__37b75e))
                    RrButton(stringResource(R.string.public_check_pdf_15983a), check, Modifier.fillMaxWidth(), size = RrButtonSize.Large, enabled = !state.working)
                }
                RrButton(stringResource(R.string.public_check_locally_in_your_browser_c70c55), browser, variant = RrButtonVariant.Secondary)
                RrButton(stringResource(R.string.public_start_a_blank_resume_7b6d49), blank, variant = RrButtonVariant.Ghost)
                RrButton(stringResource(R.string.public_import_word), wordImport, variant = RrButtonVariant.Ghost)
            } else {
                Row(Modifier.padding(16.dp), horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
                    RrScoreRing(result.score.toInt())
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        RrText(when (atsVerdict(result)) { AtsVerdict.Clean -> stringResource(R.string.public_reads_cleanly_8b490c); AtsVerdict.Mostly -> stringResource(R.string.public_mostly_readable_47ef7c); else -> stringResource(R.string.public_hard_for_software_to_read_154936) }, style = RrType.label)
                        val context = androidx.compose.ui.platform.LocalContext.current
                        RrText(result.file.name + " · " + android.text.format.Formatter.formatShortFileSize(context, result.file.sizeBytes.toLong()), style = RrType.mono, color = RrTheme.colors.ink3)
                    }
                }
                RrSegmentedControl(listOf(RrSegment(stringResource(R.string.public_what_a_person_sees_0b5c22)), RrSegment(stringResource(R.string.public_what_a_parser_reads_58404d))), if (parser) 1 else 0, { parser = it == 1 }, Modifier.padding(horizontal = 16.dp))
                Crossfade(parser, animationSpec = tween(if (RrTheme.reducedMotion) 0 else RrMotion.D2), label = "ats-view") { showParser ->
                    if (showParser) SelectionContainer { Box(Modifier.padding(start = 16.dp, end = 16.dp, top = 12.dp).fillMaxWidth().background(RrTheme.colors.sunken, RrShape.lg).padding(12.dp)) { RrText(result.fullText, style = RrType.mono, color = RrTheme.colors.ink2) } }
                    else if (localDocument != null) Box(Modifier.fillMaxWidth().height(400.dp)) { DocumentPages(localDocument, renderer, result.findings) }
                }
                if (result.findings.any { it.code.wireValue in setOf("NO_TEXT_LAYER", "IMAGE_ONLY_DOCUMENT") }) Column(Modifier.padding(16.dp)) {
                    RrButton(stringResource(R.string.public_start_a_blank_resume_7b6d49), blank, variant = RrButtonVariant.Secondary)
                    RrButton(stringResource(R.string.public_import_word), wordImport, variant = RrButtonVariant.Ghost)
                }
                RrSectionHeader(stringResource(R.string.public_fix_these_in_a_few_minutes_fd9f00))
                RrListGroup(Modifier.padding(horizontal = 16.dp)) { result.findings.forEachIndexed { index, finding ->
                    val message = findingMessage(finding.code.wireValue)
                    RrListRow(message.first, subtitle = message.second, leading = { IssueMarker(index + 1) })
                } }
                RrText(stringResource(R.string.public_the_server_checked_this_pdf_without_storing_it_the_score_ref_1b76d6), Modifier.padding(16.dp), style = RrType.small, color = RrTheme.colors.ink3)
                if (result.skippedChecks > 0) RrText(stringResource(R.string.public_1_s_skipped_checks_0e7943, result.skippedChecks.toInt().toString()), Modifier.padding(horizontal = 16.dp), style = RrType.small, color = RrTheme.colors.ink3)
                result.jd?.let { jd -> RrCard(Modifier.padding(16.dp)) { RrText(stringResource(R.string.public_posting_terms_bf4a60), style = RrType.label); RrText(stringResource(R.string.public_matched_terms_822688), style = RrType.small); RrText(jd.matchedTerms.joinToString(", "), style = RrType.small); RrText(stringResource(R.string.public_missing_terms_e30eec), style = RrType.small); RrText(jd.missingTerms.joinToString(", "), style = RrType.small) } }
            }
        }
        if (state.result != null) Box(Modifier.fillMaxWidth().height(1.dp).background(RrTheme.colors.line))
        if (state.result != null) RrButton(stringResource(R.string.public_edit_it_in_reactive_resume_de0fbf), edit, Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), size = RrButtonSize.Large)
    }
}

// TODO(lead): move to designsystem. Check issue marker: the number in warn-ink on a solid warn square (Tokens: warn is
// for marks, warn-ink for their numbers), as on B9 and P2.
@Composable private fun IssueMarker(number: Int) = Box(Modifier.size(16.dp).background(RrTheme.colors.warn, RrShape.sm), contentAlignment = Alignment.Center) {
    RrText(number.toString(), style = RrType.mono.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold), color = RrTheme.colors.warnInk, maxLines = 1)
}
