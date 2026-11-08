package me.rxresu.core.designsystem

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class RrBottomSheetWindowTest {
    @get:Rule val rule = createComposeRule()

    // A Galaxy S24 crashed with "Size(1440 x 2147483647) is out of range" opening the month picker from an entry's
    // scrolling fields: the sheet took its parent's unbounded height.
    @Test fun aSheetOpenedInsideScrollingContentGetsItsOwnWindow() {
        rule.setContent {
            RrTheme {
                Column(Modifier.verticalScroll(rememberScrollState())) {
                    RrText("Start")
                    RrBottomSheet(onDismissRequest = {}, fitContent = true, title = "Month") { RrText("July") }
                }
            }
        }
        rule.onNodeWithText("July").assertIsDisplayed()
    }
}
