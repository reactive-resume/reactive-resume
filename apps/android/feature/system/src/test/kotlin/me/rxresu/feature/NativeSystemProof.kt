package me.rxresu.feature.system

import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.view.View
import android.view.ViewGroup
import android.widget.ListView
import android.widget.TextView
import androidx.core.content.pm.ShortcutManagerCompat
import java.io.File
import me.rxresu.core.testing.writeLayoutDump
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.robolectric.Shadows.shadowOf

internal fun measureNative(view: View, widthDp: Int, heightPx: Int? = null) {
    view.measure(View.MeasureSpec.makeMeasureSpec((widthDp * view.resources.displayMetrics.density).toInt(), View.MeasureSpec.EXACTLY),
        if (heightPx == null) View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED) else View.MeasureSpec.makeMeasureSpec(heightPx, View.MeasureSpec.EXACTLY))
    view.layout(0, 0, view.measuredWidth, view.measuredHeight)
}

/** Shipping platform objects and actually measured hosts, separate from storyboard pixel acceptance. */
internal fun writeNativeProof(name: String, context: Context, specs: List<NotificationSpec>, notifications: List<Notification>,
    notificationViews: List<View>, today: View, next: View, shortcuts: View) {
    val directory = File(System.getProperty("rr.fidelity.dir", "../../build/fidelity"), "native-system").apply { mkdirs() }
    fun intent(value: Intent) = JSONObject().put("action", value.action).put("component", value.component?.flattenToString())
        .put("data", value.dataString).put("extras", JSONObject().apply {
            value.extras?.keySet()?.sorted()?.forEach { key -> put(key, value.extras?.get(key)) }
        })
    fun pending(value: PendingIntent) = JSONObject().put("immutable", value.isImmutable).put("activity", value.isActivity)
        .put("broadcast", value.isBroadcast).put("intent", intent(shadowOf(value).savedIntent))
    fun views(root: View): List<View> = listOf(root) + if (root is ViewGroup) (0 until root.childCount).flatMap { views(root.getChildAt(it)) } else emptyList()
    fun host(id: String, root: View, minimumRows: Boolean = false): JSONObject {
        assertTrue("$id has real measured native bounds", root.measuredWidth > 0 && root.measuredHeight > 0)
        val density = root.resources.displayMetrics.density
        val screenshot = File(directory, "$name-$id.png")
        // Roborazzi remeasures standalone Views to activity width; draw the measured host without relayout.
        val bitmap = android.graphics.Bitmap.createBitmap(root.width, root.height, android.graphics.Bitmap.Config.ARGB_8888)
        root.draw(android.graphics.Canvas(bitmap))
        screenshot.outputStream().use { assertTrue(bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)) }
        bitmap.recycle()
        assertTrue("$id native screenshot was recorded", screenshot.isFile)
        root.writeLayoutDump(File(directory, "$name-$id.json"))
        val nodes = views(root)
        val rows = nodes.filterIsInstance<ListView>().flatMap { list ->
            (0 until list.adapter.count).map { index ->
                val row = list.adapter.getView(index, null, list)
                row.measure(View.MeasureSpec.makeMeasureSpec(list.width, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED))
                val height = row.measuredHeight / density
                if (minimumRows) assertTrue("$id row $index retains 44 dp target", height >= 44f)
                JSONObject().put("index", index).put("heightDp", height)
            }
        }
        return JSONObject().put("widthDp", root.measuredWidth / density).put("heightDp", root.measuredHeight / density)
            .put("rows", JSONArray(rows)).put("text", JSONArray(nodes.filterIsInstance<TextView>().filter { it.visibility == View.VISIBLE }.map { it.text.toString() }))
            .put("screenshot", "$name-$id.png").put("layout", "$name-$id.json")
    }
    val notificationProof = specs.indices.map { index ->
        val spec = specs[index]
        val notification = notifications[index]
        listOf(spec.title, spec.body).forEach { copy ->
            assertTrue("Native expanded host lays out $copy", views(notificationViews[index]).filterIsInstance<TextView>()
                .any { it.text.toString() == copy && it.height > 0 && (it.layout?.height ?: 0) > 0 })
        }
        assertEquals(Notification.VISIBILITY_PRIVATE, notification.visibility)
        assertEquals(spec.body, notification.extras.getString(Notification.EXTRA_BIG_TEXT))
        assertEquals(spec.title, notification.extras.getString(Notification.EXTRA_TITLE))
        assertEquals(spec.actions.map { it.label }, notification.actions.orEmpty().map { it.title.toString() })
        assertEquals(systemRouteFor(targetIntent(context, spec.target)), systemRouteFor(shadowOf(notification.contentIntent).savedIntent))
        val channel = context.getSystemService(NotificationManager::class.java).getNotificationChannel(notification.channelId)
        assertNotNull(channel)
        assertEquals(channelName(context, spec.category), channel.name.toString())
        val publicCopy = notification.publicVersion.extras
        assertEquals(context.getString(R.string.system_reactive_resume_e5b371), publicCopy.getString(Notification.EXTRA_TITLE))
        assertNull(publicCopy.getString(Notification.EXTRA_TEXT))
        assertNull(publicCopy.getString(Notification.EXTRA_BIG_TEXT))
        val actions = notification.actions.orEmpty().mapIndexed { actionIndex, action ->
            val expected = spec.actions[actionIndex]
            val sent = shadowOf(action.actionIntent).savedIntent
            assertTrue(action.actionIntent.isImmutable)
            if (expected.logFollowUp) {
                assertTrue(action.actionIntent.isBroadcast)
                assertEquals(LogFollowUpReceiver::class.java.name, sent.component?.className)
                assertEquals(expected.target.id, sent.getStringExtra("applicationId"))
                assertEquals("storyboard-alex", sent.getStringExtra("owner"))
            } else assertEquals(systemRouteFor(targetIntent(context, expected.target)), systemRouteFor(sent))
            JSONObject().put("label", action.title.toString()).put("pendingIntent", pending(action.actionIntent))
        }
        JSONObject().put("key", spec.key).put("title", notification.extras.getString(Notification.EXTRA_TITLE))
            .put("body", notification.extras.getString(Notification.EXTRA_BIG_TEXT)).put("private", notification.visibility == Notification.VISIBILITY_PRIVATE)
            .put("channel", JSONObject().put("id", channel.id).put("name", channel.name).put("importance", channel.importance))
            .put("contentIntent", pending(notification.contentIntent)).put("actions", JSONArray(actions))
            .put("publicTitle", publicCopy.getString(Notification.EXTRA_TITLE)).put("expandedRemoteViews", host("notification-${spec.key}", notificationViews[index]))
    }
    val entries = ShortcutManagerCompat.getDynamicShortcuts(context).sortedBy { it.rank }
    assertEquals(listOf("save-job", "new-resume", "search"), entries.map { it.id })
    assertEquals(listOf("Save a job", "New resume", "Search"), entries.map { it.shortLabel.toString() })
    entries.forEach { assertEquals(context.packageName, it.intent.component?.packageName) }
    val density = context.resources.displayMetrics.density
    assertEquals(358f, today.measuredWidth / density, 0f)
    assertEquals(200f, today.measuredHeight / density, 0f)
    assertEquals(150f, next.measuredWidth / density, 0f)
    assertEquals(150f, next.measuredHeight / density, 0f)
    val result = JSONObject().put("id", name).put("sdk", android.os.Build.VERSION.SDK_INT)
        .put("density", context.resources.displayMetrics.density).put("fontScale", context.resources.configuration.fontScale)
        .put("boundary", "Robolectric native object/RemoteViews proof. Standalone PNGs use View.draw at measured bounds; software snapshots do not prove hardware outline clipping. Expanded notification preview is explicitly app-owned at 358x252 dp, not measured SystemUI height. Official notification docs describe expanded custom layouts limited to as little as 252 dp on some versions. Notification.Builder template may differ from SystemUI on API 35+. Shortcut preview is an app-owned host, not launcher UI. Device SystemUI and launcher interaction unverified.")
        .put("notifications", JSONArray(notificationProof))
        .put("todayWidget", host("today-widget", today, minimumRows = true)).put("nextWidget", host("next-widget", next, minimumRows = true))
        .put("shortcutPreview", host("shortcut-preview", shortcuts))
        .put("installedShortcuts", JSONArray(entries.map { JSONObject().put("id", it.id).put("label", it.shortLabel).put("rank", it.rank).put("intent", intent(it.intent)) }))
    File(directory, "$name-proof.json").writeText(result.toString(2) + "\n")
}
