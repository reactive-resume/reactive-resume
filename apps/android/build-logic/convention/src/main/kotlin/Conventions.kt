import com.android.build.api.dsl.LibraryExtension
import io.github.takahirom.roborazzi.RoborazziExtension
import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.api.artifacts.VersionCatalog
import org.gradle.api.artifacts.VersionCatalogsExtension
import org.gradle.api.JavaVersion
import org.gradle.kotlin.dsl.configure
import org.gradle.kotlin.dsl.dependencies
import org.gradle.kotlin.dsl.getByType

internal val Project.libs: VersionCatalog get() = extensions.getByType<VersionCatalogsExtension>().named("libs")
internal fun Project.lib(alias: String) = libs.findLibrary(alias).get()

const val COMPILE_SDK = 37
const val MIN_SDK = 26

/** Android library with the shared SDK levels; namespace follows the module path (`:core:page` → `me.rxresu.core.page`). */
class LibraryConventionPlugin : Plugin<Project> {
    override fun apply(target: Project) = with(target) {
        pluginManager.apply("com.android.library")
        extensions.configure<LibraryExtension> {
            // `:feature:public` → `me.rxresu.feature.publiclink` (`public` is a Java keyword).
            namespace = "me.rxresu." + path.removePrefix(":").replace(':', '.').replace("-", "")
                .replace(Regex("\\.public$"), ".publiclink")
            compileSdk = COMPILE_SDK
            defaultConfig {
                minSdk = MIN_SDK
                // AppAuth's manifest needs this wherever it is merged, including library unit-test manifests.
                manifestPlaceholders["appAuthRedirectScheme"] = "me.rxresu"
            }
            compileOptions {
                sourceCompatibility = JavaVersion.VERSION_17
                targetCompatibility = JavaVersion.VERSION_17
            }
            testOptions {
                unitTests {
                    isIncludeAndroidResources = true
                    all {
                        // Robolectric on SDK 36 reaches into FileDescriptor internals, closed by default on JDK 17+.
                        it.jvmArgs("--add-opens=java.base/java.io=ALL-UNNAMED", "--add-exports=java.base/jdk.internal.access=ALL-UNNAMED")
                        it.maxHeapSize = "2g"
                    }
                }
            }
            lint { warningsAsErrors = false; abortOnError = true; checkDependencies = false }
        }
        dependencies {
            add("implementation", lib("coroutines-core"))
            add("testImplementation", lib("junit"))
            add("testImplementation", lib("coroutines-test"))
        }
    }
}

/** Compose on top of a library module. Material 3 is not added here: only the design system uses it, as plumbing. */
class ComposeConventionPlugin : Plugin<Project> {
    override fun apply(target: Project) = with(target) {
        pluginManager.apply("rr.android.library")
        pluginManager.apply("org.jetbrains.kotlin.plugin.compose")
        extensions.configure<LibraryExtension> { buildFeatures { compose = true } }
        dependencies {
            val bom = platform(lib("compose-bom"))
            add("implementation", bom)
            add("testImplementation", bom)
            add("implementation", lib("compose-foundation"))
            add("implementation", lib("compose-ui"))
            add("implementation", lib("compose-ui-tooling-preview"))
            add("debugImplementation", lib("compose-ui-tooling"))
            add("testImplementation", lib("compose-ui-test-junit4"))
            add("debugImplementation", lib("compose-ui-test-manifest"))
        }
    }
}

/** A `:feature:*` module: Compose, serialization, the core contracts, Robolectric + Roborazzi screenshot tests. */
class FeatureConventionPlugin : Plugin<Project> {
    override fun apply(target: Project) = with(target) {
        pluginManager.apply("rr.android.compose")
        pluginManager.apply("org.jetbrains.kotlin.plugin.serialization")
        pluginManager.apply("io.github.takahirom.roborazzi")
        // Goldens live beside the tests so `verifyRoborazziDebug` gates regressions.
        extensions.configure<RoborazziExtension> { outputDir.set(file("src/test/screenshots")) }
        dependencies {
            add("implementation", project(":core:designsystem"))
            add("implementation", project(":core:navigation"))
            add("implementation", project(":core:data"))
            add("implementation", project(":core:strings"))
            add("implementation", lib("serialization-json"))
            add("implementation", lib("lifecycle-runtime-compose"))
            add("implementation", lib("lifecycle-viewmodel-compose"))
            add("implementation", lib("navigation-compose"))
            add("testImplementation", project(":core:testing"))
            add("testImplementation", lib("robolectric"))
            add("testImplementation", lib("roborazzi"))
            add("testImplementation", lib("roborazzi-compose"))
            add("testImplementation", lib("roborazzi-junit-rule"))
            add("testImplementation", lib("turbine"))
        }
    }
}
