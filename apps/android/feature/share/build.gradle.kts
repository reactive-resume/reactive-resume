plugins { alias(libs.plugins.rr.android.feature) }
dependencies {
    implementation(project(":core:page"))
    implementation(libs.activity.compose)
    implementation(libs.core.ktx)
    implementation(libs.browser)
    implementation("com.google.zxing:core:3.5.4")
}
