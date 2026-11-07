plugins { alias(libs.plugins.rr.android.library); alias(libs.plugins.ksp) }

dependencies {
    api(libs.room.runtime)
    implementation(libs.room.ktx)
    ksp(libs.room.compiler)
    testImplementation(libs.room.testing)
    testImplementation(libs.robolectric)
}
