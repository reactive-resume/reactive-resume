plugins { alias(libs.plugins.rr.android.feature) }

// Device reminders share the native notification and cleanup owners.
dependencies {
    implementation(project(":feature:system"))
    testImplementation(libs.work.testing)
}
