package `in`.voicetunesindia.os

import android.content.Context
import android.net.ConnectivityManager
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException

/** A connected call whose recording still has to be uploaded */
data class PendingRecording(
    val phone: String,
    val direction: String,
    val startedAt: Long,
    val durationSec: Long,
    val contactName: String?,
    val queuedAt: Long,
)

/**
 * Uploads this app's call recordings (CallRecorder) to the CRM, which transcribes them. Connected calls are queued
 * once the call log has reached the CRM, and each is matched to the recording made while it was on. A recording
 * goes up in three steps: ask the CRM where to put it (it answers "skip" for calls it doesn't keep, e.g. personal
 * calls on a personal phone), send the file, confirm. It is then deleted from the phone.
 */
object RecordingUploader {
    const val KEY = "pendingRecordings"
    private const val MAX_QUEUE = 300
    /**
     * The recording is saved the moment the call ends, before the call reaches the CRM. A call without one
     * (recording off, or silent) is kept only briefly, in case a call right after it is still being recorded.
     */
    private const val NO_RECORDING_GRACE_MS = 2 * 60_000L
    /** Calls whose upload keeps failing (no connection) are given up after this */
    private const val GIVE_UP_AFTER_MS = 24 * 3600_000L

    private fun sp(context: Context) = context.getSharedPreferences("voicetunes_calls", Context.MODE_PRIVATE)

    private fun load(context: Context): MutableList<PendingRecording> {
        val list = try { JSONArray(sp(context).getString(KEY, "[]")) } catch (e: Exception) { JSONArray() }
        return (0 until list.length()).mapNotNull { i ->
            val o = list.optJSONObject(i) ?: return@mapNotNull null
            PendingRecording(
                o.optString("phone"), o.optString("direction"), o.optLong("startedAt"), o.optLong("durationSec"),
                o.optString("contactName").ifEmpty { null }, o.optLong("queuedAt"),
            )
        }.toMutableList()
    }

    private fun save(context: Context, items: List<PendingRecording>) {
        val arr = JSONArray()
        items.takeLast(MAX_QUEUE).forEach {
            arr.put(JSONObject().put("phone", it.phone).put("direction", it.direction).put("startedAt", it.startedAt)
                .put("durationSec", it.durationSec).put("contactName", it.contactName ?: "").put("queuedAt", it.queuedAt))
        }
        sp(context).edit().putString(KEY, arr.toString()).apply()
    }

    fun count(context: Context): Int = load(context).size

    /** Called after the CRM accepted a batch of calls: queue the ones where someone talked */
    @Synchronized
    fun enqueue(context: Context, calls: List<PhoneCall>) {
        if (!Prefs(context).recordCalls && LocalRecordings.count(context) == 0) return
        val talked = calls.filter { it.durationSec > 0 && (it.direction == "outgoing" || it.direction == "incoming") }
        if (talked.isEmpty()) return
        val items = load(context)
        val now = System.currentTimeMillis()
        talked.forEach { c ->
            if (items.none { it.startedAt == c.startedAt && it.phone == c.phone }) {
                items += PendingRecording(c.phone, c.direction, c.startedAt, c.durationSec, c.contactName, now)
            }
        }
        save(context, items)
    }

    /** Uploads the recording of every queued call. Returns how many were uploaded. */
    @Synchronized
    fun flush(context: Context): Int {
        val prefs = Prefs(context)
        val items = load(context)
        if (items.isEmpty()) return 0
        if (prefs.recordingsWifiOnly && isMetered(context)) {
            prefs.lastRecordingMessage = "${items.size} recording${if (items.size == 1) "" else "s"} waiting for Wi-Fi"
            return 0
        }
        val api = ApiClient(prefs)
        val remaining = ArrayList<PendingRecording>()
        var uploaded = 0
        var lastError: String? = null
        val now = System.currentTimeMillis()
        for ((index, call) in items.withIndex()) {
            if (now - call.queuedAt > GIVE_UP_AFTER_MS) continue
            val file = LocalRecordings.find(context, call)
            if (file == null) {
                if (now - call.queuedAt < NO_RECORDING_GRACE_MS || CallRecorder.isRecording) remaining += call
                continue
            }
            try {
                if (upload(context, api, call, file)) uploaded++
                LocalRecordings.remove(context, file)
            } catch (e: AuthExpiredException) {
                remaining += call
                remaining += items.drop(index + 1)
                save(context, remaining)
                throw e
            } catch (e: ApiException) {
                // Refused (e.g. too large): trying again won't help, unless the CRM itself had a problem
                if (e.status >= 500) remaining += call else LocalRecordings.remove(context, file)
                lastError = e.message
            } catch (e: IOException) {
                remaining += call
                lastError = e.message
            }
        }
        save(context, remaining)
        prefs.lastRecordingMessage = when {
            lastError != null -> "Recording upload problem: $lastError"
            uploaded > 0 -> "Uploaded $uploaded recording${if (uploaded == 1) "" else "s"} to the CRM"
            else -> prefs.lastRecordingMessage
        }
        return uploaded
    }

    /** Whether a queued call may still get its recording (one is being recorded or was just saved) */
    fun hasFreshPending(context: Context): Boolean {
        val now = System.currentTimeMillis()
        return load(context).any { now - it.queuedAt < NO_RECORDING_GRACE_MS }
    }

    /** start → PUT the file → complete. False when the CRM doesn't want this recording. */
    private fun upload(context: Context, api: ApiClient, call: PendingRecording, file: RecordingFile): Boolean {
        val start = api.post("/calls/recordings/start", JSONObject()
            .put("phone", call.phone)
            .put("direction", call.direction)
            .put("startedAt", call.startedAt)
            .put("durationSec", call.durationSec)
            .put("fileName", file.name)
            .put("sizeBytes", file.size))
        if (start.optString("status") != "upload") return false
        val id = start.getString("recordingId")
        val contentType = start.optString("contentType", "application/octet-stream")
        val directUrl = start.optString("uploadUrl").takeIf { it.isNotEmpty() && it != "null" }
        val open = { context.contentResolver.openInputStream(file.uri) ?: throw IOException("Can't open ${file.name}") }
        if (directUrl != null) api.putFile(directUrl, apiPath = false, contentType, file.size, open)
        else api.putFile("/calls/recordings/$id/content", apiPath = true, contentType, file.size, open)
        api.post("/calls/recordings/$id/complete", JSONObject())
        return true
    }

    private fun isMetered(context: Context): Boolean =
        context.getSystemService(ConnectivityManager::class.java)?.isActiveNetworkMetered ?: true
}
