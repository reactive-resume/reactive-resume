package me.rxresu.feature.documents

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import me.rxresu.core.designsystem.RrText
import me.rxresu.core.navigation.RrNavMotion
import me.rxresu.core.navigation.screen
import me.rxresu.core.navigation.sheet
import me.rxresu.core.navigation.tabRoot
import me.rxresu.core.navigation.DocumentsTab
import me.rxresu.core.navigation.DocumentActions
import me.rxresu.core.navigation.NewDocument
import me.rxresu.core.navigation.Import
import me.rxresu.core.navigation.Trash

/** Registers this module's destinations. Placeholder screens until the feature lands. */
fun NavGraphBuilder.documentsGraph(nav: NavController, motion: RrNavMotion) {
    tabRoot<DocumentsTab>(motion) { Placeholder("D1") }
    sheet<DocumentActions> { Placeholder("D2") }
    sheet<NewDocument> { Placeholder("D3") }
    screen<Import> { Placeholder("D4") }
    screen<Trash> { Placeholder("D6") }
}

@Composable
private fun Placeholder(id: String) = Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { RrText(id) }
