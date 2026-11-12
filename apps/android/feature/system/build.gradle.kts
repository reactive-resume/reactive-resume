plugins { alias(libs.plugins.rr.android.feature) }

dependencies {
    implementation(libs.work.runtime)
    implementation(libs.glance.appwidget)
    implementation(libs.activity.compose)
    implementation(libs.core.ktx)
    testImplementation(libs.work.testing)
}
