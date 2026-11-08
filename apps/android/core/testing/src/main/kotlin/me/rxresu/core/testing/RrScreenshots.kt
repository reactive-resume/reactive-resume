package me.rxresu.core.testing

import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.v2.runAndroidComposeUiTest
import androidx.compose.ui.platform.LocalInspectionMode
import org.robolectric.RuntimeEnvironment
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import com.github.takahirom.roborazzi.ExperimentalRoborazziApi
import com.github.takahirom.roborazzi.RoborazziOptions
import com.github.takahirom.roborazzi.captureRoboImage
import me.rxresu.core.designsystem.RrTheme
import me.rxresu.core.designsystem.LocalRrInsets
import me.rxresu.core.designsystem.StoryboardInsets
import me.rxresu.core.designsystem.RrInsets
import me.rxresu.core.designsystem.LocalRrDesignTags
import com.github.takahirom.roborazzi.RoborazziTaskType
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File

/**
 * Phone screen at the storyboard size: 390×844 dp at 2x, captures 780×1688 px like `screens/<ID>-<theme>.png`.
 * Locale English (Portugal): the default (US) catalog with day-month dates, like the storyboard's Lisbon sample data,
 * and the same on every machine whatever the host locale.
 */
const val RR_SCREEN_QUALIFIERS = "en-rPT-w390dp-h844dp-xhdpi"

/** [RR_SCREEN_QUALIFIERS] in night mode, for test classes that pin the theme with `@Config`. */
const val RR_SCREEN_QUALIFIERS_NIGHT = "en-rPT-w390dp-h844dp-xhdpi-night"

/** The storyboard's safe areas: 47 dp status bar and 34 dp gesture bar. */
val RR_STORYBOARD_TOP_INSET: Dp = 47.dp
val RR_STORYBOARD_BOTTOM_INSET: Dp = 34.dp

/** Where goldens live, relative to the module directory (Gradle runs unit tests from there). */
const val RR_SCREENSHOT_DIR = "src/test/screenshots"

/**
 * Base class for screenshot tests: Robolectric on SDK 36, native graphics (real text and shadows), storyboard screen
 * size. Each test picks light or dark itself through [captureScreen]'s `dark` flag.
 *
 * ```
 * class TodayScreenshotTest : RrScreenshotTest() {
 *     @Test fun light() = captureScreen("T1-Today", dark = false) { TodayScreen(...) }
 *     @Test fun dark() = captureScreen("T1-Today", dark = true) { TodayScreen(...) }
 * }
 * ```
 *
 * Record goldens with `./gradlew :<module>:recordRoborazziDebug`, gate with `verifyRoborazziDebug`.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [36], qualifiers = RR_SCREEN_QUALIFIERS)
abstract class RrScreenshotTest

/** Default Roborazzi options: exact goldens, small tolerance for anti-aliasing drift between machines. */
@OptIn(ExperimentalRoborazziApi::class)
val RrRoborazziOptions = RoborazziOptions(
    compareOptions = RoborazziOptions.CompareOptions(changeThreshold = 0.001f),
)

/**
 * Captures one storyboard screen to `src/test/screenshots/<id>-light.png` (or `-dark.png`) and, when the handoff
 * folder is on this machine, writes a storyboard diff to `build/reports/storyboard-diff/`.
 *
 * @param id the storyboard id and title, e.g. "T1-Today" (matches `screens/T1-Today-light.png`).
 * @param dark dark theme and night configuration.
 * @param wrap wraps the content inside [RrTheme]: inject providers here (fake repositories, view-model factories).
 * @param safeArea report the storyboard's 47 dp status bar and 34 dp gesture bar as system bar insets, so edge-to-edge
 *   screens lay out as drawn.
 * @param fontScale e.g. 2f for a 200% font scale check (saved with a `-font200` suffix, no diff).
 */
fun captureScreen(
    id: String,
    dark: Boolean,
    wrap: @Composable (@Composable () -> Unit) -> Unit = { it() },
    safeArea: Boolean = true,
    fontScale: Float = 1f,
    content: @Composable () -> Unit,
) {
    val name = "$id-${if (dark) "dark" else "light"}" + if (fontScale != 1f) "-font${(fontScale * 100).toInt()}" else ""
    val file = File(RR_SCREENSHOT_DIR, "$name.png")
    val fidelity = if (id.matches(Regex("[A-Z][0-9]+-.+"))) {
        File(System.getProperty("rr.fidelity.dir", "../../build/fidelity"), "$name.png")
    } else null // Synthetic harness-only captures (for example empty inset frames) have no storyboard elements.
    capture(file, dark, fontScale, wrapHeight = false, safeArea = safeArea, fidelityFile = fidelity, captureEnd = fontScale == 1f) {
        RrTheme(darkTheme = dark) {
            wrap { Box(Modifier.fillMaxSize().background(RrTheme.colors.bg)) { content() } }
        }
    }
    if (fontScale == 1f) StoryboardDiff.report(file, "screens/$name.png", name)
}

/**
 * Captures a component (or any composable) at its own height and the full screen width to
 * `src/test/screenshots/components/<name>-<theme>.png`. No storyboard diff.
 */
