plugins { alias(libs.plugins.rr.android.compose); alias(libs.plugins.kotlin.serialization) }

dependencies {
    api(project(":core:network"))
    api(project(":core:auth"))
    api(project(":core:page"))
    implementation(project(":core:database"))
    implementation(libs.datastore.preferences)
    implementation(libs.work.runtime)
    testImplementation(libs.okhttp.mockwebserver)
    testImplementation(libs.robolectric)
    testImplementation(libs.turbine)
}
