plugins { alias(libs.plugins.rr.android.compose); alias(libs.plugins.kotlin.serialization) }

dependencies {
    api(project(":core:network"))
    api(project(":core:auth"))
    api(project(":core:page"))
    api(project(":core:database"))
    implementation(libs.datastore.preferences)
    api(libs.work.runtime)
    testImplementation(libs.okhttp.mockwebserver)
    testImplementation(libs.robolectric)
    testImplementation(libs.turbine)
}

extensions.configure<com.android.build.api.dsl.LibraryExtension> {
    defaultConfig.manifestPlaceholders["appAuthRedirectScheme"] = "me.rxresu"
}
