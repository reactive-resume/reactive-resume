package me.rxresu.feature.letters

import androidx.activity.compose.BackHandler
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

@Serializable internal data class LetterHistory(val letterId: String)

@Composable internal fun LetterVersionsScreen(state: LetterState, back: () -> Unit, name: () -> Unit, restore: (String) -> Unit, rename: (String) -> Unit, delete: (String) -> Unit) {
    var menu by remember { mutableStateOf<LetterVersionSummary?>(null) }
    BackHandler(onBack = back)
    Column(Modifier.fillMaxSize().background(RrTheme.colors.bg).rrNavigationBarsPadding()) {
        RrTopBar(onBack = back) { RrButton(stringResource(S.string.name_this_version), name, variant = RrButtonVariant.GhostAccent, size = RrButtonSize.Small, enabled = state.editable) }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
            RrPageTitle(stringResource(R.string.p4_versions), subtitle = state.letter?.name)
            state.versions.groupBy { it.createdAt.take(10) }.forEach { (date, versions) ->
                RrSectionHeader(date)
                versions.forEachIndexed { index, version ->
                    RrListRow(version.name ?: when (version.kind) {
                        GetCoverLetterVersionResponseKind.Created -> stringResource(S.string.created)
                        GetCoverLetterVersionResponseKind.Auto -> stringResource(S.string.editing_session)
                        GetCoverLetterVersionResponseKind.Restored -> stringResource(S.string.restored)
                        GetCoverLetterVersionResponseKind.BeforeRestore -> stringResource(R.string.before_restoring)
                        else -> stringResource(S.string.named_version)
                    }, subtitle = version.createdAt.drop(11).take(5), onClick = { restore(version.id) },
                        onLongClick = if (version.kind == GetCoverLetterVersionResponseKind.Named) ({ menu = version }) else null,
                        divider = index < versions.lastIndex, trailing = { RrRowCaret() })
                }
            }
            if (state.versions.isEmpty()) RrText(stringResource(S.string.only_one_version_so_far_every_editing_session_adds_one_automatically), Modifier.padding(24.dp), style = RrType.ui)
            if (state.failed) RrCallout(stringResource(S.string.couldn_t_save_your_changes_try_again_before_continuing), Modifier.padding(24.dp), tone = RrTone.Danger)
        }
    }
    menu?.let { version -> RrBottomSheet({ menu = null }, title = version.name, fitContent = true) {
        RrListRow(stringResource(S.string.rename), onClick = { menu = null; rename(version.id) }, enabled = state.editable)
        RrListRow(stringResource(S.string.delete), onClick = { menu = null; delete(version.id) }, danger = true, enabled = state.editable)
    } }
}

@Composable internal fun LetterRestoreSheet(state: LetterState, restore: () -> Unit, dismiss: () -> Unit) {
    RrBottomSheet(dismiss, title = stringResource(S.string.restore_this_version_2cef126bc0), fitContent = true, footer = {
        RrFooterBar(inSheet = true) {
            RrButton(stringResource(S.string.cancel), dismiss, Modifier.weight(1f), variant = RrButtonVariant.Secondary)
            RrButton(stringResource(S.string.restore_this_version), restore, Modifier.weight(1f), enabled = state.editable, loading = state.busy)
        }
    }) {
        RrText(stringResource(R.string.p4_your_current_letter_will_be_kept_as_a_version_before_restoring), Modifier.padding(24.dp), style = RrType.body)
        if (state.failed) RrCallout(stringResource(S.string.couldn_t_save_your_changes_try_again_before_continuing), Modifier.padding(24.dp), tone = RrTone.Danger)
    }
}
