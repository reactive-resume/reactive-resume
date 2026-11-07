plugins { alias(libs.plugins.rr.android.library); alias(libs.plugins.kotlin.serialization) }

dependencies {
    api(libs.okhttp)
    api(libs.okhttp.sse)
    api(libs.serialization.json)
    testImplementation(libs.okhttp.mockwebserver)
}
