package me.rxresu.feature.builder

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.navigation.NavController
import me.rxresu.core.designsystem.*
import me.rxresu.core.navigation.*
import me.rxresu.core.strings.R as S

/** Section navigation owns the selected section; entry forms keep the parent builder's draft owner. */
@Composable
internal fun SectionRoute(route: BuilderSection, vm: BuilderViewModel, nav: NavController) {
    val state by vm.state.collectAsState()
    val doc = state.doc ?: return
    val section = doc.section(route.section) ?: return
    val items = doc.items(section)
    Column(Modifier.fillMaxSize()) {
        RrTopBar(onBack = { nav.popBackStack() }, actions = {
            RrIconButton(me.rxresu.core.designsystem.R.drawable.ic_ph_plus, stringResource(S.string.add), {
                vm.addItem(section.key) { nav.navigate(BuilderEntry(route.resumeId, section.key, it)) }
            }, enabled = !state.locked)
        })
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
            RrPageTitle(doc.displayTitle(section))
            RrListGroup {
                items.forEachIndexed { index, item ->
                    RrListRow(section.kind.itemTitle(item), subtitle = section.kind.subtitle(item), divider = index < items.lastIndex,
                        onClick = { nav.navigate(BuilderEntry(route.resumeId, section.key, item["id"].str())) },
                        trailing = { RrRowCaret() })
                }
            }
        }
    }
}

/** Focused design destinations retain the same autosave and undo owner as the overview. */
@Composable
internal fun BuilderDesignRoute(route: BuilderDesign, state: BuilderUiState, actions: BuilderActions, nav: NavController) {
    val group = when (route.picker) {
        DesignPicker.Template, DesignPicker.Colour -> DesignGroup.Template
        DesignPicker.Layout -> DesignGroup.Layout
        else -> DesignGroup.Type
    }
    Column(Modifier.fillMaxSize()) {
        RrTopBar(onBack = { nav.popBackStack() })
        DesignMode(state, group, {}, actions, Modifier.weight(1f))
    }
}
