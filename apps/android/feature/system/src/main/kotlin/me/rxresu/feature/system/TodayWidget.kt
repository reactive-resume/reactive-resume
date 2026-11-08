package me.rxresu.feature.system

import androidx.compose.ui.res.stringResource
import me.rxresu.core.strings.R as CoreStrings

import android.content.Context
import androidx.compose.runtime.*
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.LocalSize
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.lazy.LazyColumn
import androidx.glance.appwidget.lazy.items
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.layout.*
import androidx.glance.text.FontFamily
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import androidx.glance.color.ColorProvider
import java.time.Instant
import java.time.format.DateTimeFormatter
import me.rxresu.core.auth.SessionState
import me.rxresu.core.data.*
import me.rxresu.core.designsystem.DarkRrColors
import me.rxresu.core.designsystem.LightRrColors
import me.rxresu.core.designsystem.RrFixedColors
import me.rxresu.core.designsystem.RrRadius
import me.rxresu.core.designsystem.RrType
import me.rxresu.core.navigation.WorkspaceTab

class TodayWidget : GlanceAppWidget() {
    // Three 44 dp row targets plus the title and padding need 200 dp on a launcher.
    override val sizeMode = SizeMode.Responsive(setOf(DpSize(250.dp, 200.dp), DpSize(330.dp, 200.dp)))
    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val repositories = (context.applicationContext as RepositoriesProvider).repositories
        provideContent { WidgetContent(context, repositories, small = false) }
    }
}
class NextInterviewWidget : GlanceAppWidget() {
    override val sizeMode = SizeMode.Responsive(setOf(DpSize(150.dp, 150.dp), DpSize(250.dp, 150.dp)))
    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val repositories = (context.applicationContext as RepositoriesProvider).repositories
        provideContent { WidgetContent(context, repositories, small = true) }
    }
}
class TodayWidgetReceiver : GlanceAppWidgetReceiver() { override val glanceAppWidget: GlanceAppWidget = TodayWidget() }
class NextInterviewWidgetReceiver : GlanceAppWidgetReceiver() { override val glanceAppWidget: GlanceAppWidget = NextInterviewWidget() }

