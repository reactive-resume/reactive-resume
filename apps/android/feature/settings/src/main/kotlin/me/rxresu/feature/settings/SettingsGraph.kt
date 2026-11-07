package me.rxresu.feature.settings

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import me.rxresu.core.designsystem.RrText
import me.rxresu.core.navigation.RrNavMotion
import me.rxresu.core.navigation.modal
import me.rxresu.core.navigation.screen
import me.rxresu.core.navigation.sheet
import me.rxresu.core.navigation.Settings
import me.rxresu.core.navigation.SettingsAccount
import me.rxresu.core.navigation.SettingsPreferences
import me.rxresu.core.navigation.SettingsProfile
import me.rxresu.core.navigation.SettingsAi
import me.rxresu.core.navigation.AiProviderSheet

/** Registers this module's destinations. Placeholder screens until the feature lands. */
fun NavGraphBuilder.settingsGraph(nav: NavController, motion: RrNavMotion) {
    modal<Settings>(motion) { Placeholder("S1") }
    screen<SettingsAccount> { Placeholder("S2") }
    screen<SettingsPreferences> { Placeholder("S3") }
    screen<SettingsProfile> { Placeholder("S4") }
    screen<SettingsAi> { Placeholder("S5") }
    sheet<AiProviderSheet> { Placeholder("S6") }
}

@Composable
private fun Placeholder(id: String) = Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { RrText(id) }
