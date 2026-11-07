// Pieces every workspace tab shares: loading the job's context, the scrolling body with its pinned footer, section
// eyebrows, AI disclosure lines, working labels, dates and small platform helpers (copy, browser, tab switching).
package me.rxresu.feature.workspace

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.icu.text.ListFormatter
import android.text.format.DateFormat
import androidx.annotation.DrawableRes
import androidx.browser.customtabs.CustomTabColorSchemeParams
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.MutableTransitionState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.slideInVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.net.toUri
import androidx.navigation.NavController
import java.io.IOException
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import me.rxresu.core.data.RrRepositories
import me.rxresu.core.designsystem.LocalReducedMotion
import me.rxresu.core.designsystem.R as DsR
import me.rxresu.core.designsystem.RrBottomSheet
import me.rxresu.core.designsystem.RrButton
import me.rxresu.core.designsystem.RrButtonSize
import me.rxresu.core.designsystem.RrButtonVariant
import me.rxresu.core.designsystem.RrCallout
import me.rxresu.core.designsystem.RrColors
import me.rxresu.core.designsystem.RrIcon
import me.rxresu.core.designsystem.RrListGroup
import me.rxresu.core.designsystem.RrMotion
import me.rxresu.core.designsystem.RrOfflineStrip
import me.rxresu.core.designsystem.RrSectionHeader
import me.rxresu.core.designsystem.RrSheetDetents
import me.rxresu.core.designsystem.RrSkeleton
import me.rxresu.core.designsystem.RrSkeletonText
import me.rxresu.core.designsystem.RrText
import me.rxresu.core.designsystem.RrTheme
import me.rxresu.core.designsystem.RrTone
import me.rxresu.core.designsystem.RrType
import me.rxresu.core.designsystem.RrWorkingLabel
import me.rxresu.core.navigation.Application as ApplicationRoute
import me.rxresu.core.navigation.WorkspaceTab
import me.rxresu.core.network.generated.AddApplicationInterviewRequestKind
import me.rxresu.core.network.generated.Application
import me.rxresu.core.network.generated.Interview
import me.rxresu.core.network.generated.SavedData
import me.rxresu.core.network.generated.SavedItem
import me.rxresu.core.network.generated.TestAiProviderResponse
import me.rxresu.core.strings.R as S

/** A tab's data: loading, ready, or failed (offline when the device had no connection). */
internal sealed interface Load<out T> {
    data object Loading : Load<Nothing>
    data class Ready<T>(val value: T) : Load<T>
    data class Failed(val offline: Boolean) : Load<Nothing>
}

internal fun Throwable.isOffline() = this is IOException

/** What every tab reads first: the job, the AI connection that would be used, and its Library, newest first. */
internal data class WorkspaceContext(
    val app: Application,
    val provider: TestAiProviderResponse?,
    val providers: List<TestAiProviderResponse>,
    val saved: List<SavedItem>,
)

internal suspend fun RrRepositories.workspaceContext(id: String): WorkspaceContext = coroutineScope {
    val app = async { applications.getApplication(id) }
    // AI availability is optional context: a failure reads as "no AI" so the tab still works without it.
    val providers = async { runCatching { ai.listAiProviders() }.getOrDefault(emptyList()).filter { it.enabled } }
    val saved = async { workspace.listCareerSavedItems(applicationId = id) }
    val usable = providers.await()
    WorkspaceContext(
        app.await(),
        usable.firstOrNull { it.isDefault } ?: usable.firstOrNull(),
        usable,
        saved.await().sortedByDescending { it.createdAt },
    )
}

internal inline fun <reified T : SavedData> List<SavedItem>.latest(interviewId: String? = null): Pair<SavedItem, T>? =
    firstOrNull { it.data is T && (interviewId == null || it.interviewId == interviewId) }?.let { it to it.data as T }

internal fun Application.interviews(): List<Interview> = activity.filterIsInstance<Interview>().sortedBy { it.at }

private fun Interview.end(): Instant = Instant.parse(at).plusSeconds((durationMinutes ?: 60) * 60)

