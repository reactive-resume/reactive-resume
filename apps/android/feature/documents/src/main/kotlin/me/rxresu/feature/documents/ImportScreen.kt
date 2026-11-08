package me.rxresu.feature.documents

import android.text.format.Formatter
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.slideInVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.unit.dp
import java.util.Locale
import me.rxresu.core.designsystem.R as DS
import me.rxresu.core.designsystem.RrPageTitle
import me.rxresu.core.designsystem.RrSectionHeading
import me.rxresu.core.designsystem.RrFooterBar
import me.rxresu.core.designsystem.RrIconTile
import me.rxresu.core.designsystem.RrEmptyState
import androidx.compose.foundation.clickable
import androidx.compose.ui.unit.sp
import me.rxresu.core.designsystem.RrBottomSheet
import me.rxresu.core.designsystem.RrButton
import me.rxresu.core.designsystem.RrButtonSize
import me.rxresu.core.designsystem.RrButtonVariant
import me.rxresu.core.designsystem.RrCallout
import me.rxresu.core.designsystem.RrChoiceRow
import me.rxresu.core.designsystem.RrIcon
import me.rxresu.core.designsystem.RrListGroup
import me.rxresu.core.designsystem.RrListRow
import me.rxresu.core.designsystem.RrMotion
import me.rxresu.core.designsystem.RrRadio
import me.rxresu.core.designsystem.RrStep
import me.rxresu.core.designsystem.RrStepList
import me.rxresu.core.designsystem.RrStepState
import me.rxresu.core.designsystem.RrText
import me.rxresu.core.designsystem.RrTheme
import me.rxresu.core.designsystem.RrTone
import me.rxresu.core.designsystem.RrTopBar
import me.rxresu.core.designsystem.RrType
import me.rxresu.core.network.generated.ImportResumeFileLocale
import me.rxresu.core.strings.R as S

class ImportCallbacks(
    val onClose: () -> Unit = {},
    val onChangeFile: () -> Unit = {},
    val onMethod: (ImportMethod) -> Unit = {},
    val onReadWithAi: () -> Unit = {},
    val onLocale: (String) -> Unit = {},
    val onCreate: () -> Unit = {},
    val onStartBlank: () -> Unit = {},
    val onSetUpAi: () -> Unit = {},
)

