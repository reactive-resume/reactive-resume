plugins { alias(libs.plugins.rr.android.feature) }

dependencies {
    implementation(project(":core:auth"))
    implementation(libs.browser)
    implementation(libs.credentials)
}
