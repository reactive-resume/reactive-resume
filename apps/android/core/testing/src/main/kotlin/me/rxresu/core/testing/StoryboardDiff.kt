package me.rxresu.core.testing

import java.awt.Color
import java.awt.image.BufferedImage
import java.io.File
import java.util.Locale
import javax.imageio.ImageIO
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/**
 * Side-by-side comparison of a capture with its storyboard image. A report, never an assertion: it writes
 * `build/reports/storyboard-diff/<name>.png` (storyboard | capture | difference), `<name>.txt` (the percentage) and an
 * `index.html` for the module, and does nothing when the handoff folder is absent (CI has no copy of it).
 *
 * The handoff folder is found from `RR_HANDOFF_DIR` (environment) or the `rr.handoff.dir` system property, otherwise at
 * `.agents/handoff/android-app` in the repository that owns the working directory (a git worktree resolves to its main
 * checkout).
 */
object StoryboardDiff {
    /** A channel difference above this (0–255) marks the pixel as different; absorbs anti-aliasing noise. */
    const val CHANNEL_TOLERANCE = 24

    data class Result(val name: String, val differentPixels: Long, val totalPixels: Long, val sizeNote: String?) {
        val percent: Double get() = if (totalPixels == 0L) 0.0 else differentPixels * 100.0 / totalPixels
    }

    /** The handoff root (`…/.agents/handoff/android-app`), or null when this machine has none. */
    fun handoffDir(
        start: File = File("").absoluteFile,
        configuredPath: String? = System.getenv("RR_HANDOFF_DIR") ?: System.getProperty("rr.handoff.dir"),
    ): File? {
        configuredPath?.let { return File(it).takeIf(File::isDirectory) }
        var dir: File? = start
        while (dir != null) {
            File(dir, ".agents/handoff/android-app").takeIf(File::isDirectory)?.let { return it }
            val git = File(dir, ".git")
            if (git.isFile) {
                // Worktree: "gitdir: <main>/.git/worktrees/<name>".
                val gitDir = git.readText().removePrefix("gitdir:").trim()
                val main = File(gitDir).parentFile?.parentFile?.parentFile
                if (main != null) File(main, ".agents/handoff/android-app").takeIf(File::isDirectory)?.let { return it }
            }
            dir = dir.parentFile
        }
        return null
    }

    /**
     * Compares [capture] with `<handoff>/<reference>` and writes the report into [reportDir]. Returns null when the
     * handoff, the reference or the capture is missing.
     */
    fun report(
        capture: File,
        reference: String,
        name: String,
        reportDir: File = File("build/reports/storyboard-diff"),
        handoff: File? = handoffDir(),
    ): Result? {
        val refFile = handoff?.let { File(it, reference) } ?: return null
        if (!refFile.isFile || !capture.isFile) return null
        val ref = ImageIO.read(refFile) ?: return null
        val cap = ImageIO.read(capture) ?: return null
        val (result, image) = compare(ref, cap, name)
        reportDir.mkdirs()
        ImageIO.write(image, "png", File(reportDir, "$name.png"))
        File(reportDir, "$name.txt").writeText(
            String.format(Locale.ROOT, "%.2f\n%s\n", result.percent, result.sizeNote.orEmpty()),
        )
        writeIndex(reportDir)
        return result
    }

    /** Pixel comparison over the shared area plus the side-by-side image. Pure: used by [report] and its test. */
    fun compare(reference: BufferedImage, capture: BufferedImage, name: String): Pair<Result, BufferedImage> {
        val w = min(reference.width, capture.width)
        val h = min(reference.height, capture.height)
        val sizeNote = if (reference.width != capture.width || reference.height != capture.height) {
            "Size differs: storyboard ${reference.width}×${reference.height}, capture ${capture.width}×${capture.height}"
        } else null
        val outW = reference.width + capture.width + w
        val outH = max(reference.height, capture.height)
        val out = BufferedImage(outW, outH, BufferedImage.TYPE_INT_RGB)
        val g = out.createGraphics()
        g.color = Color.WHITE
        g.fillRect(0, 0, outW, outH)
        g.drawImage(reference, 0, 0, null)
        g.drawImage(capture, reference.width, 0, null)
        g.dispose()
        var different = 0L
        val ox = reference.width + capture.width
        for (y in 0 until h) for (x in 0 until w) {
            val a = reference.getRGB(x, y)
            val b = capture.getRGB(x, y)
            val diff = channelDiff(a, b) > CHANNEL_TOLERANCE
            if (diff) different++
            out.setRGB(ox + x, y, if (diff) 0xFFE5484D.toInt() else faded(b))
        }
        return Result(name, different, w.toLong() * h, sizeNote) to out
    }

    private fun channelDiff(a: Int, b: Int): Int {
        var m = 0
        for (shift in intArrayOf(16, 8, 0)) m = max(m, abs((a shr shift and 0xFF) - (b shr shift and 0xFF)))
        return m
    }

    /** Capture pixel washed toward white so the red differences stand out. */
    private fun faded(rgb: Int): Int {
        fun ch(shift: Int) = 255 - (255 - (rgb shr shift and 0xFF)) / 4
        return (0xFF shl 24) or (ch(16) shl 16) or (ch(8) shl 8) or ch(0)
    }

    private fun writeIndex(dir: File) {
        val rows = dir.listFiles { f -> f.extension == "txt" }.orEmpty().sortedBy { it.name }.joinToString("\n") { txt ->
            val lines = txt.readLines()
            val name = txt.nameWithoutExtension
            val note = lines.getOrNull(1).orEmpty()
            "<tr><td><a href=\"$name.png\">$name</a></td><td>${lines.firstOrNull().orEmpty()}%</td><td>$note</td></tr>"
        }
        File(dir, "index.html").writeText(
            """
            <!doctype html><meta charset="utf-8"><title>Storyboard diff</title>
            <style>body{font:14px system-ui;margin:24px}td,th{padding:4px 12px;text-align:left}</style>
            <h1>Storyboard diff</h1>
            <p>Each image: storyboard, capture, then differences in red (channel tolerance $CHANNEL_TOLERANCE).</p>
            <table><tr><th>Capture</th><th>Different pixels</th><th>Note</th></tr>
            $rows
            </table>
            """.trimIndent(),
        )
    }
}