/** The interview a workspace is about: the next one to come, else the latest one that ended in the last day. */
internal fun Application.currentInterview(now: Instant): Interview? {
    val all = interviews()
    return all.firstOrNull { it.end() >= now } ?: all.lastOrNull { now.toEpochMilli() - it.end().toEpochMilli() < 86_400_000 }
}

/** Debrief's round: the most recent interview that has ended, else the next one. */
internal fun Application.debriefRound(now: Instant): Interview? = interviews().lastOrNull { it.end() <= now } ?: interviews().firstOrNull()

internal fun Interview.ended(now: Instant) = end() < now

@Composable
internal fun interviewKindLabel(kind: AddApplicationInterviewRequestKind): String = stringResource(
    when (kind) {
        AddApplicationInterviewRequestKind.Screening -> S.string.screening
        AddApplicationInterviewRequestKind.Technical -> S.string.technical
        AddApplicationInterviewRequestKind.Behavioral -> S.string.behavioral
        AddApplicationInterviewRequestKind.Onsite -> S.string.onsite
        else -> S.string.other
    },
)

/** Dates in the account's timezone and the device locale: "Tue 10 Nov", "07:00". */
internal class Dates(val zone: ZoneId, val locale: Locale, private val is24: Boolean) {
    private fun pattern(skeleton: String) = DateTimeFormatter.ofPattern(DateFormat.getBestDateTimePattern(locale, skeleton), locale)
    private val dayFormat = pattern("EEEdMMM")
    private val timeFormat = pattern(if (is24) "HHmm" else "hmma")
    fun day(at: Instant): String = dayFormat.format(at.atZone(zone))
    fun day(date: LocalDate): String = dayFormat.format(date)
    fun time(at: Instant): String = timeFormat.format(at.atZone(zone))
    fun date(at: Instant): LocalDate = at.atZone(zone).toLocalDate()
}

@Composable
internal fun rememberDates(zone: ZoneId): Dates {
    val context = androidx.compose.ui.platform.LocalContext.current
    val locale = LocalConfiguration.current.locales[0]
    return remember(zone, locale) { Dates(zone, locale, DateFormat.is24HourFormat(context)) }
}

/** "Sends this posting, enabled Knowledge and the resume for this job to Work OpenAI." */
@Composable
internal fun sendsLine(provider: TestAiProviderResponse, vararg what: Int): String {
    val locale = LocalConfiguration.current.locales[0]
    val parts = what.map { stringResource(it) }
    return stringResource(S.string.sends_0_to_label, ListFormatter.getInstance(locale).format(parts), provider.label)
}

/**
 * A tab's body: its own vertical scroll and, when given, a pinned footer under a 1 dp rule (the boards' `pad` footer:
 * 8 dp above and below, then the gesture bar inset).
 */
@Composable
internal fun TabBody(
    modifier: Modifier = Modifier,
    footer: (@Composable ColumnScope.() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val c = RrTheme.colors
    Column(modifier.fillMaxSize()) {
        Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(bottom = 24.dp), content = content)
        if (footer != null) {
            Spacer(Modifier.fillMaxWidth().height(1.dp).background(c.line))
            Column(
                Modifier.fillMaxWidth().background(c.bg).windowInsetsPadding(WindowInsets.navigationBars)
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
                content = footer,
            )
        }
    }
}

/** Draws [load]: still skeletons while loading, the web's copy with Try again on failure (plus the offline strip). */
@Composable
internal fun <T> Loaded(load: Load<T>, onRetry: () -> Unit, content: @Composable (T) -> Unit) {
    when (load) {
        Load.Loading -> Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            RrSkeleton(Modifier.fillMaxWidth(0.7f).height(28.dp))
            RrSkeletonText(lines = 2)
            RrSkeleton(Modifier.fillMaxWidth().height(120.dp))
            RrSkeleton(Modifier.fillMaxWidth().height(120.dp))
        }
        is Load.Failed -> Column(Modifier.fillMaxSize()) {
            if (load.offline) RrOfflineStrip()
            RrCallout(
                stringResource(S.string.couldn_t_load_this_your_saved_data_hasn_t_changed),
                Modifier.padding(16.dp),
                tone = RrTone.Danger,
                actionLabel = stringResource(S.string.try_again),
                onAction = onRetry,
            )
        }
        is Load.Ready -> content(load.value)
    }
}

