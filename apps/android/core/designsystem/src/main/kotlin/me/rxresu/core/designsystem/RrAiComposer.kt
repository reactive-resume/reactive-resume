package me.rxresu.core.designsystem

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * AI composer: multiline input on `raised` with a control-border edge, a row of context chips (what goes with the
 * message), optional extra buttons (attach), and the accent Send arrow. Send is disabled while [value] is blank or
 * [sending]; while sending, [onStop] (if given) replaces it with Stop. Keep the person's words on failure: the caller
 * clears [value] only after a successful send.
 *
 * Show a quiet status line below only while sending is blocked.
 */
@Composable
fun RrAiComposer(
    value: String,
    onValueChange: (String) -> Unit,
    onSend: () -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    sending: Boolean = false,
    onStop: (() -> Unit)? = null,
    dimEmptySend: Boolean = true,
    contextChips: @Composable RowScope.() -> Unit = {},
    tools: @Composable RowScope.() -> Unit = {},
) {
    val c = RrTheme.colors
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    Column(
        modifier
            .fillMaxWidth()
            .rrDesignTag(DesignTag(component = "Composer", radius = RrRadius.xl, bgName = "raised"))
            .clip(RrShape.xl)
            .background(c.raised)
            .border(1.dp, if (focused) c.accent else c.controlBorder, RrShape.xl)
            .padding(start = 12.dp, end = 8.dp, top = 10.dp, bottom = 8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        val style = RrTextDefaults.merge(RrType.body).copy(color = c.ink)
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            enabled = enabled,
            textStyle = style,
            cursorBrush = rrCursorBrush(c.accent),
            interactionSource = interaction,
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
            modifier = Modifier.fillMaxWidth().heightIn(min = 22.dp, max = 160.dp).then(if (value.isNotEmpty()) Modifier.rrDesignTag(DesignTag(text = value, style = style, colorName = "ink")) else Modifier).semantics { contentDescription = placeholder },
            decorationBox = { inner ->
                Box {
                    if (value.isEmpty()) RrText(placeholder, style = style.copy(color = c.ink3))
                    inner()
                }
            },
        )
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            Row(
                Modifier.weight(1f).horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.CenterVertically,
                content = contextChips,
            )
            tools()
            if (sending && onStop != null) {
                RrIconButton(R.drawable.ic_ph_stop_fill, stringResource(R.string.ds_stop), onStop, size = RrIconButtonSize.Small, tint = c.ink)
            } else {
                val canSend = enabled && !sending && value.isNotBlank()
                RrIconButton(
                    R.drawable.ic_ph_arrow_up,
                    stringResource(R.string.ds_send),
                    { if (canSend) onSend() },
                    size = RrIconButtonSize.Small,
                    enabled = canSend,
                    dimWhenDisabled = dimEmptySend || !enabled || sending,
                    containerColor = c.accent,
                    tint = c.onAccent,
                )
            }
        }
    }
}

@RrPreviews
@Composable
internal fun RrAiComposerPreview() = RrPreviewSurface {
    RrAiComposer("", {}, {}, placeholder = "Ask about your next career step…", contextChips = {
        RrContextChip("Product designer", icon = R.drawable.ic_ph_file_text, onRemove = {})
    })
    RrAiComposer("Tailor this to the Lumen posting", {}, {}, placeholder = "Ask about this resume…", contextChips = {
        RrContextChip("This resume", icon = R.drawable.ic_ph_file_text, onRemove = {})
        RrContextChip("Lumen posting", icon = R.drawable.ic_ph_briefcase, onRemove = {})
    }, tools = {
        RrIconButton(R.drawable.ic_ph_paperclip, stringResource(R.string.ds_attach_file), {}, size = RrIconButtonSize.Small)
    })
}
