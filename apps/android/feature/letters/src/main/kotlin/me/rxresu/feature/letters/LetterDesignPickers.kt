package me.rxresu.feature.letters

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import kotlinx.serialization.Serializable
import me.rxresu.core.designsystem.*
import me.rxresu.core.network.generated.*
import me.rxresu.core.strings.R as S

/** Separate pushed pickers share the letter owner's draft and revision guards. */
@Serializable internal data class LetterDesignPicker(val letterId: String, val picker: String)

@Composable internal fun LetterPickerScreen(title: String, back: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxSize().background(RrTheme.colors.bg).rrNavigationBarsPadding()) {
        RrTopBar(onBack = back)
        RrPageTitle(title)
        Column(Modifier.weight(1f), content = content)
    }
}

@Composable internal fun LetterDesignPickerScreen(state: LetterState, picker: String, vm: LetterViewModel, back: () -> Unit) {
    val letter = state.letter ?: return
    if (picker == "letterhead") { LetterheadEditor(state, vm, back); return }
    val title = when (picker) { "template" -> stringResource(S.string.template); "language" -> stringResource(S.string.language); "signature" -> stringResource(R.string.signature); else -> stringResource(R.string.letterhead) }
    LetterPickerScreen(title, back) {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(top = 20.dp)) {
            when (picker) {
                "template" -> CreateResumeRequestTemplate.entries.filter { it != CreateResumeRequestTemplate.Unknown }.forEach { template -> RrListRow(template.wireValue.replaceFirstChar(Char::uppercase), selected = letter.style.metadata.template == template, onClick = { vm.template(template); back() }, enabled = state.editable && !letter.designLinked) }
                "language" -> java.util.Locale.getAvailableLocales().filter { it.toLanguageTag() != "und" }.distinctBy { it.toLanguageTag() }.sortedBy { it.displayName }.forEach { locale -> RrListRow(locale.displayName, onClick = { vm.locale(locale.toLanguageTag()); back() }, enabled = state.editable) }
                "signature" -> {
                    RrListRow(stringResource(R.string.typed_name), subtitle = letter.style.basics.name, selected = true)
                    var signOff by remember(letter.id) { mutableStateOf(letter.signOff.orEmpty()) }
                    RrTextField(signOff, { next -> signOff = next; vm.edit({ it.copy(signOff = next) }) }, Modifier.padding(24.dp), label = stringResource(S.string.sign_off), singleLine = false)
                    RrButton(stringResource(S.string.save), { vm.edit({ it.copy(signOff = signOff) }, back) }, Modifier.padding(horizontal = 24.dp), enabled = state.editable)
                    RrCallout(stringResource(R.string.signature_unavailable), Modifier.padding(24.dp))
                }
            }
            if (letter.designLinked && picker == "template") RrSwitchRow(stringResource(R.string.match_resume), true, { vm.designLinked(false) {} }, enabled = state.editable)
            if (state.failed) RrCallout(stringResource(S.string.couldn_t_save_your_wording_your_text_is_still_here_try_again), Modifier.padding(24.dp), tone = RrTone.Danger)
        }
    }
}

@Composable private fun LetterheadEditor(state: LetterState, vm: LetterViewModel, back: () -> Unit) {
    val letter = state.letter ?: return
    val baseline = remember(letter.id, letter.senderLinked) { letter.style.basics }
    var name by remember(baseline) { mutableStateOf(baseline.name) }
    var email by remember(baseline) { mutableStateOf(baseline.email) }
    var phone by remember(baseline) { mutableStateOf(baseline.phone) }
    val dirty = name != baseline.name || email != baseline.email || phone != baseline.phone
    var discard by remember { mutableStateOf(false) }
    val close = { if (dirty) discard = true else back() }
    androidx.activity.compose.BackHandler(onBack = close)
    LetterPickerScreen(stringResource(R.string.letterhead), close) {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(top = 20.dp)) {
            RrSwitchRow(stringResource(R.string.letterhead_hint), letter.senderLinked, { linked -> vm.edit({ it.copy(senderLinked = linked) }) }, enabled = state.editable && letter.sourceResumeId != null && !dirty)
            Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                RrTextField(name, { name = it }, label = stringResource(S.string.name), enabled = state.editable && !letter.senderLinked)
                RrTextField(email, { email = it }, label = stringResource(S.string.email), enabled = state.editable && !letter.senderLinked)
                RrTextField(phone, { phone = it }, label = stringResource(S.string.phone), enabled = state.editable && !letter.senderLinked)
                if (!letter.senderLinked) RrButton(stringResource(S.string.save), {
                    vm.metadata({ current ->
                        check(current.style.basics == baseline && !current.senderLinked)
                        PatchCoverLetterRequest(expectedRevision = current.revision, sender = PatchCoverLetterRequestSender(name = name, email = email, phone = phone))
                    }, back)
                }, enabled = state.editable && dirty, loading = state.busy)
                if (state.failed) RrCallout(stringResource(S.string.couldn_t_save_your_wording_your_text_is_still_here_try_again), tone = RrTone.Danger)
            }
        }
    }
    if (discard) RrAlertDialog(stringResource(me.rxresu.core.designsystem.R.string.ds_discard_changes_title), stringResource(me.rxresu.core.designsystem.R.string.ds_discard_changes_body), stringResource(me.rxresu.core.designsystem.R.string.ds_discard), { discard = false; back() }, { discard = false }, dismissLabel = stringResource(me.rxresu.core.designsystem.R.string.ds_keep_editing), confirm = RrDialogConfirm.Danger)
}
