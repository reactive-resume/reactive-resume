package me.rxresu.feature.letters

import androidx.compose.runtime.CompositionLocalProvider
import kotlinx.coroutines.runBlocking
import me.rxresu.core.data.*
import me.rxresu.core.testing.*
import org.junit.Test

class LetterVariantsTest : RrScreenshotTest() {
    private fun capture(picker: String, dark: Boolean) {
        val repositories = FakeRepositories()
        val store = androidx.lifecycle.ViewModelStore()
        try {
            val letter = runBlocking { repositories.letters.openDraft(StoryboardIds.lumenLetter).state.value.document!! }
            val vm = LetterViewModel(repositories, letter.id)
            store.put("letter", vm)
            val state = LetterState(draft = DraftState(letter.copy(designLinked = false)), loading = false, versions = runBlocking { repositories.letters.listCoverLetterVersions(letter.id) })
            captureScreen("L2-Letter" + picker.replaceFirstChar(Char::uppercase), dark, wrap = { content -> CompositionLocalProvider(LocalRepositories provides repositories) { content() } }) {
                when (picker) {
                    "type" -> LetterTypeSheet(state, {}, {}, {})
                    "page" -> LetterPageSheet(state, {}, {})
                    "color" -> LetterColorSheet(state, {}, {})
                    "versions" -> LetterVersionsScreen(state, {}, {}, {}, {}, {})
                    "restore" -> LetterRestoreSheet(state, {}, {})
                    "more" -> LetterMoreMenu(state, {}) {}
                    else -> LetterDesignPickerScreen(state, picker, vm, {})
                }
            }
        } finally { store.clear(); repositories.close() }
    }
    @Test fun typeLight() = capture("type", false)
    @Test fun typeDark() = capture("type", true)
    @Test fun pageLight() = capture("page", false)
    @Test fun pageDark() = capture("page", true)
    @Test fun colorLight() = capture("color", false)
    @Test fun colorDark() = capture("color", true)
    @Test fun signatureLight() = capture("signature", false)
    @Test fun signatureDark() = capture("signature", true)
    @Test fun letterheadLight() = capture("letterhead", false)
    @Test fun letterheadDark() = capture("letterhead", true)
    @Test fun versionsLight() = capture("versions", false)
    @Test fun versionsDark() = capture("versions", true)
    @Test fun restoreLight() = capture("restore", false)
    @Test fun restoreDark() = capture("restore", true)
    @Test fun moreLight() = capture("more", false)
    @Test fun moreDark() = capture("more", true)
}
