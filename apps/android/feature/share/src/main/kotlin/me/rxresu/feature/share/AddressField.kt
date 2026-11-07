package me.rxresu.feature.share

import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import me.rxresu.core.designsystem.RrTextField
import me.rxresu.core.strings.R as CoreR

@Composable internal fun AddressField(state: ShareState, change: (String) -> Unit) {
    val error = if (state.slugInvalid) stringResource(CoreR.string.use_latin_letters_az_numbers_and_single_dashes) else if (state.slugTaken) stringResource(CoreR.string.another_of_your_resumes_uses_this_address) else null
    val url = state.url.removePrefix("https://").removePrefix("http://")
    val hint = if (state.checking) stringResource(CoreR.string.checking_copy_is_available_after_saving) else if (state.resume?.isPublic == true) stringResource(R.string.p4_live_at, url) else stringResource(R.string.p4_goes_live_at, url)
    RrTextField(state.slug, change, Modifier.padding(16.dp), label = stringResource(CoreR.string.address),
        prefix = state.shortUrl.removePrefix("https://").removePrefix("http://") + "/", ltr = true, mono = true, enabled = state.editable, helper = hint, error = error)
}