/** D4 Import a resume: one scrolling screen that fills in as it goes (file, method, progress, summary). */
@Composable
fun ImportScreen(state: ImportUiState, callbacks: ImportCallbacks, modifier: Modifier = Modifier) {
    val c = RrTheme.colors
    var languages by rememberSaveable { mutableStateOf(false) }
    Box(modifier.fillMaxSize().background(c.bg)) {
        Column(Modifier.fillMaxSize()) {
            RrTopBar(onClose = callbacks.onClose)
            Column(
                Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(bottom = 16.dp),
            ) {
                RrPageTitle(stringResource(R.string.import_title))
                if (state.file == null) RrEmptyState(stringResource(R.string.import_choose_file), stringResource(R.string.docs_import_short), Modifier.padding(24.dp), actionLabel = stringResource(R.string.import_choose_file), onAction = callbacks.onChangeFile)
                state.file?.let { FileCard(it, state.format, callbacks.onChangeFile) }
                when (state.problem) {
                    ImportProblem.WrongType -> RrCallout(stringResource(R.string.import_wrong_type), tone = RrTone.Danger, actionLabel = stringResource(R.string.import_choose_another), onAction = callbacks.onChangeFile)
                    ImportProblem.WordNeedsAi -> RrCallout(stringResource(R.string.import_word_needs_ai), tone = RrTone.Warn, actionLabel = stringResource(R.string.import_set_up_ai), onAction = callbacks.onSetUpAi)
                    else -> {}
                }
                if (state.readable && state.problem != ImportProblem.WordNeedsAi) Method(state, callbacks)
                if (state.readable && (state.progress > 0 || state.running)) Steps(state)
                if (state.problem == ImportProblem.DestinationChanged) RrCallout(stringResource(R.string.import_destination_changed), tone = RrTone.Warn)
                if (state.problem == ImportProblem.Unreadable) {
                    RrCallout(stringResource(R.string.import_unreadable), tone = RrTone.Danger, actionLabel = stringResource(R.string.import_choose_another), onAction = callbacks.onChangeFile)
                }
                if (!state.readable && state.file != null && state.summary == null && state.problem == null) {
                    RrText(stringResource(R.string.import_no_preview), style = RrType.small, color = c.ink2)
                }
                AnimatedVisibility(
                    state.summary != null,
                    enter = if (RrTheme.reducedMotion) fadeIn(tween(0)) else fadeIn(tween(RrMotion.D2, easing = RrMotion.ease)) + slideInVertically(tween(RrMotion.D2, easing = RrMotion.ease)) { 18 },
                ) {
                    state.summary?.let { Summary(it, callbacks) }
                }
                if (state.problem == ImportProblem.CreateFailed) RrCallout(stringResource(R.string.import_failed), tone = RrTone.Danger)
            }
            if (state.file != null) RrFooterBar {
                RrButton(languageName(state.locale), { languages = true }, Modifier.weight(1f), variant = RrButtonVariant.Secondary, size = RrButtonSize.Large)
                RrButton(stringResource(R.string.import_create), callbacks.onCreate, Modifier.weight(1f), size = RrButtonSize.Large, enabled = state.canCreate, loading = state.creating)
            }
        }
        if (languages) {
            RrBottomSheet({ languages = false }, title = stringResource(R.string.import_language_title)) {
                RrText(stringResource(R.string.import_language_helper), Modifier.padding(start = 16.dp, end = 16.dp, bottom = 12.dp), style = RrType.small, color = c.ink2)
                RrListGroup(Modifier.padding(bottom = 16.dp)) {
                    ImportResumeFileLocale.entries.filter { it != ImportResumeFileLocale.Unknown }.forEach { locale ->
                        RrChoiceRow(languageName(locale.wireValue, region = true), locale.wireValue == state.locale, { callbacks.onLocale(locale.wireValue); languages = false })
                    }
                }
            }
        }
    }
}

private fun languageName(tag: String, region: Boolean = false): String {
    val locale = Locale.forLanguageTag(tag)
    return (if (region) locale.getDisplayName(locale) else locale.getDisplayLanguage(Locale.getDefault())).replaceFirstChar { it.titlecase(locale) }
}

@Composable
private fun FileCard(file: PickedFile, format: ImportFormat, onChange: () -> Unit) {
    val context = LocalContext.current
    val size = if (file.size % 1024L == 0L) "${file.size / 1024} KB" else Formatter.formatShortFileSize(context, file.size)
    RrListGroup(Modifier.padding(top = 16.dp), topDivider = true) {
        RrListRow(file.name, modifier = Modifier.padding(top = 1.dp), subtitle = if (file.pages != null) stringResource(R.string.import_size_pages, size, file.pages.toString()) else size,
            leading = { RrIconTile(if (format == ImportFormat.Pdf) DS.drawable.ic_ph_file_pdf else DS.drawable.ic_ph_file_text) },
            trailing = { Box(Modifier.height(36.dp).clickable(onClick = onChange), contentAlignment = Alignment.Center) { RrText(stringResource(R.string.import_change), style = RrType.linkSmall, color = RrTheme.colors.accentText) } })
    }
}

