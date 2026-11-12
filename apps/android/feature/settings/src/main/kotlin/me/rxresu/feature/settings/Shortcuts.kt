package me.rxresu.feature.settings

import androidx.annotation.StringRes
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import me.rxresu.core.designsystem.*
import me.rxresu.core.strings.R as CR

internal data class Shortcut(@StringRes val name: Int, val keys: List<String>)

/** The web's hotkeys (features/keyboard-shortcuts and each page's useHotkey), Mod as Ctrl as on non-Apple keyboards. */
internal val webShortcuts = listOf(
    Shortcut(R.string.screen_command_palette, listOf("Ctrl", "K")),
    Shortcut(CR.string.keyboard_shortcuts, listOf("?")),
    Shortcut(CR.string.message_new, listOf("N")),
    Shortcut(CR.string.search_documents, listOf("/")),
    Shortcut(CR.string.next_application, listOf("J")),
    Shortcut(CR.string.previous_application, listOf("K")),
    Shortcut(CR.string.write, listOf("1")),
    Shortcut(CR.string.design, listOf("2")),
    Shortcut(CR.string.check, listOf("3")),
    Shortcut(CR.string.share, listOf("4")),
    Shortcut(CR.string.undo, listOf("Ctrl", "Z")),
    Shortcut(CR.string.redo, listOf("Ctrl", "Shift", "Z")),
    Shortcut(CR.string.save, listOf("Ctrl", "S")),
    Shortcut(CR.string.download_pdf, listOf("Ctrl", "P")),
    Shortcut(CR.string.download_history, listOf("Ctrl", "Shift", "E")),
    Shortcut(CR.string.assistant, listOf("Ctrl", "J")),
    Shortcut(R.string.screen_fit_page_to_width, listOf("Ctrl", "0")),
)

/** S3 "Keyboard shortcuts" when a hardware keyboard is attached: name on the start side, key caps on the end. */
@Composable
internal fun ShortcutsSheet(close: () -> Unit) {
    RrBottomSheet(close, title = stringResource(CR.string.keyboard_shortcuts), initialDetent = 1) {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            webShortcuts.forEach { shortcut ->
                val name = stringResource(shortcut.name)
                val keys = shortcut.keys.joinToString("+")
                Row(Modifier.fillMaxWidth().heightIn(min = 32.dp).semantics(mergeDescendants = true) { contentDescription = "$name, $keys" },
                    horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    RrText(name, Modifier.weight(1f), style = RrType.ui)
                    Row(Modifier.clearAndSetSemantics {}, horizontalArrangement = Arrangement.spacedBy(4.dp)) { shortcut.keys.forEach { KeyCap(it) } }
                }
            }
        }
    }
}

// TODO(lead): move to designsystem. A key cap: mono 12 sp in a line-bordered box (web `kbd`).
@Composable
private fun KeyCap(key: String) = Box(Modifier.defaultMinSize(minWidth = 24.dp).border(1.dp, RrTheme.colors.line, RrShape.sm).padding(horizontal = 8.dp, vertical = 4.dp), contentAlignment = Alignment.Center) {
    RrText(key, style = RrType.mono, color = RrTheme.colors.ink2)
}