@Composable private fun WidgetContent(context: Context, repositories: RrRepositories, small: Boolean) {
    val session by repositories.account.session.collectAsState()
    val signedIn = session is SessionState.SignedIn
    val owner = (session as? SessionState.SignedIn)?.accountScope
    val largeText = context.resources.configuration.fontScale > 1f
    val bg = ColorProvider(LightRrColors.raised, DarkRrColors.raised)
    val ink = ColorProvider(LightRrColors.ink, DarkRrColors.ink)
    val secondary = ColorProvider(LightRrColors.ink3, DarkRrColors.ink3)
    Column(GlanceModifier.fillMaxSize().background(bg).cornerRadius(RrRadius.largeSurface).padding(14.dp).clickable(actionStartActivity(targetIntent(context, SystemTarget("today"))))) {
        if (!signedIn) {
            Text(context.getString(R.string.system_sign_in_to_see_today_fca697), style = TextStyle(color = ink, fontSize = RrType.body.fontSize))
        } else key(owner) {
            // Remembering by account prevents a new account briefly seeing the previous one's Today data.
            val resource by remember(owner) { repositories.today.observe() }.collectAsState(Resource<TodaySnapshot>(loading = true))
            val snapshot = resource.data
            if (small) {
                val interview = (snapshot?.needsYou.orEmpty() + snapshot?.comingUp.orEmpty()).filter { it.kind == TodayKind.Interview || it.kind == TodayKind.Briefing }.minByOrNull { it.at.orEmpty() }
                Text(context.getString(R.string.system_next_interview_363cbe), GlanceModifier.fillMaxWidth(), style = TextStyle(color = secondary, fontSize = RrType.caption.fontSize))
                Spacer(GlanceModifier.height(8.dp))
                if (interview != null) LazyColumn(GlanceModifier.fillMaxWidth().defaultWeight()) {
                    item {
                        Column(GlanceModifier.fillMaxWidth().clickable(actionStartActivity(targetIntent(context, SystemTarget("application", interview.applicationId))))) {
                            val time = widgetTime(interview, repositories.time)
                            Text(if (largeText) time.substringAfter(' ') else time, GlanceModifier.fillMaxWidth(), style = TextStyle(color = ink, fontSize = RrType.sheetTitle.fontSize, fontFamily = FontFamily.Serif))
                            if (largeText) Text(time.substringBefore(' '), GlanceModifier.fillMaxWidth(), style = TextStyle(color = secondary, fontSize = RrType.caption.fontSize))
                            Text(listOf(interview.company, interview.title).filter(String::isNotBlank).joinToString(" · "), GlanceModifier.fillMaxWidth(), style = TextStyle(color = secondary, fontSize = RrType.small.fontSize))
                        }
                    }
                } else Text(if (resource.loading) context.getString(R.string.system_loading_33ce41) else context.getString(R.string.system_no_upcoming_interviews_05c76d), style = TextStyle(color = ink, fontSize = RrType.small.fontSize))
            } else {
                if (largeText) Column(GlanceModifier.fillMaxWidth()) {
                    Text(context.getString(R.string.system_today_24345a), style = TextStyle(color = ink, fontSize = RrType.sheetTitle.fontSize, fontFamily = FontFamily.Serif))
                    Text(context.getString(R.string.system_1_s_need_you_b08acb, snapshot?.needsYou.orEmpty().size.toString()), style = TextStyle(color = secondary, fontSize = RrType.caption.fontSize))
                } else Row(GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text(context.getString(R.string.system_today_24345a), GlanceModifier.defaultWeight(), style = TextStyle(color = ink, fontSize = RrType.sheetTitle.fontSize, fontFamily = FontFamily.Serif))
                    Text(context.getString(R.string.system_1_s_need_you_b08acb, snapshot?.needsYou.orEmpty().size.toString()), style = TextStyle(color = secondary, fontSize = RrType.caption.fontSize))
                }
                Spacer(GlanceModifier.height(8.dp))
                LazyColumn(GlanceModifier.fillMaxWidth().defaultWeight()) {
                    items(snapshot?.needsYou.orEmpty().take(3)) { item ->
                        Row(GlanceModifier.fillMaxWidth().then(if (largeText) GlanceModifier.padding(vertical = 8.dp) else GlanceModifier.height(44.dp)).clickable(actionStartActivity(targetIntent(context, item.applicationId?.let { SystemTarget("application", it) } ?: SystemTarget("today")))), verticalAlignment = Alignment.CenterVertically) {
                            val color = when (item.kind) { TodayKind.Interview, TodayKind.Briefing -> RrFixedColors.stageInterview; TodayKind.Offer -> RrFixedColors.stageOffer; else -> LightRrColors.warn }
                            Box(GlanceModifier.size(8.dp).cornerRadius(RrRadius.sm).background(ColorProvider(color))) {}
                            Spacer(GlanceModifier.width(8.dp))
                            if (largeText) Column(GlanceModifier.defaultWeight()) {
                                Text(widgetTime(item, repositories.time), style = TextStyle(color = secondary, fontSize = RrType.caption.fontSize, fontFamily = FontFamily.Monospace))
                                Text(listOf(item.company, item.title).filter(String::isNotBlank).joinToString(" · "), GlanceModifier.fillMaxWidth(), style = TextStyle(color = ink, fontSize = RrType.ui.fontSize))
                            } else {
                                Text(listOf(item.company, item.title).filter(String::isNotBlank).joinToString(" · "), GlanceModifier.defaultWeight(), style = TextStyle(color = ink, fontSize = RrType.ui.fontSize), maxLines = 2)
                                Text(widgetTime(item, repositories.time), style = TextStyle(color = secondary, fontSize = RrType.caption.fontSize, fontFamily = FontFamily.Monospace))
                            }
                        }
                    }
                }
                if (snapshot?.needsYou.isNullOrEmpty()) Text(if (resource.loading) context.getString(R.string.system_loading_33ce41) else context.getString(R.string.system_you_re_all_caught_up_65a724), style = TextStyle(color = secondary, fontSize = RrType.small.fontSize))
            }
        }
    }
}
internal fun widgetTime(item: TodayItem, time: TimeSource): String = item.at?.let { at -> runCatching {
    val value = Instant.parse(at).atZone(time.timezone())
    value.format(DateTimeFormatter.ofPattern(if (item.kind == TodayKind.Offer) "EEE" else "EEE HH:mm"))
}.getOrNull() }.orEmpty()
