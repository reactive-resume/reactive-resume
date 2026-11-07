plugins { alias(libs.plugins.rr.android.feature) }

dependencies {
    implementation(libs.exifinterface)
    implementation(project(":core:page"))
    // System photo picker and camera for the Basics photo.
    implementation(libs.activity.compose)
    // Shows the resume photo from its URL.
    implementation(libs.coil.compose)
    implementation(libs.coil.network.okhttp)
}
