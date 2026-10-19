package `in`.voicetunesindia.os

import android.Manifest
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.media.MediaRecorder
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** A recording file on the phone */
data class RecordingFile(val uri: Uri, val name: String, val size: Long)

/**
 * Records calls in this app. Android keeps the call's own audio stream for the phone's system dialer, so the
 * app records through the microphone while a call is on: the salesperson clearly, the customer as loud as the
 * phone plays them (clearest on speaker). Android 10+ only lets an app use the microphone during a call while
 * its accessibility service ("Voice Tunes India call recorder") is switched on.
 *
 * Some phones still hand apps silence during calls. A silent recording is thrown away, reported in the app,
 * and the next call is recorded from a different microphone source.
 */
object CallRecorder {
    /** Tried in this order; the first that records sound is remembered */
    private val SOURCES = intArrayOf(
        MediaRecorder.AudioSource.VOICE_RECOGNITION,
        MediaRecorder.AudioSource.MIC,
        MediaRecorder.AudioSource.VOICE_COMMUNICATION,
        MediaRecorder.AudioSource.CAMCORDER,
    )
    /** Loudest moment below this means the phone gave the app silence */
    private const val SILENT_PEAK = 150

    private var recorder: MediaRecorder? = null
    private var file: File? = null
    private var startedAt = 0L
    private var peak = 0
    private var sourceIndex = 0
    private val handler = Handler(Looper.getMainLooper())
    private val sampler = object : Runnable {
        override fun run() {
            val r = recorder ?: return
            try { peak = maxOf(peak, r.maxAmplitude) } catch (e: Exception) { }
            handler.postDelayed(this, 1000)
        }
    }

    val isRecording: Boolean get() = recorder != null

    fun hasMicPermission(context: Context) =
        context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

    /** Whether "Voice Tunes India call recorder" is on in Settings → Accessibility */
    fun accessibilityOn(context: Context): Boolean {
        val enabled = Settings.Secure.getString(context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: return false
        val me = ComponentName(context, RecorderAccessibilityService::class.java)
        return enabled.split(':').any { ComponentName.unflattenFromString(it) == me }
    }

    /** Everything needed to record is in place */
    fun ready(context: Context) = Prefs(context).recordCalls && hasMicPermission(context) && accessibilityOn(context)

    @Suppress("DEPRECATION")
    private fun newRecorder(context: Context) = if (Build.VERSION.SDK_INT >= 31) MediaRecorder(context) else MediaRecorder()

    @Synchronized
    fun start(context: Context): Boolean {
        if (recorder != null) return true
        if (!hasMicPermission(context)) return false
        val prefs = Prefs(context)
        val dir = File(context.filesDir, "recordings").apply { mkdirs() }
        val now = System.currentTimeMillis()
        val out = File(dir, "call-$now.m4a")
        val first = prefs.recordingSource.coerceIn(0, SOURCES.size - 1)
        for (i in SOURCES.indices) {
            val index = (first + i) % SOURCES.size
            val r = newRecorder(context)
            try {
                r.setAudioSource(SOURCES[index])
                r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
                r.setAudioChannels(1)
                r.setAudioSamplingRate(16_000)
                // About 250 KB a minute: plenty for speech to text
                r.setAudioEncodingBitRate(32_000)
                r.setOutputFile(out.absolutePath)
                r.prepare()
                r.start()
                recorder = r
                file = out
                startedAt = now
                peak = 0
                sourceIndex = index
                handler.postDelayed(sampler, 1000)
                return true
            } catch (e: Exception) {
                try { r.release() } catch (ignored: Exception) { }
                out.delete()
            }
        }
        prefs.lastRecordingMessage = "Couldn't start recording — the microphone is blocked during calls on this phone"
        return false
    }

    @Synchronized
    fun stop(context: Context) {
        val r = recorder ?: return
        handler.removeCallbacks(sampler)
        try { peak = maxOf(peak, r.maxAmplitude) } catch (e: Exception) { }
        // stop() throws when nothing was recorded (a call that ended at once)
        val ok = try { r.stop(); true } catch (e: Exception) { false }
        try { r.release() } catch (e: Exception) { }
        recorder = null
        val f = file ?: return
        file = null
        val prefs = Prefs(context)
        val endedAt = System.currentTimeMillis()
        if (!ok || f.length() < 2048) {
            f.delete()
            return
        }
        if (peak < SILENT_PEAK) {
            f.delete()
            prefs.recordingSource = (sourceIndex + 1) % SOURCES.size
            prefs.lastRecordingSilent = true
            prefs.lastRecordingMessage = "The last call recorded silence — this phone may block the microphone during calls. The next call tries another way; putting calls on speaker also helps."
            return
        }
        prefs.recordingSource = sourceIndex
        prefs.lastRecordingSilent = false
        LocalRecordings.add(context, f, startedAt, endedAt)
        prefs.lastRecordingMessage = "Last call recorded (${CallSync.formatDuration(((endedAt - startedAt) / 1000).toInt())})"
    }
}

/** Recordings made by CallRecorder that haven't been uploaded yet (kept in the app's private storage) */
object LocalRecordings {
    private const val KEY = "localRecordings"
    /** A call-log entry starts when the call is dialled or rings; recording starts when it connects */
    private const val MATCH_BEFORE_MS = 15_000L
    private const val MATCH_AFTER_MS = 3 * 60_000L
    private const val KEEP_MS = 24 * 3600_000L

