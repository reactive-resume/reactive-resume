plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

android {
    namespace = "me.rxresu"
    compileSdk = 37
    defaultConfig {
        applicationId = "me.rxresu"
        minSdk = 26
        targetSdk = 37
        versionCode = 1
        versionName = "1.0.0"
        // AppAuth's redirect receiver: the private-use scheme debug builds use against a local http server.
        manifestPlaceholders["appAuthRedirectScheme"] = "me.rxresu"
    }
    buildTypes {
        debug { applicationIdSuffix = ".debug" }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures { compose = true }
    testOptions { unitTests { isIncludeAndroidResources = true } }
}

dependencies {
    implementation(project(":core:designsystem"))
    implementation(project(":core:navigation"))
    implementation(project(":core:data"))
    implementation(project(":core:auth"))
    implementation(project(":core:page"))
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.foundation)
    implementation(libs.compose.ui)
    implementation(libs.activity.compose)
    implementation(libs.core.splashscreen)
    implementation(libs.lifecycle.runtime.compose)
    implementation(libs.navigation.compose)
    listOf("auth", "settings", "today", "documents", "search", "builder", "share", "assistant", "letters",
        "applications", "workspace", "career", "public", "system").forEach { implementation(project(":feature:$it")) }
    testImplementation(project(":core:testing"))
}
