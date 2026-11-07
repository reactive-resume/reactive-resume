pluginManagement {
    includeBuild("build-logic")
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode = RepositoriesMode.FAIL_ON_PROJECT_REPOS
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "reactive-resume-android"

include(":app")
include(
    ":core:designsystem",
    ":core:strings",
    ":core:navigation",
    ":core:network",
    ":core:auth",
    ":core:data",
    ":core:database",
    ":core:page",
    ":core:testing",
)
include(
    ":feature:auth",
    ":feature:settings",
    ":feature:today",
    ":feature:documents",
    ":feature:search",
    ":feature:builder",
    ":feature:share",
    ":feature:assistant",
    ":feature:letters",
    ":feature:applications",
    ":feature:workspace",
    ":feature:career",
    ":feature:public",
    ":feature:system",
)
