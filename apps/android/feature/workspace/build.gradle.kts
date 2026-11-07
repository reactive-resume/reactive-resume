plugins { alias(libs.plugins.rr.android.feature) }

dependencies {
    implementation(libs.activity.compose)
    implementation(libs.browser)
    // Screenshots draw the tabs inside the Application screen (J6 frame), as the app does. Main code stays independent.
    testImplementation(project(":feature:applications"))
}
