plugins { `kotlin-dsl` }

dependencies {
    compileOnly(libs.android.gradle.plugin)
    compileOnly(libs.kotlin.gradle.plugin)
    compileOnly(libs.compose.gradle.plugin)
    compileOnly(libs.serialization.gradle.plugin)
    compileOnly(libs.roborazzi.gradle.plugin)
}

gradlePlugin {
    plugins {
        register("apiClient") { id = "rr.android.api-client"; implementationClass = "ApiClientConventionPlugin" }
        register("library") { id = "rr.android.library"; implementationClass = "LibraryConventionPlugin" }
        register("compose") { id = "rr.android.compose"; implementationClass = "ComposeConventionPlugin" }
        register("feature") { id = "rr.android.feature"; implementationClass = "FeatureConventionPlugin" }
    }
}
