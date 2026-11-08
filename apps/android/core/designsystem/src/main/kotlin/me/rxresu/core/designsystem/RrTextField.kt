package me.rxresu.core.designsystem

import androidx.annotation.DrawableRes
import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.contentType
import androidx.compose.ui.semantics.error
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextDirection
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Text field: label above (field-label style, ink-2, 6 dp gap), 44 dp `raised` box with a control-border edge, 16 sp
 * text, ink-3 placeholder, helper or error below. Focus draws an accent edge with a 3 dp accent-soft ring; an error
 * draws danger with a danger-soft ring and an icon before the message.
 *
 * @param ltr keep the text left-to-right in every locale (URLs, emails, phone numbers, slugs).
 * @param mono Geist Mono text (URLs, slugs).
 * @param contentType autofill hint, e.g. `ContentType.EmailAddress`.
 * @param minLines > 1 makes a multiline field (96 dp min, 24 sp lines); [singleLine] is then ignored.
 * @param trailing e.g. an [RrIconButton] (show password) or a static icon.
 * @param prefix fixed ink-3 text before the input, part of the value people see but not of [value] (`rxresu.me/alex/`
 *   before a slug, B12). The prefix and the input always run left to right, in every locale.
 */
@Composable
fun RrTextField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    label: String? = null,
    placeholder: String? = null,
    helper: String? = null,
    error: String? = null,
    @DrawableRes leadingIcon: Int? = null,
    trailing: (@Composable RowScope.() -> Unit)? = null,
    enabled: Boolean = true,
    readOnly: Boolean = false,
    singleLine: Boolean = true,
    minLines: Int = 1,
    ltr: Boolean = false,
    mono: Boolean = false,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    keyboardActions: KeyboardActions = KeyboardActions.Default,
    visualTransformation: VisualTransformation = VisualTransformation.None,
    contentType: ContentType? = null,
    interactionSource: MutableInteractionSource = remember { MutableInteractionSource() },
    prefix: String? = null,
) {
    val c = RrTheme.colors
    val focused by interactionSource.collectIsFocusedAsState()
    val multiline = minLines > 1
    val base = if (mono) RrType.mono.copy(fontSize = 16.sp, lineHeight = 22.sp) else RrType.input
    val style = RrTextDefaults.merge(base).copy(
        color = c.ink,
        lineHeight = if (multiline) 24.sp else base.lineHeight,
        textDirection = if (ltr || prefix != null) TextDirection.Ltr else TextDirection.Content,
    )
    FieldFrame(label, helper, error, modifier, enabled) {
        val field: @Composable () -> Unit = {
            BasicTextField(
                value = value,
                onValueChange = onValueChange,
                enabled = enabled,
                readOnly = readOnly,
                textStyle = style,
                singleLine = singleLine && !multiline,
                minLines = minLines,
                keyboardOptions = keyboardOptions,
                keyboardActions = keyboardActions,
                visualTransformation = visualTransformation,
                interactionSource = interactionSource,
                cursorBrush = rrCursorBrush(c.accent),
                modifier = Modifier
                    .fillMaxWidth()
                    .semantics {
                        if (label != null) contentDescription = label
                        if (error != null) error(error)
                        if (contentType != null) this.contentType = contentType
                    },
                decorationBox = { inner ->
                    FieldBox(focused, error != null, multiline) {
                        if (leadingIcon != null) RrIcon(leadingIcon, null, size = 20.dp, tint = c.ink3)
                        val input: @Composable () -> Unit = {
                            Box(Modifier.then(if (value.isNotEmpty()) Modifier.rrDesignTag(DesignTag(text = visualTransformation.filter(androidx.compose.ui.text.AnnotatedString(value)).text.text, style = style, colorName = "ink")) else Modifier), contentAlignment = if (multiline) Alignment.TopStart else Alignment.CenterStart) {
                                if (value.isEmpty() && placeholder != null) RrText(placeholder, style = style.copy(color = c.ink3), maxLines = if (multiline) Int.MAX_VALUE else 1)
                                inner()
                            }
                        }
                        if (prefix == null) {
                            Box(Modifier.weight(1f)) { input() }
                        } else {
                            CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Ltr) {
                                Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) {
                                    RrText(prefix, style = style.copy(color = c.ink3), maxLines = 1)
                                    Box(Modifier.weight(1f)) { input() }
                                }
                            }
                        }
                        trailing?.invoke(this)
                    }
                },
            )
        }
        if (ltr) CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Ltr, content = field) else field()
    }
}

