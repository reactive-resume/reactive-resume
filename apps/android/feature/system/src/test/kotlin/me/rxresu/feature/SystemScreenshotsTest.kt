package me.rxresu.feature.system

import androidx.compose.runtime.CompositionLocalProvider
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import me.rxresu.core.data.*
import me.rxresu.core.navigation.WorkspaceTab
import me.rxresu.core.testing.*
import org.junit.Test
import androidx.glance.appwidget.runComposition
import androidx.compose.ui.unit.dp

@org.robolectric.annotation.Config(application = RepositoryTestApp::class)
@OptIn(androidx.glance.ExperimentalGlanceApi::class)
class SystemScreenshotsTest : RrScreenshotTest() {
    private fun content(dark: Boolean, fontScale: Float = 1f, rtl: Boolean = false) {
        android.os.SystemClock.setCurrentTimeMillis(System.currentTimeMillis())
        val qualifiers = org.robolectric.RuntimeEnvironment.getQualifiers()
        org.robolectric.RuntimeEnvironment.setQualifiers(if (dark) "+night" else "+notnight")
        org.robolectric.RuntimeEnvironment.setQualifiers(if (rtl) "+ldrtl" else "+ldltr")
        org.robolectric.RuntimeEnvironment.setFontScale(fontScale)
        val fakes = FakeRepositories()
        val snapshot = runBlocking { fakes.today.observe().first { !it.loading && it.data != null }.data!! }
        // X1 is its own typed scenario; the general fake's earlier Orbital interview remains unchanged.
        val today = snapshot.copy(needsYou = listOf(
            TodayItem("x1-briefing", StoryboardIds.lumen, "Lumen", "Technical", "2026-11-10T10:00:00Z", TodayKind.Briefing),
            TodayItem("x1-offer", "x1-parcel", "Parcel & Co.", "reply", "2026-11-13T10:00:00Z", TodayKind.Offer),
            TodayItem("x1-followup", StoryboardIds.fieldnote, "Fieldnote", "follow up", null, TodayKind.FollowUp),
        ), comingUp = emptyList())
        val todayRepository = object : TodayRepository by fakes.today {
            override fun observe(remindersEnabled: Boolean) = kotlinx.coroutines.flow.flowOf(Resource(data = today))
        }
        val repositories = RrRepositories(fakes.account, fakes.documents, fakes.resumes, fakes.letters,
            fakes.applications, fakes.checks, fakes.ai, fakes.assistant, fakes.workspace, fakes.career,
            fakes.search, fakes.publicResume, fakes.platform, fakes.preferences, todayRepository,
            fakes.drafts, fakes.pages, fakes.authSession, fakes.time)
        val briefing = SystemTarget("application", StoryboardIds.lumen, WorkspaceTab.Prepare)
        val followup = SystemTarget("application", StoryboardIds.fieldnote, WorkspaceTab.Messages)
        val specs = listOf(
            NotificationSpec("briefing", NotificationCategory.InterviewsAndBriefings, "Briefing ready for Lumen", "Technical interview Tue at 10:00. Your briefing and 4 likely questions are ready.", briefing, listOf(NotificationAction("Open briefing", briefing), NotificationAction("Practice", briefing.copy(tab = WorkspaceTab.Practise)))),
            NotificationSpec("followup", NotificationCategory.FollowUps, "Follow up with Fieldnote", "You applied 10 days ago. A short follow-up is usually fine now.", followup, listOf(NotificationAction("Draft follow-up", followup), NotificationAction("Log follow-up", followup, true))),
            NotificationSpec("roles", NotificationCategory.NewRoles, "4 new roles from your search", "Senior product designer at Kiln Studio and 3 more. Nothing is applied for until you choose.", SystemTarget("today")),
        )
        val context = androidx.test.core.app.ApplicationProvider.getApplicationContext<RepositoryTestApp>()
        context.repositories = repositories
        val proofActivity = org.robolectric.Robolectric.buildActivity(androidx.activity.ComponentActivity::class.java).setup()
        val nativeContext = android.view.ContextThemeWrapper(proofActivity.get(), if (dark) android.R.style.Theme_DeviceDefault else android.R.style.Theme_DeviceDefault_Light)
        createChannels(context)
        val notificationObjects = specs.map { buildNotification(nativeContext, it, "storyboard-alex") }
        val notifications = specs.zip(notificationObjects).map { (spec, notification) ->
            org.junit.Assert.assertEquals(spec.title, notification.extras.getString(android.app.Notification.EXTRA_TITLE))
            org.junit.Assert.assertEquals(spec.actions.map { it.label }, notification.actions.orEmpty().map { it.title.toString() })
            val builder = android.app.Notification.Builder.recoverBuilder(nativeContext, notification)
            val view = (builder.createBigContentView() ?: builder.createContentView()).apply(nativeContext, android.widget.FrameLayout(nativeContext))
            org.junit.Assert.assertTrue("Shipping notification title is bound to a native TextView", nativeTexts(view).contains(spec.title))
            org.junit.Assert.assertTrue("Expanded native notification includes full body", nativeTexts(view).contains(spec.body))
            // shortcut: app-owned 252 dp expanded preview, replace with SystemUI hosting for actual OS sizing.
            measureNative(view, 358, (252 * nativeContext.resources.displayMetrics.density).toInt())
            view
        }
        fun widget(widget: androidx.glance.appwidget.GlanceAppWidget, width: Int, height: Int): android.view.View = runBlocking {
            val host = android.appwidget.AppWidgetHostView(nativeContext).apply { setAppWidget(1, android.appwidget.AppWidgetProviderInfo()) }
            var view: android.view.View? = null
            widget.runComposition(context, sizes = listOf(androidx.compose.ui.unit.DpSize(width.dp, height.dp))).first { remote ->
                view = remote.apply(nativeContext, host)
                val words = nativeTexts(requireNotNull(view))
                words.isNotEmpty() && words.none { it.contains("Loading") }
            }
            host.addView(requireNotNull(view))
            val density = context.resources.displayMetrics.density
            host.measure(android.view.View.MeasureSpec.makeMeasureSpec((width * density).toInt(), android.view.View.MeasureSpec.EXACTLY), android.view.View.MeasureSpec.makeMeasureSpec((height * density).toInt(), android.view.View.MeasureSpec.EXACTLY))
            host.layout(0, 0, host.measuredWidth, host.measuredHeight)
            org.junit.Assert.assertTrue("Shipping Glance rows are bound to native TextViews", nativeTexts(host).any { it.contains("Lumen") })
            host
        }
        val todayWidget = widget(TodayWidget(), 358, 200)
        val nextWidget = widget(NextInterviewWidget(), 150, 150)
        installLauncherShortcuts(context)
        val entries = androidx.core.content.pm.ShortcutManagerCompat.getDynamicShortcuts(context).sortedBy { it.rank }
        org.junit.Assert.assertEquals(3, entries.size)
        val shortcuts = android.widget.LinearLayout(nativeContext).apply {
            orientation = android.widget.LinearLayout.VERTICAL
            entries.forEach { entry -> addView(android.widget.TextView(nativeContext).apply {
                text = entry.shortLabel
                textSize = me.rxresu.core.designsystem.RrType.ui.fontSize.value
                setCompoundDrawablesWithIntrinsicBounds(entry.icon?.loadDrawable(nativeContext), null, null, null)
                compoundDrawablePadding = (8 * resources.displayMetrics.density).toInt()
                minHeight = (44 * resources.displayMetrics.density).toInt()
                gravity = android.view.Gravity.CENTER_VERTICAL
                setOnClickListener { context.startActivity(entry.intent) }
            }) }
        }
        measureNative(shortcuts, 196)
        val name = "X1-Notify-${if (dark) "dark" else "light"}${if (fontScale != 1f) "-font200" else ""}${if (rtl) "-rtl" else ""}"
        try {
            writeNativeProof(name, nativeContext, specs, notificationObjects, notifications, todayWidget, nextWidget, shortcuts)
            captureScreen(if (rtl) "X1-Notify-rtl" else "X1-Notify", dark, safeArea = false, fontScale = fontScale, wrap = { c -> CompositionLocalProvider(LocalRepositories provides repositories) { c() } }) { SystemContent(notifications, todayWidget, nextWidget, shortcuts) }
        } finally { proofActivity.pause().stop().destroy(); fakes.close(); org.robolectric.RuntimeEnvironment.setQualifiers(qualifiers); org.robolectric.RuntimeEnvironment.setFontScale(1f) }
    }
    @Test fun light() = content(false)
    @Test fun dark() = content(true)
    @Test fun font200() = content(false, 2f)
    @Test fun rtl() = content(false, rtl = true)
}

private fun nativeTexts(view: android.view.View): List<String> = when (view) {
    is android.widget.TextView -> listOf(view.text.toString())
    is android.view.ViewGroup -> (0 until view.childCount).flatMap { nativeTexts(view.getChildAt(it)) }
    else -> emptyList()
}