fun captureComponent(
    name: String,
    dark: Boolean,
    wrap: @Composable (@Composable () -> Unit) -> Unit = { it() },
    content: @Composable () -> Unit,
) {
    val file = File(RR_SCREENSHOT_DIR, "components/$name-${if (dark) "dark" else "light"}.png")
    capture(file, dark, 1f, wrapHeight = true, safeArea = false) {
        RrTheme(darkTheme = dark) {
            wrap { Box(Modifier.fillMaxWidth().background(RrTheme.colors.bg)) { content() } }
        }
    }
}

/**
 * Captures [content] as is (no theme, no insets) to `src/test/screenshots/<name>.png` and diffs it against
 * `<handoff>/<reference>` when given, e.g. a whole board: `captureBoard("Kit", "boards/Kit.png") { KitBoard() }`.
 * Size the test with `@Config(qualifiers = "w2240dp-h1400dp-mdpi")` to match the board's pixels.
 */
@OptIn(ExperimentalRoborazziApi::class)
fun captureBoard(name: String, reference: String?, exportScale: Double = 1.0, content: @Composable () -> Unit) {
    val file = File(RR_SCREENSHOT_DIR, "$name.png")
    val actual = File(System.getProperty("rr.fidelity.dir", "../../build/fidelity"), "$name.png")
    val options = RrRoborazziOptions.copy(recordOptions = RrRoborazziOptions.recordOptions.copy(resizeScale = exportScale))
    capture(file, dark = false, fontScale = 1f, wrapHeight = false, safeArea = false, fidelityFile = actual, options = options, content = content)
    if (reference != null) StoryboardDiff.report(file, reference, name)
}

/**
 * Owns the Compose clock and recomposer through both captures and scrolling, then disposes them. Inspection mode
 * holds endless animations still; Compose idling drives actual animation frames and Android layout/draw work.
 */
@OptIn(ExperimentalRoborazziApi::class, ExperimentalTestApi::class)
internal fun capture(file: File, dark: Boolean, fontScale: Float, wrapHeight: Boolean, safeArea: Boolean, fidelityFile: File? = null, captureEnd: Boolean = false, options: RoborazziOptions = RrRoborazziOptions, content: @Composable () -> Unit) {
    val qualifiers = RuntimeEnvironment.getQualifiers()
    val scale = RuntimeEnvironment.getFontScale()
    RuntimeEnvironment.setQualifiers(if (dark) "+night" else "+notnight")
    RuntimeEnvironment.setFontScale(fontScale)
    try {
        fidelityFile?.let { actual ->
            // Targeted reruns must not inherit an end frame from a screen whose content now fits.
            listOf(actual, File(actual.parentFile, "${actual.nameWithoutExtension}.json"),
                File(actual.parentFile, "${actual.nameWithoutExtension}-end.png"),
                File(actual.parentFile, "${actual.nameWithoutExtension}-end.json")).forEach {
                check(!it.exists() || it.delete()) { "Could not remove stale capture $it" }
            }
        }
        runAndroidComposeUiTest<ComponentActivity> {
            val host = checkNotNull(activity)
            runOnUiThread { WindowCompat.setDecorFitsSystemWindows(host.window, false) }
            setContent {
                CompositionLocalProvider(
                    LocalInspectionMode provides true,
                    LocalRrDesignTags provides true,
                    LocalRrInsets provides if (safeArea) StoryboardInsets else RrInsets(0.dp, 0.dp),
                    content = content,
                )
            }
            runOnUiThread {
                if (wrapHeight) composeView(host).layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
            }
            waitForIdle()
            if (safeArea) {
                runOnUiThread {
                    val density = host.resources.displayMetrics.density
                    val insets = WindowInsetsCompat.Builder()
                        .setInsets(WindowInsetsCompat.Type.statusBars(), Insets.of(0, (RR_STORYBOARD_TOP_INSET.value * density).toInt(), 0, 0))
                        .setInsets(WindowInsetsCompat.Type.navigationBars(), Insets.of(0, 0, 0, (RR_STORYBOARD_BOTTOM_INSET.value * density).toInt()))
                        .build()
                    ViewCompat.dispatchApplyWindowInsets(composeView(host), insets)
                }
                waitForIdle()
            }
            runOnUiThread {
                val view = composeView(host)
                fidelityFile?.let { actual ->
                    actual.parentFile?.mkdirs()
                    view.captureRoboImage(actual, options.copy(taskType = RoborazziTaskType.Record))
                    view.writeLayoutDump(File(actual.parentFile, "${actual.nameWithoutExtension}.json"))
                }
                if (!java.lang.Boolean.getBoolean("rr.fidelity")) view.captureRoboImage(file, options)
                if (fidelityFile != null && captureEnd) {
                    val scroll = view.scrollStoryboardToEnd { waitForIdle() }
                    if (scroll.scrollable) {
                        val end = File(fidelityFile.parentFile, "${fidelityFile.nameWithoutExtension}-end.png")
                        view.captureRoboImage(end, options.copy(taskType = RoborazziTaskType.Record))
                        view.writeLayoutDump(File(end.parentFile, "${end.nameWithoutExtension}.json"))
                    }
                }
            }
        }
    } finally {
        RuntimeEnvironment.setQualifiers(qualifiers)
        RuntimeEnvironment.setFontScale(scale)
    }
}

private fun composeView(activity: ComponentActivity): View = activity.findViewById<ViewGroup>(android.R.id.content).getChildAt(0)
