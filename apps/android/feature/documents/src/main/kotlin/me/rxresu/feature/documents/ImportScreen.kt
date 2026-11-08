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
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.windowInsetsPadding
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import java.util.Locale
import me.rxresu.core.designsystem.R as DS
import me.rxresu.core.designsystem.RrBottomSheet
import me.rxresu.core.designsystem.RrButton
import me.rxresu.core.designsystem.RrButtonSize
import me.rxresu.core.designsystem.RrButtonVariant
import me.rxresu.core.designsystem.RrCallout
import me.rxresu.core.designsystem.RrCard
import me.rxresu.core.designsystem.RrChoiceRow
import me.rxresu.core.designsystem.RrDisclosureLine
import me.rxresu.core.designsystem.RrIcon
import me.rxresu.core.designsystem.RrListGroup
import me.rxresu.core.designsystem.RrListRow
import me.rxresu.core.designsystem.RrMotion
import me.rxresu.core.designsystem.RrRadio
import me.rxresu.core.designsystem.RrSpinner
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
            RrTopBar(stringResource(R.string.import_title), onClose = callbacks.onClose)
            Column(
                Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 16.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
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
            Column(Modifier.fillMaxWidth().background(c.bg).windowInsetsPadding(WindowInsets.navigationBars)) {
                Box(Modifier.fillMaxWidth().height(1.dp).background(c.line))
                Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    RrButton(
                        stringResource(R.string.import_language, languageName(state.locale)),
                        { languages = true },
                        variant = RrButtonVariant.Secondary,
                        size = RrButtonSize.Large,
                    )
                    RrButton(stringResource(R.string.import_create), callbacks.onCreate, Modifier.weight(1f), size = RrButtonSize.Large, enabled = state.canCreate, loading = state.creating)
                }
            }
        }
        if (languages) {
            RrBottomSheet({ languages = false }, title = stringResource(R.string.import_language_title)) {
                RrText(stringResource(R.string.import_language_helper), Modifier.padding(start = 16.dp, end = 16.dp, bottom = 12.dp), style = RrType.small, color = c.ink2)
                RrListGroup(Modifier.padding(start = 16.dp, end = 16.dp, bottom = 16.dp)) {
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
    val c = RrTheme.colors
    val context = LocalContext.current
    RrCard(contentPadding = androidx.compose.foundation.layout.PaddingValues(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            RrIcon(if (format == ImportFormat.Pdf) DS.drawable.ic_ph_file_pdf else DS.drawable.ic_ph_file_text, null, tint = if (format == ImportFormat.Pdf) c.dangerText else c.ink2)
            Column(Modifier.weight(1f)) {
                RrText(file.name, style = RrType.mono, color = c.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                val size = Formatter.formatShortFileSize(context, file.size)
                RrText(if (file.pages != null) stringResource(R.string.import_size_pages, size, file.pages.toString()) else size, style = RrType.small, color = c.ink3)
            }
            RrButton(stringResource(R.string.import_change), onChange, variant = RrButtonVariant.Ghost, size = RrButtonSize.Small)
        }
    }
}

@Composable
private fun Method(state: ImportUiState, callbacks: ImportCallbacks) {
    val c = RrTheme.colors
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        RrText(stringResource(R.string.import_how), style = RrType.fieldLabel, color = c.ink2)
        RrListGroup {
            if (state.format == ImportFormat.Pdf) {
                MethodRow(stringResource(R.string.import_local), stringResource(R.string.import_local_subtitle), state.method == ImportMethod.Server, ai = false) { callbacks.onMethod(ImportMethod.Server) }
            }
            if (state.aiProvider != null) {
                MethodRow(stringResource(R.string.import_ai), stringResource(R.string.import_ai_subtitle), state.method == ImportMethod.Ai, ai = true) { callbacks.onMethod(ImportMethod.Ai) }
            }
        }
        // Nothing is sent to the provider until the person has read where it goes and asked for it.
        if (state.method == ImportMethod.Ai && state.aiProvider != null) {
            RrDisclosureLine(stringResource(R.string.import_ai_disclosure, listOfNotNull(state.aiProvider, state.aiDestination).joinToString(" · ")))
            if (state.progress == 0 && !state.running) {
                RrButton(stringResource(R.string.import_ai), callbacks.onReadWithAi, variant = RrButtonVariant.Secondary, size = RrButtonSize.Small, icon = DS.drawable.ic_ph_sparkle, iconTint = c.accentText)
            }
        }
    }
}

@Composable
private fun MethodRow(title: String, subtitle: String, selected: Boolean, ai: Boolean, onClick: () -> Unit) {
    val c = RrTheme.colors
    RrListRow(
        title,
        subtitle = subtitle,
        selected = selected,
        onClick = onClick,
        leading = {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                RrRadio(selected, null)
                if (ai) RrIcon(DS.drawable.ic_ph_sparkle, null, size = 16.dp, tint = c.accentText)
            }
        },
    )
}

/** Reading the file · Finding sections · Filling in entries. Each spinner swaps to a check when its work is done. */
@Composable
private fun Steps(state: ImportUiState) {
    val labels = listOf(R.string.import_reading, R.string.import_finding, R.string.import_filling)
    RrStepList(
        labels.mapIndexed { i, label ->
            val running = state.running && state.progress == i + 1
            RrStep(
                stringResource(label),
                when {
                    state.progress > i && !running -> RrStepState.Done
                    running -> RrStepState.Running
                    else -> RrStepState.Pending
                },
            )
        },
    )
}

@Composable
private fun Summary(summary: ImportSummary, callbacks: ImportCallbacks) {
    val c = RrTheme.colors
    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Box(Modifier.fillMaxWidth().height(1.dp).background(c.line))
        RrText(stringResource(S.string.check_what_was_found), style = RrType.sheetTitle, color = c.ink)
        if (!summary.hasBasics) RrCallout(stringResource(R.string.import_no_basics), tone = RrTone.Warn)
        if (summary.empty) {
            RrCallout(stringResource(R.string.import_no_sections), tone = RrTone.Warn, actionLabel = stringResource(R.string.import_start_blank), onAction = callbacks.onStartBlank)
        }
        RrListGroup {
            RrListRow(
                stringResource(R.string.import_basics),
                subtitle = listOf(summary.name, summary.headline, summary.location).filter { it.isNotBlank() }.joinToString(" · ").ifEmpty { null },
                trailing = if (summary.hasBasics) { { RrIcon(DS.drawable.ic_ph_check, null, size = 20.dp, tint = c.accentText) } } else null,
            )
            RrListRow(stringResource(R.string.import_experience), trailing = { Count(summary.experience.toString()) })
            RrListRow(
                "${stringResource(S.string.education)} · ${stringResource(S.string.skills)} · ${stringResource(S.string.languages)}",
                trailing = { Count("${summary.education} · ${summary.skills} · ${summary.languages}") },
            )
            if (summary.more > 0) {
                RrListRow(stringResource(R.string.import_more), subtitle = stringResource(R.string.import_more_subtitle), trailing = { Count(summary.more.toString()) })
            }
        }
    }
}

@Composable
private fun Count(text: String) = RrText(text, style = RrType.mono, color = RrTheme.colors.ink3)
