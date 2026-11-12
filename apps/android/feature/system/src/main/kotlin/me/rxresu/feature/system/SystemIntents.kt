package me.rxresu.feature.system

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.content.IntentCompat
import me.rxresu.core.navigation.*

internal const val ACTION_SAVE_JOB = "me.rxresu.action.SAVE_JOB"
internal const val ACTION_NEW_RESUME = "me.rxresu.action.NEW_RESUME"
internal const val ACTION_SEARCH = "me.rxresu.action.SEARCH"
internal const val ACTION_ROUTE = "me.rxresu.action.ROUTE"
internal const val EXTRA_TARGET = "me.rxresu.extra.TARGET"
internal const val EXTRA_ID = "me.rxresu.extra.ID"
internal const val EXTRA_TAB = "me.rxresu.extra.TAB"

/** Pure routing only. The shell calls [prepareSystemIntent] before consuming a PDF route. */
fun systemRouteFor(intent: Intent): Any? = when (intent.action) {
    ACTION_SAVE_JOB -> SaveJob()
    ACTION_NEW_RESUME -> NewDocument()
    ACTION_SEARCH -> Search()
    ACTION_ROUTE -> when (intent.getStringExtra(EXTRA_TARGET)) {
        "today" -> TodayTab
        "offers" -> Offers
        "application" -> intent.getStringExtra(EXTRA_ID)?.takeIf(String::isNotBlank)?.let { id ->
            val tab = WorkspaceTab.entries.firstOrNull { it.name == intent.getStringExtra(EXTRA_TAB) } ?: WorkspaceTab.Overview
            Application(id, tab)
        }
        "visitors" -> intent.getStringExtra(EXTRA_ID)?.takeIf(String::isNotBlank)?.let(::Visitors)
        else -> null
    }
    Intent.ACTION_SEND -> when (intent.type?.substringBefore(';')?.trim()?.lowercase()) {
        "text/plain" -> intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()?.let(::firstUrlIn)?.let(::SaveJob)
        "application/pdf" -> sharedPdfUri(intent)?.let { uri ->
            when (intent.component?.className?.substringAfterLast('.')) {
                "ImportResume" -> Import(uri.toString())
                "CheckPdf" -> AtsChecker(uri.toString())
                else -> null
            }
        }
        else -> null
    }
    Intent.ACTION_VIEW -> intent.data?.toString()?.let { runCatching { routeForLink(it) }.getOrNull() }
    else -> null
}

internal fun sharedPdfUri(intent: Intent): Uri? = (IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java)
    ?: intent.clipData?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.uri)?.takeIf { it.scheme == "content" }

/** ACTION_SEND grants are usually transient. Keep persistable grants when the source offers them; never escalate. */
fun retainSharedReadPermission(context: Context, intent: Intent) {
    if (intent.action != Intent.ACTION_SEND || intent.type != "application/pdf") return
    val uri = sharedPdfUri(intent) ?: return
    if (intent.flags and Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION != 0 && intent.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION != 0) {
        try { context.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION) } catch (_: SecurityException) { /* Source only grants access while this task lives. */ }
    }
}

internal data class SystemTarget(val kind: String, val id: String? = null, val tab: WorkspaceTab? = null)
internal fun targetIntent(context: Context, target: SystemTarget): Intent = Intent(ACTION_ROUTE)
    .setComponent(ComponentName(context.packageName, "me.rxresu.MainActivity"))
    .setData(Uri.Builder().scheme("rxresu-system").authority(target.kind).appendPath(target.id.orEmpty()).appendQueryParameter("tab", target.tab?.name).build())
    .putExtra(EXTRA_TARGET, target.kind).putExtra(EXTRA_ID, target.id).putExtra(EXTRA_TAB, target.tab?.name)
    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)

/** Shell calls before routing shared PDFs. Copy transient grants so import/check can survive task recreation. */
suspend fun prepareSystemIntent(context: Context, intent: Intent): Intent = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
    if (intent.action != Intent.ACTION_SEND || intent.type?.substringBefore(';')?.trim() != "application/pdf") return@withContext intent
    val source = sharedPdfUri(intent) ?: return@withContext intent
    retainSharedReadPermission(context, intent)
    if (context.contentResolver.persistedUriPermissions.any { it.uri == source && it.isReadPermission }) return@withContext intent
    val directory = java.io.File(context.cacheDir, "shared-pdfs").apply { mkdirs() }
    // shortcut: transient shares live in private cache for at most seven days; durable document storage belongs to import.
    directory.listFiles().orEmpty().filter { System.currentTimeMillis() - it.lastModified() > java.util.concurrent.TimeUnit.DAYS.toMillis(7) }.forEach { it.delete() }
    val file = java.io.File.createTempFile("shared-", ".pdf", directory)
    try {
        requireNotNull(context.contentResolver.openInputStream(source)).use { input -> file.outputStream().use { output ->
            val buffer = ByteArray(16 * 1024); var bytes = 0L
            while (true) {
                val count = input.read(buffer); if (count < 0) break
                bytes += count; require(bytes <= 25_000_000) { "PDF exceeds 25 MB" }; output.write(buffer, 0, count)
            }
            output.fd.sync()
        } }
        val uri = androidx.core.content.FileProvider.getUriForFile(context, context.packageName + ".shared-pdfs", file)
        Intent(intent).apply {
            putExtra(Intent.EXTRA_STREAM, uri)
            clipData = android.content.ClipData.newRawUri("PDF", uri)
            flags = (flags and Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION.inv() and Intent.FLAG_GRANT_WRITE_URI_PERMISSION.inv()) or Intent.FLAG_GRANT_READ_URI_PERMISSION
        }
    } catch (e: Exception) { file.delete(); throw e }
}

class SharedPdfProvider : androidx.core.content.FileProvider()
