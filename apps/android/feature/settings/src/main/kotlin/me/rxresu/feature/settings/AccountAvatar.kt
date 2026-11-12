package me.rxresu.feature.settings

import androidx.compose.runtime.*
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImagePainter
import coil3.compose.rememberAsyncImagePainter
import coil3.request.CachePolicy
import coil3.request.ImageRequest
import coil3.toBitmap
import me.rxresu.core.designsystem.RrAvatar
import me.rxresu.core.network.generated.AccountProfile

@Composable
internal fun AccountAvatar(account: AccountProfile?, size: Dp = 32.dp) {
    val pixels = with(LocalDensity.current) { size.roundToPx() }
    val url =
        account?.image?.takeIf { value ->
            runCatching {
                    java.net.URI(value).let {
                        it.scheme in listOf("https", "http") &&
                            it.host != null &&
                            it.rawUserInfo == null
                    }
                }
                .getOrDefault(false)
        }
    val context = LocalContext.current
    val inspection = LocalInspectionMode.current
    val request =
        remember(url, pixels, inspection) {
            ImageRequest.Builder(context)
                .data(if (inspection) null else url)
                .size(pixels)
                .diskCachePolicy(CachePolicy.DISABLED)
                .memoryCachePolicy(CachePolicy.DISABLED)
                .build()
        }
    val painter = rememberAsyncImagePainter(request)
    val state by painter.state.collectAsState()
    val image =
        remember(state) {
            (state as? AsyncImagePainter.State.Success)?.result?.image?.toBitmap()?.asImageBitmap()
        }
    RrAvatar(initials(account?.name.orEmpty()), size = size, image = image)
}
