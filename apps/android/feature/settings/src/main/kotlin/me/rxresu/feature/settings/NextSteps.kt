@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package me.rxresu.feature.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import me.rxresu.core.data.RrRepositories
import me.rxresu.core.designsystem.*
import me.rxresu.core.designsystem.R as D
import me.rxresu.core.network.generated.DocumentType
import me.rxresu.core.strings.R as CR

/** What a next step opens once its document or application is chosen (web settings/ai/next-steps.tsx). */
internal enum class NextStep { Improve, Writing, Fit }

internal data class NextStepChoice(val id: String, val label: String)
internal data class NextStepsState(val step: NextStep? = null, val loading: Boolean = false, val error: Boolean = false, val choices: List<NextStepChoice> = emptyList())

/** Loads the resumes (Improve, Review writing) or applications (Check fit) to choose from. */
internal class NextStepsViewModel(private val repositories: RrRepositories) : ViewModel() {
    private val mutable = MutableStateFlow(NextStepsState()); val state = mutable.asStateFlow()
    fun choose(step: NextStep?) {
        mutable.value = NextStepsState(step, loading = step != null)
        if (step != null) load(step)
    }
    fun retry() { state.value.step?.let(::choose) }
    private fun load(step: NextStep) = viewModelScope.launch {
        try {
            val choices = if (step == NextStep.Fit) repositories.applications.listApplicationSummaries().map { NextStepChoice(it.id, it.role + " · " + it.company) }
            else repositories.documents.listDocuments().filter { it.type == DocumentType.Resume }.map { NextStepChoice(it.id, it.name) }
            if (state.value.step == step) mutable.value = NextStepsState(step, choices = choices)
        } catch (e: CancellationException) { throw e } catch (_: Exception) {
            if (state.value.step == step) mutable.value = NextStepsState(step, error = true)
        }
    }
}

/** True once a provider becomes usable while S5 is open, as the web shows "AI is ready" right after connecting. */
@Composable
internal fun rememberJustConnected(s: SettingsState): MutableState<Boolean> {
    val connected = remember { mutableStateOf(false) }
    var known by remember { mutableStateOf<Set<String>?>(null) }
    val usable = s.providers.filter { it.enabled && it.testStatus == "success" }.map { it.id }.toSet()
    LaunchedEffect(usable, s.providersLoading) {
        if (s.providersLoading) return@LaunchedEffect
        known?.let { before -> if ((usable - before).isNotEmpty()) connected.value = true }
        known = usable
    }
    return connected
}

/** "AI is ready" with the web's next steps; the ones that need a document or job ask which one first. */
@Composable
internal fun NextStepsCard(dismiss: () -> Unit, choose: (NextStep) -> Unit, newLetter: () -> Unit, coach: () -> Unit, modifier: Modifier = Modifier) {
    val c = RrTheme.colors
    Column(modifier.fillMaxWidth().background(c.accentSoft, RrShape.lg).border(1.dp, c.accent, RrShape.lg).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            RrText(stringResource(CR.string.ai_is_ready), Modifier.weight(1f), style = RrType.sheetTitle)
            RrIconButton(D.drawable.ic_ph_x, stringResource(CR.string.dismiss), dismiss, size = RrIconButtonSize.Small)
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            RrButton(stringResource(CR.string.improve_selected_line), { choose(NextStep.Improve) }, variant = RrButtonVariant.Secondary, size = RrButtonSize.Small)
            RrButton(stringResource(CR.string.review_writing), { choose(NextStep.Writing) }, variant = RrButtonVariant.Secondary, size = RrButtonSize.Small)
            RrButton(stringResource(CR.string.check_fit), { choose(NextStep.Fit) }, variant = RrButtonVariant.Secondary, size = RrButtonSize.Small)
            RrButton(stringResource(CR.string.new_cover_letter), newLetter, variant = RrButtonVariant.Secondary, size = RrButtonSize.Small)
            RrButton(stringResource(CR.string.ask_the_coach), coach, variant = RrButtonVariant.Secondary, size = RrButtonSize.Small)
        }
    }
}

/** The resume or application picker behind Improve selected line, Review writing and Check fit. */
@Composable
internal fun NextStepSheet(s: NextStepsState, close: () -> Unit, retry: () -> Unit, open: (String) -> Unit, empty: () -> Unit) {
    val step = s.step ?: return
    val fit = step == NextStep.Fit
    RrBottomSheet(close, title = stringResource(when (step) { NextStep.Fit -> CR.string.check_fit; NextStep.Writing -> CR.string.review_writing; NextStep.Improve -> CR.string.improve_selected_line }), fitContent = true) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            RrText(stringResource(if (fit) CR.string.choose_an_application else CR.string.choose_a_resume), style = RrType.small, color = RrTheme.colors.ink3)
            when {
                s.loading -> RrSkeletonText(Modifier.fillMaxWidth(), lines = 3)
                s.error -> RrCallout(stringResource(if (fit) CR.string.couldn_t_load_applications_try_again else CR.string.couldn_t_load_documents_try_again), tone = RrTone.Danger,
                    actionLabel = stringResource(CR.string.try_again), onAction = retry)
                s.choices.isEmpty() -> RrEmptyState(stringResource(if (fit) CR.string.no_applications_yet else CR.string.no_resumes_yet), "",
                    actionLabel = stringResource(if (fit) CR.string.save_a_job else CR.string.import_or_create_a_resume), onAction = empty)
                else -> RrListGroup { s.choices.forEach { choice -> RrListRow(choice.label, onClick = { open(choice.id) }, trailing = { RrRowCaret() }) } }
            }
        }
    }
}
