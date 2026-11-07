package me.rxresu.feature.share

import androidx.compose.runtime.Composable
import androidx.navigation.NavController
import me.rxresu.core.designsystem.RrText

/** B11: Share mode content inside the builder, under its mode bar (provided to `LocalBuilderShareMode` by :app). */
@Composable
fun BuilderShareMode(resumeId: String, nav: NavController) = RrText("B11")
