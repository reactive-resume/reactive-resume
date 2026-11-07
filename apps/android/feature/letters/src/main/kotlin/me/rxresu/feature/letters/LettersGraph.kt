package me.rxresu.feature.letters

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.*
import me.rxresu.core.data.LocalRepositories
import me.rxresu.core.designsystem.*
import me.rxresu.core.strings.R as CoreR
import me.rxresu.core.navigation.*
import me.rxresu.core.network.generated.*

fun NavGraphBuilder.lettersGraph(nav: NavController, motion: RrNavMotion) {
    screen<Letter> { entry ->
        val route = entry.toRoute<Letter>(); val repositories = LocalRepositories.current
        val vm: LetterViewModel = viewModel { LetterViewModel(repositories, route.letterId) }; val state by vm.state.collectAsStateWithLifecycle()
        var mode by remember { mutableStateOf(route.mode) }; var details by remember { mutableStateOf(false) }; var form by remember { mutableStateOf<String?>(null) }
        val haptics = rememberRrHaptics()
        val back = { vm.leave { nav.popBackStack() }; Unit }
        BackHandler(onBack = back)
        Box {
            LetterScreen(state, mode, details, { action -> when (action) {
                "undo" -> vm.undo()
                "retry" -> vm.retry()
                "write" -> mode = LetterMode.Write
                "design" -> mode = LetterMode.Design
                "export" -> nav.navigate(Download(route.letterId, DocumentKind.Letter))
                "details" -> { details = true; haptics(RrHaptic.Light) }
                "hide-details" -> details = false
                "resume-design" -> state.letter?.sourceResumeId?.let { nav.navigate(Builder(it, mode = BuilderMode.Design)) }
                "assistant" -> vm.assistant(null) { thread -> nav.navigate(Assistant(state.letter?.sourceResumeId.orEmpty(), thread)) }
                else -> if (action.startsWith("assistant:")) {
                    entry.savedStateHandle["rr.assistant.prompt"] = action.removePrefix("assistant:")
                    vm.assistant(null) { thread -> nav.navigate(Assistant(state.letter?.sourceResumeId.orEmpty(), thread)) }
                } else { form = action; if (action in listOf("recipient", "body")) vm.focus(true) }
            } }, { linked -> vm.designLinked(linked) { haptics(RrHaptic.Success) } }, { vm.pageFormat(it) }, back)
            val dismiss = { form = null; vm.focus(false); Unit }
            when (form) {
                "more" -> RrBottomSheet(dismiss, title = state.letter?.name, fitContent = true) {
                    RrListRow(if (state.letter?.isLocked == true) stringResource(CoreR.string.unlock_editing) else stringResource(CoreR.string.lock_editing), onClick = { vm.lock(dismiss) })
                    RrListRow(stringResource(CoreR.string.rename_267f020548), onClick = { form = "rename" }, enabled = state.editable)
                    RrListRow(stringResource(R.string.p4_versions), onClick = { form = "versions" })
                }
                "rename" -> LetterTextSheet(stringResource(CoreR.string.rename), state.letter?.name.orEmpty(), state, { text -> vm.metadata({ PatchCoverLetterRequest(expectedRevision = it.revision, name = text) }, dismiss) }, dismiss)
                "recipient" -> RecipientSheet(state, { recipient, date, greeting, signoff -> vm.edit({ it.copy(recipient = recipient, letterDate = date.ifBlank { null }, greeting = greeting, signOff = signoff) }, dismiss) }, dismiss)
                "body" -> LetterBodySheet(state, { content -> vm.edit({ it.copy(content = content) }, dismiss) }, dismiss)
                "resume" -> RrBottomSheet(dismiss, title = stringResource(CoreR.string.resume), initialDetent = 1) { state.resumes.forEach { resume -> RrListRow(resume.name, onClick = { vm.linkResume(resume.id, dismiss) }) }; RrListRow(stringResource(CoreR.string.entry_header_accent_none), onClick = { vm.edit({ it.copy(sourceResumeId = null, designLinked = false) }, dismiss) }) }
                "application" -> RrBottomSheet(dismiss, title = stringResource(CoreR.string.application), initialDetent = 1) { state.applications.forEach { app -> RrListRow(app.company, subtitle = app.role, onClick = { vm.linkApplication(app.id, dismiss) }) } }
                "template" -> RrBottomSheet(dismiss, title = stringResource(CoreR.string.template), initialDetent = 1) { CreateResumeRequestTemplate.entries.filter { it != CreateResumeRequestTemplate.Unknown }.forEach { template -> RrListRow(template.wireValue.replaceFirstChar(Char::uppercase), selected = state.letter?.style?.metadata?.template == template, onClick = { vm.template(template); dismiss() }) } }
                "type" -> RrBottomSheet(dismiss, title = stringResource(CoreR.string.type), fitContent = true) { val size = state.letter?.style?.metadata?.typography?.body?.fontSize ?: 10.5; RrStepper(size.toString(), { vm.font((size - 0.5).coerceAtLeast(6.0)) }, { vm.font((size + 0.5).coerceAtMost(24.0)) }, stringResource(CoreR.string.font_size), Modifier.padding(16.dp)) }
                "color" -> LetterTextSheet(stringResource(CoreR.string.color), state.letter?.style?.metadata?.design?.colors?.primary.orEmpty(), state, { value -> if (Regex("#[0-9a-fA-F]{6}").matches(value)) { vm.color(value); dismiss() } }, dismiss)
                "language" -> RrBottomSheet(dismiss, title = stringResource(CoreR.string.language), initialDetent = 1) { java.util.Locale.getAvailableLocales().filter { it.toLanguageTag() != "und" }.distinctBy { it.toLanguageTag() }.sortedBy { it.displayName }.forEach { locale -> RrListRow(locale.displayName, onClick = { vm.locale(locale.toLanguageTag()); dismiss() }) } }
                "versions" -> RrBottomSheet(dismiss, title = stringResource(R.string.p4_versions), initialDetent = 1) { RrButton(stringResource(CoreR.string.name_this_version), { form = "version-name" }, Modifier.padding(16.dp), enabled = state.editable); state.versions.forEach { version -> RrListRow(version.name ?: version.kind.wireValue, subtitle = version.createdAt, onClick = { form = "restore:" + version.id }) } }
                "version-name" -> LetterTextSheet(stringResource(CoreR.string.name_this_version), "", state, { vm.createVersion(it, dismiss) }, dismiss)
                else -> if (form?.startsWith("restore:") == true) RrBottomSheet(dismiss, title = stringResource(CoreR.string.restore_this_version_2cef126bc0), fitContent = true) { RrText(stringResource(R.string.p4_your_current_letter_will_be_kept_as_a_version_before_restoring), Modifier.padding(16.dp)); RrButton(stringResource(CoreR.string.restore_this_version), { vm.restore(form!!.removePrefix("restore:"), dismiss) }, Modifier.padding(16.dp), enabled = state.editable) }
            }
        }
    }
}
@Composable private fun LetterTextSheet(title: String, initial: String, state: LetterState, save: (String) -> Unit, dismiss: () -> Unit) {
    var text by remember(initial) { mutableStateOf(initial) }
    RrBottomSheet(dismiss, title = title, confirmDiscard = text != initial, footer = { RrButton(stringResource(CoreR.string.save), { save(text) }, Modifier.fillMaxWidth().padding(16.dp), loading = state.busy, enabled = text.isNotBlank() && !state.busy) }) { RrTextField(text, { text = it }, Modifier.padding(16.dp), label = title); if (state.failed) RrCallout(stringResource(CoreR.string.couldn_t_save_your_wording_your_text_is_still_here_try_again), tone = RrTone.Danger) }
}
@Composable private fun RecipientSheet(state: LetterState, save: (String, String, String, String) -> Unit, dismiss: () -> Unit) {
    val letter = state.letter ?: return
    var recipient by remember { mutableStateOf(letter.recipient) }; var date by remember { mutableStateOf(letter.letterDate.orEmpty()) }; var greeting by remember { mutableStateOf(letter.greeting.orEmpty()) }; var signoff by remember { mutableStateOf(letter.signOff.orEmpty()) }
    RrBottomSheet(dismiss, title = stringResource(R.string.p4_letter_details), initialDetent = 1, confirmDiscard = recipient != letter.recipient || date != letter.letterDate.orEmpty() || greeting != letter.greeting.orEmpty() || signoff != letter.signOff.orEmpty(), footer = { RrButton(stringResource(CoreR.string.save), { save(recipient, date, greeting, signoff) }, Modifier.fillMaxWidth().padding(16.dp), loading = state.busy, enabled = state.editable) }) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) { RrTextField(recipient, { recipient = it }, label = stringResource(CoreR.string.recipient)); RrTextField(date, { date = it }, label = stringResource(CoreR.string.date)); RrTextField(greeting, { greeting = it }, label = stringResource(CoreR.string.greeting)); RrTextField(signoff, { signoff = it }, label = stringResource(CoreR.string.sign_off)); if (state.failed) RrCallout(stringResource(CoreR.string.couldn_t_save_your_wording_your_text_is_still_here_try_again), tone = RrTone.Danger) }
    }
}
@Composable private fun LetterBodySheet(state: LetterState, save: (String) -> Unit, dismiss: () -> Unit) {
    val letter = state.letter ?: return
    var text by remember(letter.id) { mutableStateOf(letter.content) }
    val rich = text.contains(Regex("</?[a-zA-Z][^>]*>"))
    RrBottomSheet(dismiss, title = stringResource(R.string.p4_letter_content), initialDetent = 1, confirmDiscard = text != letter.content, footer = { RrButton(stringResource(CoreR.string.save), { save(text) }, Modifier.fillMaxWidth().padding(16.dp), enabled = state.editable && !rich, loading = state.busy) }) {
        if (rich) {
            RrText(android.text.Html.fromHtml(text, android.text.Html.FROM_HTML_MODE_LEGACY).toString(), Modifier.padding(16.dp), style = RrType.body)
            RrCallout(stringResource(R.string.p4_rich_text_editing_is_not_available_on_this_device_yet_your_formatting_is_kept), Modifier.padding(16.dp))
        } else RrTextField(text, { text = it }, Modifier.padding(16.dp), label = stringResource(R.string.p4_letter_content), singleLine = false, minLines = 12)
        if (state.failed) RrCallout(stringResource(CoreR.string.couldn_t_save_your_wording_your_text_is_still_here_try_again), tone = RrTone.Danger)
    }
}
