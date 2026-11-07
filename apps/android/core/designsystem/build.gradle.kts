plugins { alias(libs.plugins.rr.android.compose); alias(libs.plugins.roborazzi) }

dependencies {
    api(project(":core:strings"))
    api(platform(libs.compose.bom))
    api(libs.compose.foundation)
    api(libs.compose.ui)
    // Plumbing only (sheet drag, insets, ripple-free interaction). No Material visuals leak through.
    implementation(libs.compose.material3)
    implementation(libs.core.ktx)
    // BackHandler for sheets and dialogs that must confirm before closing.
    implementation(libs.activity.compose)
    testImplementation(project(":core:testing"))
    testImplementation(libs.robolectric)
    testImplementation(libs.roborazzi)
    testImplementation(libs.roborazzi.compose)
    testImplementation(libs.roborazzi.junit.rule)
}

// Goldens live beside the tests so `verifyRoborazziDebug` can gate regressions.
roborazzi { outputDir.set(file("src/test/screenshots")) }