/** A field-shaped button that opens a picker (dates, times, a resume): label above, value inside, trailing icon. */
@Composable
fun RrPickerField(
    value: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    label: String? = null,
    placeholder: String? = null,
    helper: String? = null,
    error: String? = null,
    @DrawableRes trailingIcon: Int? = R.drawable.ic_ph_caret_down,
    @DrawableRes leadingIcon: Int? = null,
    enabled: Boolean = true,
) {
    val c = RrTheme.colors
    FieldFrame(label, helper, error, modifier, enabled) {
        Box(
            Modifier
                .clip(RrShape.md)
                .clickable(remember { MutableInteractionSource() }, LocalIndication.current, enabled = enabled, role = Role.Button, onClick = onClick)
                .semantics(mergeDescendants = true) { if (label != null) contentDescription = "$label, ${value.ifEmpty { placeholder.orEmpty() }}" },
        ) {
            FieldBox(focused = false, isError = error != null, multiline = false) {
                if (leadingIcon != null) RrIcon(leadingIcon, null, size = 20.dp, tint = c.ink3)
                // One line like the text field it sits beside; a long value (a language name) ends in an ellipsis.
                RrText(value.ifEmpty { placeholder.orEmpty() }, style = RrType.input, color = if (value.isEmpty()) c.ink3 else c.ink, modifier = Modifier.weight(1f), maxLines = 1)
                if (trailingIcon != null) RrIcon(trailingIcon, null, size = 20.dp, tint = c.ink3)
            }
        }
    }
}

/**
 * Search field (D5 and in-list search): magnifier, 16 sp input, clear button while it has text.
 */
@Composable
fun RrSearchField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
    keyboardActions: KeyboardActions = KeyboardActions.Default,
    interactionSource: MutableInteractionSource = remember { MutableInteractionSource() },
) {
    RrTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = modifier,
        placeholder = placeholder,
        leadingIcon = R.drawable.ic_ph_magnifying_glass,
        keyboardOptions = KeyboardOptions(imeAction = androidx.compose.ui.text.input.ImeAction.Search),
        keyboardActions = keyboardActions,
        interactionSource = interactionSource,
        trailing = if (value.isEmpty()) null else {
            {
                RrIconButton(
                    R.drawable.ic_ph_x,
                    androidx.compose.ui.res.stringResource(R.string.ds_clear_search),
                    onClick = { onValueChange("") },
                    size = RrIconButtonSize.Small,
                    tint = RrTheme.colors.ink3,
                )
            }
        },
    )
}

@Composable
private fun FieldFrame(label: String?, helper: String?, error: String?, modifier: Modifier, enabled: Boolean, field: @Composable () -> Unit) {
    val c = RrTheme.colors
    Column(modifier.rrEnabledAlpha(enabled, 0.45f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (label != null) RrText(label, style = RrType.formLabel, color = c.ink2)
        field()
        when {
            error != null -> Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                RrIcon(R.drawable.ic_ph_warning_circle, null, size = 14.dp, tint = c.dangerText)
                RrText(error, style = HelpText, color = c.dangerText)
            }
            helper != null -> RrText(helper, style = HelpText, color = c.ink3)
        }
    }
}

private val HelpText = TextStyle(fontFamily = Figtree, fontSize = 12.sp, lineHeight = 16.sp)

@Composable
private fun FieldBox(focused: Boolean, isError: Boolean, multiline: Boolean, content: @Composable RowScope.() -> Unit) {
    val c = RrTheme.colors
    val edge = when {
        isError -> c.danger
        focused -> c.accent
        else -> c.controlBorder
    }
    val ring: Color? = when {
        isError -> c.dangerSoft
        focused -> c.accentSoft
        else -> null
    }
    Row(
        Modifier
            .fillMaxWidth()
            .drawBehind {
                if (ring != null) {
                    val w = 3.dp.toPx()
                    drawRoundRect(
                        ring,
                        topLeft = Offset(-w / 2, -w / 2),
                        size = Size(size.width + w, size.height + w),
                        cornerRadius = CornerRadius(RrRadius.md.toPx() + w / 2),
                        style = Stroke(w),
                    )
                }
            }
            .rrDesignTag(DesignTag(component = "TextField", radius = RrRadius.md, bgName = "raised"))
            .defaultMinSize(minHeight = if (multiline) 96.dp else 44.dp)
            .clip(RrShape.md)
            .background(c.raised)
            .border(1.dp, edge, RrShape.md)
            .padding(horizontal = 12.dp, vertical = if (multiline) 10.dp else 0.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = if (multiline) Alignment.Top else Alignment.CenterVertically,
        content = content,
    )
}

@RrPreviews
@Composable
internal fun RrTextFieldPreview() = RrPreviewSurface {
    RrTextField("Lumen", {}, label = "Company")
    RrTextField("", {}, label = "Role", placeholder = "Senior product designer")
    RrTextField("alex@morgan", {}, label = "Email", error = "Add the domain ending, like morgan.com", ltr = true, contentType = ContentType.EmailAddress)
    RrTextField("Lumen office, Rua do Alecrim 12", {}, label = "Location", leadingIcon = R.drawable.ic_ph_map_pin, helper = "Video link, office address, or phone number")
    RrPickerField("Tue 10 Nov 2026", {}, label = "Date", trailingIcon = R.drawable.ic_ph_calendar_blank)
    RrTextField("Walk through one design system decision and its trade-offs.", {}, label = "What they asked you to prepare", minLines = 3)
    RrSearchField("Lumen", {}, placeholder = "Search")
    RrTextField("product-designer", {}, label = "Address", prefix = "rxresu.me/alex/", mono = true, helper = "Live at rxresu.me/alex/product-designer")
}
