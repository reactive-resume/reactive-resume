plugins { alias(libs.plugins.rr.android.feature) }

dependencies {
    implementation(project(":core:page"))
}

val localImportAssets = layout.buildDirectory.dir("generated/localImportAssets")
val repositoryRoot = rootProject.layout.projectDirectory.dir("../..")
val generateLocalImportAssets by tasks.registering(Exec::class) {
    inputs.dir(repositoryRoot.dir("tooling/android/local-import"))
    for (name in listOf("import", "resume", "schema", "utils", "pdf")) inputs.dir(repositoryRoot.dir("packages/$name/src"))
    inputs.file(repositoryRoot.file("pnpm-lock.yaml"))
    outputs.dir(localImportAssets)
    workingDir(repositoryRoot)
    commandLine("node", repositoryRoot.file("tooling/android/local-import/build.mjs").asFile, localImportAssets.get().dir("local-import").asFile)
}
android.sourceSets["main"].assets.srcDir(localImportAssets.get().asFile)
tasks.named("preBuild").configure { dependsOn(generateLocalImportAssets) }
