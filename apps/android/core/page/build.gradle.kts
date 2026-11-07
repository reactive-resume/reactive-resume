plugins { alias(libs.plugins.rr.android.library) }

dependencies {
    api(project(":core:network"))
    testImplementation(libs.okhttp.mockwebserver)
    testImplementation(libs.robolectric)
}