@Composable
internal fun Eyebrow(text: String, modifier: Modifier = Modifier) = RrSectionHeader(text, modifier)

@Composable
internal fun Group(modifier: Modifier = Modifier, content: @Composable () -> Unit) =
    RrListGroup(modifier.padding(horizontal = 16.dp), content)

/**
 * 12 sp ink-3 note with an info icon (W1's "An AI reading…" line). [RrDisclosureLine] is lock-only, for what AI sends.
 * TODO(lead): move to designsystem as an `icon` parameter on RrDisclosureLine.
 */
@Composable
internal fun InfoLine(text: String, modifier: Modifier = Modifier, @DrawableRes icon: Int = DsR.drawable.ic_ph_info) {
    val c = RrTheme.colors
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        RrIcon(icon, null, size = 14.dp, tint = c.ink3, modifier = Modifier.padding(top = 1.dp))
        RrText(text, style = RrType.caption.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.Normal), color = c.ink3)
    }
}

/** Working label with Stop beside it, for every AI request while it runs. */
@Composable
internal fun Working(labels: List<Int>, onStop: () -> Unit, modifier: Modifier = Modifier) {
    val text = labels.map { stringResource(it) } + stringResource(S.string.still_working)
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        RrWorkingLabel(text, Modifier.weight(1f))
        RrButton(stringResource(S.string.stop), onStop, variant = RrButtonVariant.Ghost, size = RrButtonSize.Small)
    }
}

/** Results fade up 6 dp over d2 once (instant under reduced motion). */
@Composable
internal fun FadeUp(content: @Composable () -> Unit) {
    val reduced = LocalReducedMotion.current
    val state = remember { MutableTransitionState(reduced) }.apply { targetState = true }
    val px = with(LocalDensity.current) { 6.dp.roundToPx() }
    AnimatedVisibility(state, enter = fadeIn(tween(RrMotion.D2, easing = RrMotion.ease)) + slideInVertically(tween(RrMotion.D2, easing = RrMotion.ease)) { px }) {
        content()
    }
}

/** A bottom sheet over the whole window from inside a tab (the tab itself only owns the area under the tab strip). */
@Composable
internal fun WindowSheet(
    onDismiss: () -> Unit,
    title: String?,
    detents: List<Float> = RrSheetDetents.HalfAndFull,
    fitContent: Boolean = false,
    confirmDiscard: Boolean = false,
    footer: (@Composable ColumnScope.() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    Dialog(onDismiss, DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false, dismissOnBackPress = false, dismissOnClickOutside = false)) {
        RrBottomSheet(onDismiss, detents = detents, fitContent = fitContent, confirmDiscard = confirmDiscard, title = title, footer = footer) {
            Column(Modifier.verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).padding(bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp), content = content)
        }
    }
}

internal fun Context.copyToClipboard(label: String, text: String) {
    getSystemService(ClipboardManager::class.java)?.setPrimaryClip(ClipData.newPlainText(label, text))
}

/** The employer's form or a source, in a Custom Tab tinted with the accent (system browser, never an embedded one). */
internal fun Context.openInBrowser(url: String, colors: RrColors) {
    CustomTabsIntent.Builder()
        .setDefaultColorSchemeParams(CustomTabColorSchemeParams.Builder().setToolbarColor(colors.bg.toArgb()).setNavigationBarColor(colors.bg.toArgb()).build())
        .setShowTitle(true)
        .build()
        .launchUrl(this, url.toUri())
}

/** "kiln.studio/careers": the host and path, without the scheme or a trailing slash. */
internal fun displayUrl(url: String) = url.substringAfter("://").removePrefix("www.").trimEnd('/')

/** Switches the Application screen to another workspace tab, replacing the current entry. */
internal fun NavController.openTab(applicationId: String, tab: WorkspaceTab) = navigate(ApplicationRoute(applicationId, tab)) {
    launchSingleTop = true
    popUpTo<ApplicationRoute> { inclusive = true }
}

internal val SmallIcon = 16.dp

@Composable
internal fun Dot(color: androidx.compose.ui.graphics.Color, modifier: Modifier = Modifier) =
    Spacer(modifier.size(6.dp).background(color, me.rxresu.core.designsystem.RrShape.xs))
