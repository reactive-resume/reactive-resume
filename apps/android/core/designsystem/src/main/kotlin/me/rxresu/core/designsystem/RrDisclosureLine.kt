package me.rxresu.core.designsystem

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/**
 * Disclosure line before AI sends anything: 12 sp ink-3 with a lock, naming what is sent and where ("When you press
 * send, this resume goes to Work OpenAI with your key.").
 */
@Composable
fun RrDisclosureLine(text: String, modifier: Modifier = Modifier) {
    val c = RrTheme.colors
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        RrIcon(R.drawable.ic_ph_lock_simple, null, size = 14.dp, tint = c.ink3, modifier = Modifier.padding(top = 1.dp))
        RrText(text, style = RrType.caption.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.Normal), color = c.ink3)
    }
}

@RrPreviews
@Composable
internal fun RrDisclosureLinePreview() = RrPreviewSurface {
    RrDisclosureLine("When you press send, this resume goes to Work OpenAI with your key.")
}
