package me.rxresu.feature.share

import androidx.compose.animation.Crossfade
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.semantics.*
import me.rxresu.core.designsystem.*
import me.rxresu.core.strings.R as CoreR

// TODO(lead): move to designsystem as RrTextField's fixed LTR prefix.
@Composable internal fun AddressField(state: ShareState, change: (String) -> Unit) {
    val c = RrTheme.colors
    val address = stringResource(CoreR.string.address)
    val error = if (state.slugInvalid) stringResource(CoreR.string.use_latin_letters_az_numbers_and_single_dashes) else if (state.slugTaken) stringResource(CoreR.string.another_of_your_resumes_uses_this_address) else null
    val url = state.url.removePrefix("https://").removePrefix("http://")
    val hint = error ?: if (state.checking) stringResource(CoreR.string.checking_copy_is_available_after_saving) else if (state.resume?.isPublic == true) stringResource(R.string.p4_live_at, url) else stringResource(R.string.p4_goes_live_at, url)
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        RrText(address, style = RrType.caption, color = c.ink2)
        CompositionLocalProvider(androidx.compose.ui.platform.LocalLayoutDirection provides androidx.compose.ui.unit.LayoutDirection.Ltr) {
        Row(Modifier.fillMaxWidth().heightIn(min = 44.dp).background(c.raised, RrShape.lg).border(1.dp, if (error == null) c.line2 else c.dangerText, RrShape.lg).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            RrText("/" + state.username + "/", Modifier.widthIn(max = 120.dp), style = RrType.mono.copy(textDirection = TextDirection.Ltr), color = c.ink3)
            BasicTextField(state.slug, change, Modifier.weight(1f).padding(vertical = 12.dp).semantics { contentDescription = address; error?.let { error(it) } }, enabled = state.editable, singleLine = true, textStyle = RrType.mono.copy(color = c.ink, textDirection = TextDirection.Ltr))
        }
        }
        Crossfade(hint, animationSpec = androidx.compose.animation.core.tween(if (RrTheme.reducedMotion) 0 else RrMotion.D2), label = "address") { RrText(it, style = RrType.caption, color = if (error == null) c.ink3 else c.dangerText) }
    }
}
