plugins { alias(libs.plugins.rr.android.feature) }

dependencies {
    implementation(libs.activity.compose)
    implementation(libs.browser)
    // Navigation tests exercise overview pushes and legacy-link forwarding. Main code stays independent.
    testImplementation(project(":feature:applications"))
}
