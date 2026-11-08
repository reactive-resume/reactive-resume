package me.rxresu.core.page

import android.graphics.RectF
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class PdfTextTest {
    @Test fun contentsSplitIntoLines() {
        val r = PdfText.runs(listOf("Northwind Labs\nSenior designer" to listOf(RectF(10f, 20f, 100f, 30f), RectF(10f, 32f, 90f, 42f))), 200, 400)
        assertEquals(listOf("Northwind Labs", "Senior designer"), r.map { it.text })
        assertEquals(0.05f, r[0].left, 0.0001f)
        assertEquals(0.08f, r[1].top, 0.0001f)
    }

    @Test fun linesWithoutBoundsAreLocatedBySearchInReadingOrder() {
        // Forme PDFs: one content per page, no bounds. The second "Expert" takes the second match.
        val contents = listOf("Skills\nExpert\nUnity\nExpert" to emptyList<RectF>())
        val matches = mapOf(
            "Skills" to listOf(listOf(RectF(10f, 10f, 60f, 20f))),
            "Expert" to listOf(listOf(RectF(10f, 30f, 50f, 40f)), listOf(RectF(10f, 70f, 50f, 80f))),
            "Unity" to listOf(listOf(RectF(10f, 50f, 50f, 60f))),
        )
        val runs = PdfText.located(contents, 100, 100) { matches[it].orEmpty() }
        assertEquals(listOf("Skills", "Expert", "Unity", "Expert"), runs.map { it.text })
        assertEquals(0.7f, runs.last().top, 0.0001f)
    }
}
