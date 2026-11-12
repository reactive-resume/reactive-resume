plugins { alias(libs.plugins.rr.android.feature) }

dependencies {
    implementation(libs.browser)
    implementation(libs.work.runtime)
    testImplementation(libs.work.testing)
}
