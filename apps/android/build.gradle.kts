plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.android.library) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.ksp) apply false
    alias(libs.plugins.roborazzi) apply false
}

val fidelityRun = gradle.startParameter.taskNames.any { it.substringAfterLast(':') == "fidelity" }
val fidelityOutput = layout.buildDirectory.dir("fidelity")
val cleanFidelity by tasks.registering(Delete::class) { delete(fidelityOutput) }
val fidelityTests = listOf("core:designsystem", "feature:auth", "feature:settings", "feature:today",
    "feature:documents", "feature:search", "feature:builder", "feature:share", "feature:assistant",
    "feature:letters", "feature:applications", "feature:workspace", "feature:career", "feature:public", "feature:system")

subprojects {
    tasks.withType<Test>().configureEach {
        systemProperty("rr.fidelity.dir", rootProject.layout.buildDirectory.dir("fidelity").get().asFile.absolutePath)
        if (fidelityRun) {
            dependsOn(cleanFidelity)
            systemProperty("rr.fidelity", "true")
            outputs.upToDateWhen { false }
        }
    }
}

tasks.register<Exec>("fidelity") {
    group = "verification"
    description = "Capture rendered screens and enforce unchanged storyboard layout and pixel tolerances."
    dependsOn(fidelityTests.map { ":$it:testDebugUnitTest" })
    val bundle = providers.environmentVariable("RR_HANDOFF_DIR")
        .orElse(rootDir.resolve("../../.agents/handoff/android-app").absolutePath)
    commandLine("python3", "${bundle.get()}/tools/fidelity.py", fidelityOutput.get().asFile.absolutePath,
        layout.buildDirectory.dir("fidelity-report").get().asFile.absolutePath)
    val captures = fidelityOutput.get().asFile
    val manifest = java.io.File(bundle.get(), "screens/manifest.json")
    doLast {
        // screen_diff can resize an image for diagnosis; acceptance requires the actual storyboard dimensions.
        val ids = Regex("\"id\"\\s*:\\s*\"([A-Z][0-9]+-[^\"]+)\"").findAll(manifest.readText())
            .map { it.groupValues[1] }.toSet()
        check(ids.size == 62) { "Expected 62 drawn screens, found ${ids.size}" }
        val frames = ids.flatMap { id -> listOf(java.io.File(captures, "$id-light.png"), java.io.File(captures, "$id-dark.png")) }
        frames.forEach { file ->
            check(file.isFile) { "Missing ${file.name}" }
            val frame = javax.imageio.ImageIO.read(file)
            check(frame.width == 780 && frame.height == 1688) { "${file.name}: expected 780×1688, found ${frame.width}×${frame.height}" }
        }
    }
}
