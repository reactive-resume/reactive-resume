// Roborazzi harness shared by every module's screenshot tests.
plugins { alias(libs.plugins.rr.android.compose) }

dependencies {
    api(project(":core:designsystem"))
    api(project(":core:data"))
    api(libs.junit)
    api(libs.robolectric)
    api(libs.roborazzi)
    api(libs.roborazzi.compose)
    api(libs.roborazzi.junit.rule)
    api(platform(libs.compose.bom))
    api(libs.compose.ui.test.junit4)
    api(libs.coroutines.test)
    implementation(libs.compose.ui.test.manifest)
}
