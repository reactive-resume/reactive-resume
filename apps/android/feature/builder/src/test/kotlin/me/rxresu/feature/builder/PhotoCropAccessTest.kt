package me.rxresu.feature.builder

import android.graphics.Bitmap
import android.graphics.Rect
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import me.rxresu.core.designsystem.RrTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * B5 Crop photo without dragging. Its own Robolectric sandbox (legacy graphics; no pixels are compared): sharing one with
 * the screenshot captures left the builder's later Design captures without their docked sheet.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], qualifiers = "w390dp-h844dp-xhdpi")
@GraphicsMode(GraphicsMode.Mode.LEGACY)
class PhotoCropAccessTest {
    @get:Rule val rule = createComposeRule()

    private fun photo() = Bitmap.createBitmap(800, 400, Bitmap.Config.ARGB_8888)

    @Test fun cropPositionWorksWithoutDragging() {
        val areas = mutableListOf<Rect>()
        rule.setContent { RrTheme(darkTheme = false) { PhotoCropScreen(PhotoCrop(photo(), "photo.png", "image/png"), 1f, {}) { areas += it } } }
        val crop = rule.onNodeWithText("Crop and upload")
        crop.performClick()
        val centred = areas.last()
        val position = rule.onNodeWithContentDescription("Photo position")
        // TalkBack: Move photo left twice shows more of the photo's right side.
        repeat(2) { position.performCustomAction("Move photo left") }
        crop.performClick()
        assertEquals(centred.width(), areas.last().width())
        assertEquals(true, areas.last().left > centred.left)
        position.performCustomAction("Center photo")
        crop.performClick()
        assertEquals(centred, areas.last())
    }

    @Test fun arrowKeysStepTheCropOneTenthOfTheFrame() {
        assertEquals(-1 to 0, CropMath.keyStep(androidx.compose.ui.input.key.Key.DirectionLeft))
        assertEquals(1 to 0, CropMath.keyStep(androidx.compose.ui.input.key.Key.DirectionRight))
        assertEquals(0 to -1, CropMath.keyStep(androidx.compose.ui.input.key.Key.DirectionUp))
        assertEquals(0 to 1, CropMath.keyStep(androidx.compose.ui.input.key.Key.DirectionDown))
        assertEquals(null, CropMath.keyStep(androidx.compose.ui.input.key.Key.Tab))
    }

    private fun androidx.compose.ui.test.SemanticsNodeInteraction.performCustomAction(label: String) {
        val action = fetchSemanticsNode().config[SemanticsActions.CustomActions].first { it.label == label }
        rule.runOnIdle { action.action() }
    }
}
