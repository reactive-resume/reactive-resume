package me.rxresu.core.designsystem

import androidx.annotation.DrawableRes
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp

/**
 * A Phosphor icon (`R.drawable.ic_ph_*`, regular weight; `*_fill` only for the selected tab or mode).
 *
 * Sizes: 24 dp on touch (default), 20 dp inside buttons, 16 dp in chips and badges, 14 dp in captions.
 *
 * @param contentDescription null for decorative icons next to words; required when the icon stands alone.
 * @param tint defaults to the current content colour.
 * @param mirrorInRtl flip horizontally in right-to-left layouts (directional icons such as carets and arrows).
 */
@Composable
fun RrIcon(
    @DrawableRes id: Int,
    contentDescription: String?,
    modifier: Modifier = Modifier,
    size: Dp = 24.dp,
    tint: Color = LocalRrContentColor.current,
    mirrorInRtl: Boolean = false,
) {
    val flip = mirrorInRtl && LocalLayoutDirection.current == LayoutDirection.Rtl
    Image(
        painter = painterResource(id),
        contentDescription = contentDescription,
        modifier = modifier
            .size(size)
            .then(if (flip) Modifier.graphicsLayer { scaleX = -1f } else Modifier)
            .then(if (contentDescription == null) Modifier.clearAndSetSemantics { } else Modifier),
        colorFilter = ColorFilter.tint(tint),
    )
}

/** The Reactive Resume logo mark: the light file on light grounds, the dark file on dark grounds. Never tinted. */
@Composable
fun RrLogo(modifier: Modifier = Modifier, size: Dp = 32.dp, contentDescription: String? = androidx.compose.ui.res.stringResource(R.string.ds_app_name)) {
    Image(
        painter = painterResource(if (LocalRrColors.current.isDark) R.drawable.rr_logo_dark else R.drawable.rr_logo_light),
        contentDescription = contentDescription,
        modifier = modifier.size(size),
    )
}
