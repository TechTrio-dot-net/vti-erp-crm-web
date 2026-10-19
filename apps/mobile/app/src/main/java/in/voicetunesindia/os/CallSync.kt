package `in`.voicetunesindia.os

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar

data class SyncResult(val sent: Int, val matched: Int, val todayCalls: Int, val todayConnected: Int, val todayTalkSec: Int)

/** Sends new call-log entries to the CRM in batches and advances the sync cursor only after the server accepts them */
object CallSync {
    private const val BATCH = 500

    fun hasPermission(context: Context) =
        context.checkSelfPermission(Manifest.permission.READ_CALL_LOG) == PackageManager.PERMISSION_GRANTED

    @SuppressLint("HardwareIds")
    fun deviceId(context: Context) =
        Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID) ?: "unknown"

    /** First sync after sign-in starts from the beginning of today, so older personal history is never sent */
    private fun startOfToday(): Long = Calendar.getInstance().apply {
        set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
    }.timeInMillis

    @Synchronized
    fun run(context: Context): SyncResult {
        val prefs = Prefs(context)
        if (!prefs.isSignedIn) throw AuthExpiredException()
        val api = ApiClient(prefs)
        val permission = hasPermission(context)
        if (prefs.lastCallTimestamp == 0L) prefs.lastCallTimestamp = startOfToday()

        val calls = if (permission) CallLogReader.readSince(context, prefs.lastCallTimestamp) else emptyList()
        var sent = 0
        var matched = 0
        var last: JSONObject? = null
        // Always send at least one request, so the CRM knows the phone is alive even with no new calls
        val batches = if (calls.isEmpty()) listOf(emptyList()) else calls.chunked(BATCH)
        for (batch in batches) {
            val body = JSONObject()
                .put("deviceId", deviceId(context))
                .put("deviceName", "${Build.MANUFACTURER} ${Build.MODEL}".trim())
                .put("appVersion", BuildConfig.VERSION_NAME)
                .put("permissionGranted", permission)
                .put("leadsOnly", prefs.leadsOnly)
                .put("calls", JSONArray().apply {
                    batch.forEach {
                        put(JSONObject()
                            .put("phone", it.phone)
                            .put("direction", it.direction)
                            .put("startedAt", it.startedAt)
                            .put("durationSec", it.durationSec)
                            .put("contactName", it.contactName ?: JSONObject.NULL))
                    }
                })
            last = api.post("/calls/device-sync", body)
            sent += last.optInt("inserted")
            matched += last.optInt("matched")
            batch.maxOfOrNull { it.startedAt }?.let { prefs.lastCallTimestamp = it }
            // The CRM has these calls now, so their recordings can be attached to them
            RecordingUploader.enqueue(context, batch)
        }
        val today = last?.optJSONObject("today")
        val result = SyncResult(sent, matched, today?.optInt("calls") ?: 0, today?.optInt("connected") ?: 0, today?.optInt("talkSec") ?: 0)
        prefs.lastSyncAt = System.currentTimeMillis()
        if (today != null) prefs.todayStats = "${todayKey()}|${result.todayCalls}|${result.todayConnected}|${result.todayTalkSec}"
        prefs.lastSyncMessage = if (!permission) "Call log permission is off — nothing can be synced"
        else "Today: ${result.todayCalls} calls · ${result.todayConnected} connected · talk ${formatDuration(result.todayTalkSec)}"
        return result
    }

    fun todayKey(): String = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).format(java.util.Date())

    /** Calls, connected and talk seconds from today's last sync; zeros once the day has changed */
    fun todayStats(prefs: Prefs): Triple<Int, Int, Int> {
        val parts = prefs.todayStats.split('|')
        if (parts.size != 4 || parts[0] != todayKey()) return Triple(0, 0, 0)
        return Triple(parts[1].toIntOrNull() ?: 0, parts[2].toIntOrNull() ?: 0, parts[3].toIntOrNull() ?: 0)
    }

    fun formatDuration(sec: Int): String {
        val h = sec / 3600
        val m = (sec % 3600) / 60
        val s = sec % 60
        return when {
            h > 0 -> "${h}h ${m}m"
            m > 0 -> "${m}m ${s}s"
            else -> "${s}s"
        }
    }
}
