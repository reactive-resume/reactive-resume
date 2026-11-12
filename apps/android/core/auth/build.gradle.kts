plugins { alias(libs.plugins.rr.android.library); alias(libs.plugins.kotlin.serialization) }

dependencies {
    api(project(":core:network"))
    implementation(libs.appauth)
    implementation(libs.browser)
    implementation(libs.datastore.preferences)
    testImplementation(libs.okhttp.mockwebserver)
    testImplementation(libs.robolectric)
}
