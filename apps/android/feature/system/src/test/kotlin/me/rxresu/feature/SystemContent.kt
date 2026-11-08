package me.rxresu.feature.system

import android.view.View
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import me.rxresu.core.designsystem.*

/** Native notification RemoteViews and shipping Glance widgets; no Compose imitation of platform content. */
@Composable internal fun SystemContent(notifications: List<View>, today: View, next: View, shortcuts: View) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        RrText(stringResource(R.string.system_notifications_content_only_the_system_draws_the_frame_d23a73), style = RrType.eyebrow, color = RrTheme.colors.ink3)
        // shortcut: Robolectric lacks SystemUI row hosting; use X1's 104 dp content floor until SystemUI hosting is available.
        notifications.forEach { view -> AndroidView(factory = { view }, modifier = Modifier.fillMaxWidth().heightIn(min = 104.dp)) }
        RrText(stringResource(R.string.system_today_widget_medium_and_small_162f12), Modifier.padding(top = 6.dp), style = RrType.eyebrow, color = RrTheme.colors.ink3)
        AndroidView(factory = { today }, modifier = Modifier.fillMaxWidth().height(200.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            AndroidView(factory = { next }, modifier = Modifier.size(150.dp))
            AndroidView(factory = { shortcuts }, modifier = Modifier.weight(1f).height(150.dp))
        }
    }
}
