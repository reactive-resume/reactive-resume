// Spoken answers (W4 Practice and Debrief): the microphone behind a small interface, the 2-minute / 2 MB rules, and
// which AI connection transcribes. The take stays on the device until the person stops; then it goes to transcription.
package me.rxresu.feature.workspace

import android.content.Context
import android.media.MediaRecorder
import android.os.Build
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import me.rxresu.core.network.generated.TestAiProviderResponse

/** The microphone. [start] throws when it can't record; [stop] returns the take's bytes (empty when nothing was kept). */
internal interface VoiceRecorder {
    fun start()
    /** Peak amplitude since the last call, 0..32767. */
    fun level(): Int
    fun stop(): ByteArray
    fun cancel()
}

/** AAC in MPEG-4 (.m4a), mono speech quality: 48 kbps × 120 s is about 720 KB, well under the 2 MB cap. */
internal class MediaVoiceRecorder(private val context: Context) : VoiceRecorder {
    private var recorder: MediaRecorder? = null
    private var file: File? = null

    override fun start() {
        val out = File.createTempFile("answer", ".m4a", context.cacheDir)
        val r = if (Build.VERSION.SDK_INT >= 31) MediaRecorder(context) else @Suppress("DEPRECATION") MediaRecorder()
        try {
            r.setAudioSource(MediaRecorder.AudioSource.MIC)
            r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            r.setAudioSamplingRate(22_050)
            r.setAudioChannels(1)
            r.setAudioEncodingBitRate(48_000)
            r.setOutputFile(out.absolutePath)
            r.prepare()
            r.start()
        } catch (e: Exception) {
            r.release()
            out.delete()
            throw e
        }
        recorder = r
        file = out
    }

    override fun level(): Int = runCatching { recorder?.maxAmplitude ?: 0 }.getOrDefault(0)

    override fun stop(): ByteArray {
        val r = recorder ?: return ByteArray(0)
        // stop() throws when no audio was captured yet: that take is empty.
        val captured = runCatching { r.stop() }.isSuccess
        r.release()
        recorder = null
        val bytes = if (captured) file?.readBytes() ?: ByteArray(0) else ByteArray(0)
        file?.delete()
        file = null
        return bytes
    }

    override fun cancel() {
        recorder?.let { runCatching { it.stop() }; it.release() }
        recorder = null
        file?.delete()
        file = null
    }
}

/** What a stopped recording produced. */
internal sealed interface Take {
    val atLimit: Boolean
    data class Audio(val bytes: ByteArray, override val atLimit: Boolean) : Take
    /** Nothing captured, or over 2 MB: "That recording was empty or over 2 MB. Try a shorter answer." */
    data class Unusable(override val atLimit: Boolean) : Take
}

internal data class RecordingState(val recording: Boolean = false, val elapsedMs: Long = 0, val levels: List<Float> = emptyList())

/**
 * Runs one take at a time: samples the mic level about 15 times a second for the waveform, stops itself at 2:00 and
 * hands the take to [onTake]. [now] is a monotonic clock in ms (virtual time in tests).
 */
internal class Recording(
    private val scope: CoroutineScope,
    private val recorder: VoiceRecorder,
    private val now: () -> Long,
    private val onTake: (Take) -> Unit,
) {
    val state = MutableStateFlow(RecordingState())
    private var ticker: Job? = null

    /** Returns false when the microphone couldn't start. */
    fun start(): Boolean {
        if (state.value.recording) return true
        try { recorder.start() } catch (_: Exception) { return false }
        val started = now()
        state.value = RecordingState(recording = true)
        ticker = scope.launch {
            while (isActive) {
                delay(FRAME_MS)
                val elapsed = now() - started
                val level = (recorder.level() / 32767f).coerceIn(0f, 1f)
                state.value = state.value.copy(elapsedMs = elapsed, levels = (state.value.levels + level).takeLast(BARS))
                if (elapsed >= MAX_MS) { stop(atLimit = true); break }
            }
        }
        return true
    }

    fun stop(atLimit: Boolean = false) {
        if (!state.value.recording) return
        ticker?.cancel()
        val bytes = recorder.stop()
        state.value = state.value.copy(recording = false)
        onTake(if (bytes.isEmpty() || bytes.size > MAX_BYTES) Take.Unusable(atLimit) else Take.Audio(bytes, atLimit))
    }

    fun cancel() {
        ticker?.cancel()
        recorder.cancel()
        state.value = RecordingState()
    }

    companion object {
        const val MAX_MS = 120_000L
        /** `career.voice.transcribe` refuses audio over 2 MB. */
        const val MAX_BYTES = 2 * 1024 * 1024
        const val FRAME_MS = 66L
        const val BARS = 20
    }
}

/** "0:48" */
internal fun clock(ms: Long): String = (ms / 1000).let { "%d:%02d".format(java.util.Locale.ROOT, it / 60, it % 60) }

/** Transcription models per provider kind; a copy of `AI_VOICE_MODELS` in packages/ai/src/types.ts. */
private val TranscriptionModels = mapOf(
    "openai" to "gpt-4o-mini-transcribe",
    "gemini" to "gemini-3.5-transcribe",
    "mistral" to "voxtral-mini-latest",
    "xai" to "grok-voice-transcribe-2.0",
    "groq" to "whisper-large-v3-turbo",
    "vercel-ai-gateway" to "openai/gpt-4o-mini-transcribe",
)

internal data class Transcriber(val providerId: String, val label: String, val model: String)

/** The connection that transcribes answers: the default one when it can, else the first that can. Null: type instead. */
internal fun chooseTranscriber(providers: List<TestAiProviderResponse>): Transcriber? =
    providers.sortedByDescending { it.isDefault }.firstNotNullOfOrNull { p ->
        TranscriptionModels[p.provider.wireValue]?.let { Transcriber(p.id, p.label, it) }
    }
