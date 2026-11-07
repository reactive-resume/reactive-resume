package me.rxresu.feature.builder

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import me.rxresu.core.network.generated.CreateImprovementRequestAction
import me.rxresu.core.network.generated.CreateResumeJobMatchResponseFoundItem

internal class PickedPhoto(val bytes: ByteArray, val name: String, val type: String)

/** A job saved from a pasted posting ("Save as a job…"): company and role are required. */
internal data class NewJob(val company: String, val role: String, val posting: String)

/** What Improve was asked, and who it was sent to (for the disclosure line). */
internal data class ImproveRequest(val line: String, val action: CreateImprovementRequestAction, val request: String?, val provider: String, val model: String)

internal sealed interface ImproveState {
    data object Idle : ImproveState
    /** No enabled, tested AI provider: Improve opens "Set up AI". */
    data object NoProvider : ImproveState
    data class Working(val asked: ImproveRequest) : ImproveState
    data class Ready(val asked: ImproveRequest, val text: String, val why: String, val addsFacts: Boolean, val operations: List<String>) : ImproveState
    data class Failed(val asked: ImproveRequest) : ImproveState
}

internal data class MatchTerm(val term: String, val label: String, val postingCount: Int) {
    constructor(item: CreateResumeJobMatchResponseFoundItem) : this(item.term, item.label, item.jdCount.toInt())
}

internal sealed interface MatchState {
    data object Idle : MatchState
    /** Not linked, or the linked application has no posting: paste one. */
    data object NoPosting : MatchState
    data object Reading : MatchState
    data class Failed(val pasted: String?) : MatchState
    /** [pasted] is the posting text when it came from a paste ("For this visit only"). */
    data class Ready(val found: List<MatchTerm>, val missing: List<MatchTerm>, val pasted: String?) : MatchState {
        val total get() = found.size + missing.size
    }
}

/** The web's Fit steps (design/presets.ts `nextFitStep`): compact density, narrow margins, then 0.5 pt smaller to 9 pt. */
internal object FitSteps {
    fun next(json: JsonObject): ((JsonObject) -> JsonObject)? {
        val meta = listOf("data", "metadata")
        val body = json.at(meta + listOf("typography", "body")).obj()
        val page = json.at(meta + "page").obj()
        val lineHeight = body["lineHeight"].num() ?: 1.5
        val size = body["fontSize"].num() ?: 10.0
        return when {
            lineHeight > Density.Compact.lineHeight || (page["gapY"].num() ?: 6.0) > Density.Compact.gapY -> { j -> Density.Compact.apply(j) }
            (page["marginX"].num() ?: 14.0) > Margins.Narrow.x || (page["marginY"].num() ?: 12.0) > Margins.Narrow.y -> { j -> Margins.Narrow.apply(j) }
            size > 9.0 -> { j -> TextSize.apply(j, (size - 0.5).coerceAtLeast(9.0)) }
            else -> null
        }
    }
}

/** Density writes body line height and the gap between sections (web presets.ts). */
internal enum class Density(val lineHeight: Double, val gapY: Double) {
    Compact(1.35, 4.0), Normal(1.5, 6.0), Roomy(1.65, 8.0);

    fun apply(json: JsonObject): JsonObject = json
        .set(listOf("data", "metadata", "typography", "body", "lineHeight"), JsonPrimitive(lineHeight))
        .set(listOf("data", "metadata", "page", "gapY"), JsonPrimitive(gapY)) as JsonObject

    companion object {
        fun of(json: JsonObject): Density? {
            val lh = json.at(listOf("data", "metadata", "typography", "body", "lineHeight")).num()
            val gap = json.at(listOf("data", "metadata", "page", "gapY")).num()
            return entries.firstOrNull { it.lineHeight == lh && it.gapY == gap }
        }
    }
}

/** Margins write marginX / marginY in pt (web presets.ts). */
internal enum class Margins(val x: Double, val y: Double) {
    Narrow(10.0, 8.0), Normal(14.0, 12.0), Wide(19.0, 16.0);

    fun apply(json: JsonObject): JsonObject = json
        .set(listOf("data", "metadata", "page", "marginX"), JsonPrimitive(x))
        .set(listOf("data", "metadata", "page", "marginY"), JsonPrimitive(y)) as JsonObject

    companion object {
        fun of(json: JsonObject): Margins? {
            val page = json.at(listOf("data", "metadata", "page")).obj()
            return entries.firstOrNull { it.x == page["marginX"].num() && it.y == page["marginY"].num() }
        }
    }
}

/** Text size moves the body size; the heading keeps its ratio, rounded to 0.5 pt (web presets.ts). */
internal object TextSize {
    const val MIN = 9.0
    const val MAX = 12.5

    fun apply(json: JsonObject, size: Double): JsonObject {
        val typography = listOf("data", "metadata", "typography")
        val body = json.at(typography + listOf("body", "fontSize")).num() ?: size
        val heading = json.at(typography + listOf("heading", "fontSize")).num() ?: body
        val nextHeading = Math.round(size * (heading / body) * 2) / 2.0
        return json.set(typography + listOf("body", "fontSize"), JsonPrimitive(size))
            .set(typography + listOf("heading", "fontSize"), JsonPrimitive(nextHeading)) as JsonObject
    }
}

internal sealed interface PdfCheckState {
    data object Idle : PdfCheckState
    data object Checking : PdfCheckState
    data class Done(val findings: Int) : PdfCheckState
}

/** One note from the saved writing review: where, what a reader might trip on, and a rewrite. */
internal data class WritingNote(val where: String, val issue: String, val rewrite: String)

/** The AI provider Improve uses: id, label and model for the disclosure line. */
internal data class AiProvider(val id: String, val label: String, val model: String)
