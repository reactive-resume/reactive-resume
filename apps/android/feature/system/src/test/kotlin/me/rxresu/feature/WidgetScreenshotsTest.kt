package me.rxresu.feature.system

import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.TextView
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.glance.ExperimentalGlanceApi
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.runComposition
import androidx.test.core.app.ApplicationProvider
import com.github.takahirom.roborazzi.captureRoboImage
import java.io.File
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import me.rxresu.core.auth.SessionState
import me.rxresu.core.data.*
import me.rxresu.core.testing.*
import org.junit.Assert.*
import org.junit.Test
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@OptIn(ExperimentalGlanceApi::class)
@Config(sdk = [36], qualifiers = RR_SCREEN_QUALIFIERS, application = RepositoryTestApp::class)
class WidgetScreenshotsTest : RrScreenshotTest() {
    private val context get() = ApplicationProvider.getApplicationContext<RepositoryTestApp>()

    private fun widget(widget: GlanceAppWidget, width: Int, height: Int, dark: Boolean, scale: Float = 1f, signedOut: Boolean = false, longNames: Boolean = false) {
        val qualifiers = RuntimeEnvironment.getQualifiers()
        RuntimeEnvironment.setQualifiers(if (dark) "+night" else "+notnight")
        RuntimeEnvironment.setFontScale(scale)
        val session = FakeAuthSession()
        val repositories = FakeRepositories(authSession = session)
        val snapshot = runBlocking { repositories.today.observe().first { !it.loading && it.data != null }.data!! }
        val today = if (!longNames) repositories.today else object : TodayRepository by repositories.today {
            override fun observe(remindersEnabled: Boolean) = kotlinx.coroutines.flow.flowOf(Resource(data = snapshot.copy(
                needsYou = snapshot.needsYou.map { it.copy(company = it.company + " International Research and Product Development", title = it.title + " with the research and design leadership team") },
                comingUp = snapshot.comingUp.map { it.copy(company = it.company + " International Research and Product Development", title = it.title + " with the research and design leadership team") },
            )))
        }
        context.repositories = RrRepositories(
            repositories.account, repositories.documents, repositories.resumes, repositories.letters,
            repositories.applications, repositories.checks, repositories.ai, repositories.assistant,
            repositories.workspace, repositories.career, repositories.search, repositories.publicResume,
            repositories.platform, repositories.preferences, today, repositories.drafts,
            repositories.pages, repositories.authSession, repositories.time,
        )
        if (signedOut) session.state.value = SessionState.SignedOut
        try {
            val activity = org.robolectric.Robolectric.buildActivity(androidx.activity.ComponentActivity::class.java).setup()
            val host = android.appwidget.AppWidgetHostView(activity.get()).apply {
                setAppWidget(1, android.appwidget.AppWidgetProviderInfo())
            }
            val view = runBlocking {
                var applied: View? = null
                widget.runComposition(context, sizes = listOf(DpSize(width.dp, height.dp))).first { remote ->
                    applied = remote.apply(activity.get(), host)
                    val text = texts(requireNotNull(applied))
                    if (signedOut) text.any { it.text.contains("Sign in") }
                    else text.none { it.text.contains("Loading") } && text.isNotEmpty()
                }
                requireNotNull(applied)
            }
            val density = context.resources.displayMetrics.density
            view.measure(View.MeasureSpec.makeMeasureSpec((width * density).toInt(), View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec((height * density).toInt(), View.MeasureSpec.EXACTLY))
            view.layout(0, 0, view.measuredWidth, view.measuredHeight)
            host.addView(view, FrameLayout.LayoutParams((width * density).toInt(), (height * density).toInt()))
            activity.get().setContentView(host)
            org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idleFor(java.time.Duration.ofMillis(300))
            val content = texts(view)
            assertTrue(content.isNotEmpty())
            if (!signedOut) {
                val lists = descendants(view).filterIsInstance<android.widget.ListView>()
                assertEquals(1, lists.size)
                val list = lists.single()
                assertTrue("Actual RemoteViews collection must contain its shipping rows", list.adapter.count > 0)
                assertTrue(content.any { it.text.contains(if (widget is TodayWidget) "Lumen" else "Orbital Health") })
                repeat(list.adapter.count) { i ->
                    val row = list.adapter.getView(i, null, list)
                    row.measure(View.MeasureSpec.makeMeasureSpec(list.width, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED))
                    assertTrue("Every widget row keeps a 44 dp target", row.measuredHeight >= (44 * density).toInt())
                }
            }
            val name = "X1-${if (widget is TodayWidget) "Today" else "Next"}-widget-${width}-${if (dark) "dark" else "light"}${if (scale == 2f) "-font200" else ""}${if (signedOut) "-signed-out" else ""}${if (longNames) "-long" else ""}"
            view.captureRoboImage(File(RR_SCREENSHOT_DIR, "$name.png"), RrRoborazziOptions)
            activity.pause().stop().destroy()
        } finally {
            repositories.close()
            RuntimeEnvironment.setQualifiers(qualifiers)
            RuntimeEnvironment.setFontScale(1f)
        }
    }

    @Test fun todayLight() = widget(TodayWidget(), 250, 200, false)
    @Test fun todayDark() = widget(TodayWidget(), 250, 200, true)
    @Test fun todayWideLight() = widget(TodayWidget(), 330, 200, false)
    @Test fun todayWideDark() = widget(TodayWidget(), 330, 200, true)
    @Test fun nextLight() = widget(NextInterviewWidget(), 150, 150, false)
    @Test fun nextDark() = widget(NextInterviewWidget(), 150, 150, true)
    @Test fun nextWideLight() = widget(NextInterviewWidget(), 250, 150, false)
    @Test fun nextWideDark() = widget(NextInterviewWidget(), 250, 150, true)
    @Test fun todayFont200() = widget(TodayWidget(), 250, 200, false, 2f)
    @Test fun nextFont200() = widget(NextInterviewWidget(), 150, 150, false, 2f)
    @Test fun todayFont200Dark() = widget(TodayWidget(), 250, 200, true, 2f)
    @Test fun nextFont200Dark() = widget(NextInterviewWidget(), 150, 150, true, 2f)
    @Test fun todayLongNames() = widget(TodayWidget(), 250, 200, false, 2f, longNames = true)
    @Test fun nextLongNames() = widget(NextInterviewWidget(), 150, 150, true, 2f, longNames = true)
    @Test fun nextSignedOutLight() = widget(NextInterviewWidget(), 150, 150, false, signedOut = true)
    @Test fun nextSignedOutDark() = widget(NextInterviewWidget(), 150, 150, true, signedOut = true)
    @Test fun signedOutLight() = widget(TodayWidget(), 250, 200, false, signedOut = true)
    @Test fun signedOutDark() = widget(TodayWidget(), 250, 200, true, signedOut = true)
}

private fun texts(view: View): List<TextView> = when (view) {
    is TextView -> listOf(view)
    is ViewGroup -> (0 until view.childCount).flatMap { texts(view.getChildAt(it)) }
    else -> emptyList()
}

private fun descendants(view: View): List<View> = listOf(view) + if (view is ViewGroup) (0 until view.childCount).flatMap { descendants(view.getChildAt(it)) } else emptyList()
