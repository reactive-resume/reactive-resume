package me.rxresu.core.designsystem

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

/** AI connection name in the top bar; never a disclosure line below a composer. */
@Composable
fun RrConnectionChip(label: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val c = RrTheme.colors
    Row(
        modifier.heightIn(min = 32.dp)
            .rrDesignTag(DesignTag(component = "Chip", radius = RrRadius.sm, bgName = "sunken"))
            .clip(RrShape.sm).background(c.sunken).clickable(role = Role.Button, onClick = onClick).padding(horizontal = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically,
    ) {
        RrIcon(R.drawable.ic_ph_sparkle, null, size = 16.dp, tint = c.accentText)
        RrText(label, style = RrType.small.copy(fontWeight = FontWeight.Medium), color = c.ink2, maxLines = 1)
        RrIcon(R.drawable.ic_ph_caret_down, null, size = 16.dp, tint = c.ink2)
    }
}

/** End-aligned user message, capped at 84 percent of the conversation width. */
@Composable
fun RrUserBubble(text: String, modifier: Modifier = Modifier) {
    val c = RrTheme.colors
    val shape = RoundedCornerShape(topStart = RrRadius.xl, topEnd = RrRadius.xl, bottomStart = RrRadius.xl, bottomEnd = RrRadius.xs)
    BoxWithConstraints(modifier.fillMaxWidth(), contentAlignment = Alignment.CenterEnd) {
        Box(Modifier.widthIn(max = maxWidth * 0.84f)
            .rrDesignTag(DesignTag(component = "Bubble", radius = RrRadius.xl, bgName = "sunken"))
            .clip(shape).background(c.sunken).padding(horizontal = 12.dp, vertical = 10.dp)) {
            RrText(text, style = RrType.bubble, color = c.ink)
        }
    }
}

@RrPreviews
@Composable
internal fun RrConversationPreview() = RrPreviewSurface {
    RrConnectionChip("Work OpenAI", {})
    RrUserBubble("Help me tailor this resume to the Lumen posting.")
}
