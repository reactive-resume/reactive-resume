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
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Avatar with 2 dp corners: initials on accent-soft (or a photo). 32 dp in headers inside a 44 dp target; 56 dp in
 * Settings. With [onClick] it is a button whose [contentDescription] names the destination ("Settings").
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
            } else {
                RrText(
                    initials,
                    style = RrType.caption.copy(fontWeight = FontWeight.SemiBold, fontSize = if (size >= 56.dp) 18.sp else 12.sp),
                    color = c.accentText,
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

@RrPreviews
@Composable
internal fun RrAvatarPreview() = RrPreviewSurface {
    androidx.compose.foundation.layout.Row {
        RrAvatar("AM", onClick = {}, contentDescription = "Settings")
        RrAvatar("PS", size = 32.dp)
        RrAvatar("AM", size = 56.dp)
    }
}
