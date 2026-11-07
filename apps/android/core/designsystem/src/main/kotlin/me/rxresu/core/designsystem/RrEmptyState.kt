package me.rxresu.core.designsystem

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp

/**
 * Empty state: dashed line-2 edge, Instrument Serif title, one line of body and at most one primary button.
 */
@Composable
fun RrEmptyState(
    title: String,
    body: String,
    modifier: Modifier = Modifier,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
) {
    val c = RrTheme.colors
    Column(
        modifier.fillMaxWidth().rrDashedBorder(c.line2, RrRadius.lg).padding(horizontal = 20.dp, vertical = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        RrText(title, style = RrType.sheetTitle, color = c.ink, textAlign = TextAlign.Center)
        RrText(body, style = RrType.small, color = c.ink2, textAlign = TextAlign.Center)
        if (actionLabel != null && onAction != null) RrButton(actionLabel, onAction)
    }
}

@RrPreviews
@Composable
internal fun RrEmptyStatePreview() = RrPreviewSurface {
    RrEmptyState("Your job search starts here", "Save a job from any browser and it lands here.", actionLabel = "Save a job", onAction = {})
}
