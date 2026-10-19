package `in`.voicetunesindia.os

import android.content.Context
import android.content.SharedPreferences

/** App settings and session, stored in the app's private storage */
class Prefs(context: Context) {
    private val sp: SharedPreferences = context.getSharedPreferences("voicetunes_calls", Context.MODE_PRIVATE)

    var serverUrl: String
        get() = sp.getString("serverUrl", "") ?: ""
        set(v) = sp.edit().putString("serverUrl", v.trim().trimEnd('/')).apply()

    var accessToken: String?
        get() = sp.getString("accessToken", null)
        set(v) = sp.edit().putString("accessToken", v).apply()

    var refreshToken: String?
        get() = sp.getString("refreshToken", null)
        set(v) = sp.edit().putString("refreshToken", v).apply()

    var userName: String
        get() = sp.getString("userName", "") ?: ""
        set(v) = sp.edit().putString("userName", v).apply()

    /** Only send calls whose number is a CRM lead (for personal phones) */
    var leadsOnly: Boolean
        get() = sp.getBoolean("leadsOnly", false)
        set(v) = sp.edit().putBoolean("leadsOnly", v).apply()

    /** Newest call-log timestamp already sent */
    var lastCallTimestamp: Long
        get() = sp.getLong("lastCallTimestamp", 0L)
        set(v) = sp.edit().putLong("lastCallTimestamp", v).apply()

    var lastSyncAt: Long
        get() = sp.getLong("lastSyncAt", 0L)
        set(v) = sp.edit().putLong("lastSyncAt", v).apply()

    var lastSyncMessage: String
        get() = sp.getString("lastSyncMessage", "") ?: ""
        set(v) = sp.edit().putString("lastSyncMessage", v).apply()

    /** What the Call-button connection is doing, shown in the app */
    var dialerStatus: String
        get() = sp.getString("dialerStatus", "") ?: ""
        set(v) = sp.edit().putString("dialerStatus", v).apply()

    /** When the after-call form opens: after "all" calls, only calls with CRM "leads", or "off" */
    var afterCallMode: String
        get() = sp.getString("afterCallMode", "all") ?: "all"
        set(v) = sp.edit().putString("afterCallMode", v).apply()

    /** The phone's last call state (IDLE / RINGING / OFFHOOK), kept between broadcasts */
    var callState: String
        get() = sp.getString("callState", "IDLE") ?: "IDLE"
        set(v) = sp.edit().putString("callState", v).apply()

    /** When the current call started ringing or dialling */
    var callStartedAt: Long
        get() = sp.getLong("callStartedAt", 0L)
        set(v) = sp.edit().putLong("callStartedAt", v).apply()

    /** Whether the current call was picked up / dialled (not just missed) */
    var callWasOffhook: Boolean
        get() = sp.getBoolean("callWasOffhook", false)
        set(v) = sp.edit().putBoolean("callWasOffhook", v).apply()

    /** Record calls in this app and upload them to the CRM, which turns them into text */
    var recordCalls: Boolean
        get() = sp.getBoolean("recordCalls", false)
        set(v) = sp.edit().putBoolean("recordCalls", v).apply()

    /** Only upload recordings on Wi-Fi */
    var recordingsWifiOnly: Boolean
        get() = sp.getBoolean("recordingsWifiOnly", false)
        set(v) = sp.edit().putBoolean("recordingsWifiOnly", v).apply()

    /** Which microphone source recorded sound on this phone last time (see CallRecorder) */
    var recordingSource: Int
        get() = sp.getInt("recordingSource", 0)
        set(v) = sp.edit().putInt("recordingSource", v).apply()

    /** The last recording came out silent: the phone blocks the microphone during calls */
    var lastRecordingSilent: Boolean
        get() = sp.getBoolean("lastRecordingSilent", false)
        set(v) = sp.edit().putBoolean("lastRecordingSilent", v).apply()

    var lastRecordingMessage: String
        get() = sp.getString("lastRecordingMessage", "") ?: ""
        set(v) = sp.edit().putString("lastRecordingMessage", v).apply()

    /** Today's figures from the CRM's last sync answer, and the day they belong to ("2026-09-29") */
    var todayStats: String
        get() = sp.getString("todayStats", "") ?: ""
        set(v) = sp.edit().putString("todayStats", v).apply()

    val isSignedIn: Boolean get() = !refreshToken.isNullOrEmpty() && serverUrl.isNotEmpty()

    fun signOut() {
        sp.edit()
            .remove("accessToken").remove("refreshToken").remove("userName")
            .remove("lastCallTimestamp").remove("lastSyncAt").remove("lastSyncMessage").remove("dialerStatus").remove("todayStats")
            .remove(PendingForms.KEY).remove(RecordingUploader.KEY).remove("lastRecordingMessage").remove("lastRecordingSilent")
            .apply()
    }
}