    private data class Entry(val path: String, val startedAt: Long, val endedAt: Long)

    private fun sp(context: Context) = context.getSharedPreferences("voicetunes_calls", Context.MODE_PRIVATE)

    private fun load(context: Context): MutableList<Entry> {
        val arr = try { JSONArray(sp(context).getString(KEY, "[]")) } catch (e: Exception) { JSONArray() }
        return (0 until arr.length()).mapNotNull { i ->
            arr.optJSONObject(i)?.let { Entry(it.optString("path"), it.optLong("startedAt"), it.optLong("endedAt")) }
        }.toMutableList()
    }

    private fun save(context: Context, list: List<Entry>) {
        val arr = JSONArray()
        list.forEach { arr.put(JSONObject().put("path", it.path).put("startedAt", it.startedAt).put("endedAt", it.endedAt)) }
        sp(context).edit().putString(KEY, arr.toString()).apply()
    }

    @Synchronized
    fun add(context: Context, file: File, startedAt: Long, endedAt: Long) {
        val now = System.currentTimeMillis()
        val list = load(context)
        // Recordings nobody claimed within a day belong to calls the CRM doesn't keep
        list.filter { now - it.endedAt > KEEP_MS }.forEach { File(it.path).delete() }
        list.removeAll { now - it.endedAt > KEEP_MS || !File(it.path).exists() }
        list += Entry(file.absolutePath, startedAt, endedAt)
        save(context, list)
    }

    fun count(context: Context) = load(context).size

    /** The recording of a call from the call log, if this app recorded it */
    @Synchronized
    fun find(context: Context, call: PendingRecording): RecordingFile? {
        val match = load(context)
            .filter { it.startedAt in (call.startedAt - MATCH_BEFORE_MS)..(call.startedAt + MATCH_AFTER_MS) && File(it.path).exists() }
            .minByOrNull { kotlin.math.abs(it.startedAt - call.startedAt) }
            ?: return null
        val f = File(match.path)
        return RecordingFile(Uri.fromFile(f), f.name, f.length())
    }

    /** Uploaded, or not wanted by the CRM: the file is deleted from the phone */
    @Synchronized
    fun remove(context: Context, file: RecordingFile) {
        val path = file.uri.path ?: return
        File(path).delete()
        save(context, load(context).filter { it.path != path })
    }

    @Synchronized
    fun clear(context: Context) {
        load(context).forEach { File(it.path).delete() }
        sp(context).edit().remove(KEY).apply()
    }
}
