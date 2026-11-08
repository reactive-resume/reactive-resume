package me.rxresu.core.designsystem

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import me.rxresu.core.strings.R as S

/** Stage pager marks retain their 16×4 dp drawing; Compose expands and arbitrates their touch targets. */
@Composable
fun RrStagePageMarks(count: Int, current: Int, onSelect: (Int) -> Unit, modifier: Modifier = Modifier) {
    require(count > 0 && current in 0 until count)
    val colors = RrTheme.colors
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        repeat(count) { index ->
            val label = stringResource(S.string.page_0_of_1, "${index + 1}", "$count")
            Box(Modifier.size(16.dp, 4.dp)
                .background(if (index == current) colors.accent else colors.line2, RoundedCornerShape(1.dp))
                .clickable(role = Role.Tab) { onSelect(index) }
                .semantics { contentDescription = label; selected = index == current })
        }
    }
}
