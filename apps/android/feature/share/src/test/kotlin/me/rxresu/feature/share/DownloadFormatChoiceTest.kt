package me.rxresu.feature.share

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import me.rxresu.core.designsystem.RrTheme
import me.rxresu.core.navigation.DocumentKind
import me.rxresu.core.testing.RrScreenshotTest
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class DownloadFormatChoiceTest : RrScreenshotTest() {
    @get:Rule val rule = createComposeRule()

    @Test fun wordChoiceKeepsOpenDocumentReachableWithoutAnotherRootControl() {
        var format by mutableStateOf(FileFormat.Pdf)
        rule.setContent {
            RrTheme(reducedMotion = true) {
                Box(Modifier.fillMaxSize()) {
                    DownloadContent(ExportState(name = "Alex Morgan Resume", format = format), DocumentKind.Resume, { format = it }, {})
                }
            }
        }
        rule.onNodeWithText("More formats").assertDoesNotExist()
        rule.onNodeWithText("Word").performClick()
        rule.onNodeWithText("OpenDocument").performClick()
        rule.runOnIdle { assertEquals(FileFormat.OpenDocument, format) }
        rule.onNodeWithText("More formats").assertDoesNotExist()
        rule.onNodeWithText("OpenDocument").performClick()
        rule.onNodeWithText("Word").performClick()
        rule.runOnIdle { assertEquals(FileFormat.Word, format) }
    }
}
