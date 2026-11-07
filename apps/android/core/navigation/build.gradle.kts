plugins { alias(libs.plugins.rr.android.compose); alias(libs.plugins.kotlin.serialization) }

dependencies {
    api(libs.navigation.compose)
    api(libs.serialization.json)
    implementation(project(":core:designsystem"))
}
