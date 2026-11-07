package me.rxresu.core.designsystem

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * Avatar with 2 dp corners: initials on accent-soft (or a photo). 32 dp in headers inside a 44 dp target; 56 dp in
 * Settings. With [onClick] it is a button whose [contentDescription] names the destination ("Settings"). Initials keep
 * their size at every font scale. Blank [initials] (an account without a name) show a person icon instead.
 */
@Composable
fun RrAvatar(
    initials: String,
    modifier: Modifier = Modifier,
    size: Dp = 32.dp,
    image: ImageBitmap? = null,
    onClick: (() -> Unit)? = null,
    contentDescription: String? = null,
) {
    val c = RrTheme.colors
    val face = @Composable {
        Box(Modifier.size(size).clip(RrShape.sm).background(c.accentSoft), contentAlignment = Alignment.Center) {
            if (image != null) {
                Image(image, null, Modifier.size(size), contentScale = ContentScale.Crop)
            } else if (initials.isBlank()) {
                RrIcon(R.drawable.ic_ph_user, null, size = size / 2, tint = c.accentText)
            } else {
                // Initials are part of a fixed-size mark: they keep their size at large font scales instead of
                // overflowing the tile. The name they stand for is in the row beside them or in contentDescription.
                RrText(
                    initials,
                    style = fixedSizeText(RrType.caption.copy(fontWeight = FontWeight.SemiBold), if (size >= 56.dp) 18.dp else 12.dp, 16.dp),
                    color = c.accentText,
                    maxLines = 1,
                )
            }
        }
    }
    if (onClick != null) {
        Box(
            modifier.size(44.dp).clip(RrShape.md).clickable(role = Role.Button, onClick = onClick)
                .clearAndSetSemantics { role = Role.Button; if (contentDescription != null) this.contentDescription = contentDescription },
            contentAlignment = Alignment.Center,
        ) { face() }
    } else {
        Box(modifier.semantics { if (contentDescription != null) this.contentDescription = contentDescription }) { face() }
    }
}

/** [style] at a size in dp, so text inside a fixed-size mark ignores the font scale. */
@Composable
internal fun fixedSizeText(style: TextStyle, size: Dp, lineHeight: Dp): TextStyle = with(LocalDensity.current) {
    style.copy(fontSize = size.toSp(), lineHeight = lineHeight.toSp())
}

@RrPreviews
@Composable
internal fun RrAvatarPreview() = RrPreviewSurface {
    androidx.compose.foundation.layout.Row {
        RrAvatar("AM", onClick = {}, contentDescription = "Settings")
        RrAvatar("PS", size = 32.dp)
        RrAvatar("AM", size = 56.dp)
        RrAvatar("", onClick = {}, contentDescription = "Settings")
        RrAvatar(" ", size = 56.dp)
    }
}