@Composable
private fun Method(state: ImportUiState, callbacks: ImportCallbacks) {
    val c = RrTheme.colors
    Column {
        RrSectionHeading(stringResource(R.string.import_how))
        RrListGroup {
            if (state.format == ImportFormat.Pdf) {
                MethodRow(stringResource(R.string.import_local), stringResource(R.string.import_local_subtitle), state.method == ImportMethod.Server, ai = false, divider = state.aiProvider != null) { callbacks.onMethod(ImportMethod.Server) }
            }
            if (state.aiProvider != null) {
                MethodRow(stringResource(R.string.import_ai), stringResource(R.string.import_ai_subtitle), state.method == ImportMethod.Ai, ai = true) { callbacks.onMethod(ImportMethod.Ai) }
            }
        }
        // Nothing is sent to the provider until the person has read where it goes and asked for it.
        if (state.method == ImportMethod.Ai && state.aiProvider != null) {
            if (state.progress == 0 && !state.running) {
                RrButton(stringResource(R.string.import_ai), callbacks.onReadWithAi, variant = RrButtonVariant.Secondary, size = RrButtonSize.Small, icon = DS.drawable.ic_ph_sparkle, iconTint = c.accentText)
            }
        }
    }
}

@Composable
private fun MethodRow(title: String, subtitle: String, selected: Boolean, ai: Boolean, divider: Boolean = false, onClick: () -> Unit) {
    val c = RrTheme.colors
    RrListRow(
        title,
        subtitle = subtitle,
        divider = divider,
        onClick = onClick,
        leading = {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                RrRadio(selected, null)
            }
        },
    )
}

/** Reading the file · Finding sections · Filling in entries. Each spinner swaps to a check when its work is done. */
@Composable
private fun Steps(state: ImportUiState) {
    if (state.summary != null) {
        Row(Modifier.padding(start = 24.dp, end = 24.dp, top = 16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            RrIcon(DS.drawable.ic_ph_check_circle, null, size = 20.dp, tint = RrTheme.colors.accentText)
            val summary = requireNotNull(state.summary)
            val sections = listOf(summary.experience, summary.education, summary.skills, summary.languages, summary.more).count { it > 0 }
            val pages = state.file?.pages ?: 1
            RrText(stringResource(R.string.import_finished, pluralStringResource(R.plurals.import_pages_read, pages, pages), pluralStringResource(R.plurals.import_sections_found, sections, sections)), style = RrType.body.copy(lineHeight = 22.sp), color = RrTheme.colors.ink2)
        }
        return
    }
    val labels = listOf(R.string.import_reading, R.string.import_finding, R.string.import_filling)
    val active = (state.progress - 1).coerceIn(labels.indices)
    RrStepList(listOf(RrStep(stringResource(labels[active]), if (state.running) RrStepState.Running else RrStepState.Done)))
}

@Composable
private fun Summary(summary: ImportSummary, callbacks: ImportCallbacks) {
    val c = RrTheme.colors
    Column {
        RrSectionHeading(stringResource(S.string.check_what_was_found))
        if (!summary.hasBasics) RrCallout(stringResource(R.string.import_no_basics), tone = RrTone.Warn)
        if (summary.empty) {
            RrCallout(stringResource(R.string.import_no_sections), tone = RrTone.Warn, actionLabel = stringResource(R.string.import_start_blank), onAction = callbacks.onStartBlank)
        }
        RrListGroup {
            RrListRow(
                stringResource(R.string.import_basics),
                subtitle = listOf(summary.name, summary.headline, summary.location).filter { it.isNotBlank() }.joinToString(" · ").ifEmpty { null },
                divider = true,
                trailing = if (summary.hasBasics) { { RrIcon(DS.drawable.ic_ph_check, null, size = 24.dp, tint = c.ink2) } } else null,
            )
            RrListRow(stringResource(R.string.import_experience), divider = true, trailing = { Count(summary.experience.toString()) })
            RrListRow(
                "${stringResource(S.string.education)} · ${stringResource(S.string.skills)} · ${stringResource(S.string.languages)}",
                divider = summary.more > 0,
                trailing = { Count("${summary.education} · ${summary.skills} · ${summary.languages}") },
            )
            if (summary.more > 0) {
                RrListRow(stringResource(R.string.import_more), subtitle = stringResource(R.string.import_more_subtitle), trailing = { Count(summary.more.toString()) })
            }
        }
    }
}

@Composable
private fun Count(text: String) = RrText(text, style = RrType.ui, color = RrTheme.colors.ink3)
