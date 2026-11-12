plugins { alias(libs.plugins.rr.android.compose); alias(libs.plugins.kotlin.serialization) }

android { defaultConfig { consumerProguardFiles("consumer-rules.pro") } }

dependencies {
    api(libs.navigation.compose)
    api(libs.serialization.json)
    implementation(project(":core:designsystem"))
}
