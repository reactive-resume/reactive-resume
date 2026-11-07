plugins { alias(libs.plugins.rr.android.feature) }

dependencies {
    implementation(project(":core:page"))
    implementation(libs.browser)
    implementation(libs.activity.compose)
    implementation(libs.core.ktx)
}
