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
        // CI passes the Play version code (shared with the Expo app's counter); local builds use 1.
        versionCode = providers.gradleProperty("rr.versionCode").orNull?.toInt() ?: 1
        versionName = "2.0.0"
        // AppAuth's redirect receiver: the private-use scheme debug builds use against a local http server.
        manifestPlaceholders["appAuthRedirectScheme"] = "me.rxresu"
    }
    signingConfigs {
        // Not secret: a fixed key so each CI preview APK installs over the last one.
        create("preview") {
            storeFile = file("preview.jks")
            storePassword = "android"
            keyAlias = "preview"
            keyPassword = "android"
        }
    }
    buildTypes {
        debug { applicationIdSuffix = ".debug" }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
        // The release build (minified) under its own package, so it installs beside the Play app for testing.
        create("preview") {
            initWith(getByName("release"))
            applicationIdSuffix = ".preview"
            signingConfig = signingConfigs.getByName("preview")
            matchingFallbacks += "release"
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures { compose = true }
    // Every language ships in the base APK so the in-app language picker works on API 26–32 after a Play install.
    bundle { language { enableSplit = false } }
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
    implementation(libs.work.runtime)
    listOf("auth", "settings", "today", "documents", "search", "builder", "share", "assistant", "letters",
        "applications", "workspace", "career", "public", "system").forEach { implementation(project(":feature:$it")) }
    testImplementation(project(":core:testing"))
}
