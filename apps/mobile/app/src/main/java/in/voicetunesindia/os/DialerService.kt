package `in`.voicetunesindia.os

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.telecom.TelecomManager
import org.json.JSONObject

/**
 * Keeps one long-poll request open to the CRM. When the user clicks Call on the website, the CRM answers it
 * with the lead's number and this phone dials straight away — nothing to copy or type.
 */
class DialerService : Service() {

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!Prefs(this).isSignedIn || !canDial(this)) {
            stopSelf()
            return START_NOT_STICKY
        }
        createChannels(this)
        val notification = statusNotification(Prefs(this).dialerStatus.ifEmpty { CONNECTING })
        if (Build.VERSION.SDK_INT >= 34) startForeground(STATUS_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        else startForeground(STATUS_ID, notification)
        synchronized(DialerService) {
            // A restarted service reuses a poll thread that is still finishing its last request
            running = true
            if (worker?.isAlive != true) {
                worker = Thread({ loop(applicationContext) }, "crm-dialer").apply { isDaemon = true; start() }
            }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        running = false
        super.onDestroy()
    }

    private fun loop(context: Context) {
        val prefs = Prefs(context)
        val api = ApiClient(prefs)
        var backoffMs = 2_000L
        while (running) {
            try {
                val body = JSONObject()
                    .put("deviceId", CallSync.deviceId(context))
                    .put("deviceName", "${Build.MANUFACTURER} ${Build.MODEL}".trim())
                    .put("appVersion", BuildConfig.VERSION_NAME)
                    .put("canDial", canDial(context))
                // The server holds the request for up to 25 seconds
                val response = api.post("/calls/dialer/poll", body, readTimeoutMs = 45_000)
                backoffMs = 2_000L
                setStatus(context, READY)
                response.optJSONObject("request")?.let { dial(context, api, it) }
            } catch (e: AuthExpiredException) {
                setStatus(context, "Signed out — open the app and sign in again")
                running = false
                context.stopService(Intent(context, DialerService::class.java))
            } catch (e: Exception) {
                setStatus(context, "Reconnecting to the CRM…")
                try { Thread.sleep(backoffMs) } catch (_: InterruptedException) { }
                backoffMs = (backoffMs * 2).coerceAtMost(60_000L)
            }
        }
    }

    private fun dial(context: Context, api: ApiClient, request: JSONObject) {
        val id = request.getString("id")
        val phone = request.getString("phone")
        val name = request.optString("name").takeIf { it.isNotBlank() && it != "null" }
        val result = try {
            val number = phone.filter { it.isDigit() || it == '+' }
            if (context.checkSelfPermission(Manifest.permission.CALL_PHONE) != PackageManager.PERMISSION_GRANTED) {
                throw SecurityException("Phone permission is off in the app")
            }
            context.getSystemService(TelecomManager::class.java).placeCall(Uri.fromParts("tel", number, null), Bundle())
            JSONObject().put("status", "dialing")
        } catch (e: Exception) {
            // Couldn't dial on its own (e.g. permission removed): leave a one-tap notification instead
            showTapToCall(context, phone, name)
            JSONObject().put("status", "failed").put("error", e.message ?: e.javaClass.simpleName)
        }
        try { api.post("/calls/dialer/$id/result", result) } catch (_: Exception) { }
    }

    private fun setStatus(context: Context, status: String) {
        val prefs = Prefs(context)
        if (prefs.dialerStatus == status) return
        prefs.dialerStatus = status
        if (running) context.getSystemService(NotificationManager::class.java).notify(STATUS_ID, statusNotification(status))
    }

    private fun statusNotification(text: String): Notification =
        Notification.Builder(this, CHANNEL_STATUS)
            .setSmallIcon(android.R.drawable.stat_sys_phone_call)
            .setContentTitle("Voice Tunes India")
            .setContentText(text)
            .setOngoing(true)
            .setContentIntent(PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE))
            .build()

    companion object {
        private const val CHANNEL_STATUS = "dialer-status"
        private const val CHANNEL_CALL = "dialer-call"
        private const val STATUS_ID = 1
        private const val CONNECTING = "Connecting to the CRM…"
        const val READY = "Ready for calls from the CRM"

        @Volatile private var running = false
        @Volatile private var worker: Thread? = null

        /** The Call-button connection is running and the CRM answered its last request */
        fun isOnline(context: Context) = running && worker?.isAlive == true && Prefs(context).dialerStatus == READY

        fun canDial(context: Context) =
            context.checkSelfPermission(Manifest.permission.CALL_PHONE) == PackageManager.PERMISSION_GRANTED

        /** Safe to call any time; Android may refuse to start it from the background, in which case opening the app starts it */
        fun start(context: Context) {
            if (!Prefs(context).isSignedIn || !canDial(context)) return
            try {
                context.startForegroundService(Intent(context, DialerService::class.java))
            } catch (e: Exception) {
                Prefs(context).dialerStatus = "Open the app to reconnect the Call button"
            }
        }

        fun stop(context: Context) {
            running = false
            context.stopService(Intent(context, DialerService::class.java))
        }

        private fun createChannels(context: Context) {
            val nm = context.getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(NotificationChannel(CHANNEL_STATUS, "Call button connection", NotificationManager.IMPORTANCE_MIN).apply {
                description = "Keeps the CRM Call button connected to this phone"
                setShowBadge(false)
            })
            nm.createNotificationChannel(NotificationChannel(CHANNEL_CALL, "Calls from the CRM", NotificationManager.IMPORTANCE_HIGH))
        }

        private fun showTapToCall(context: Context, phone: String, name: String?) {
            createChannels(context)
            val intent = Intent(Intent.ACTION_DIAL, Uri.fromParts("tel", phone.filter { it.isDigit() || it == '+' }, null))
            val notification = Notification.Builder(context, CHANNEL_CALL)
                .setSmallIcon(android.R.drawable.stat_sys_phone_call)
                .setContentTitle("Tap to call ${name ?: phone}")
                .setContentText(phone)
                .setAutoCancel(true)
                .setContentIntent(PendingIntent.getActivity(context, phone.hashCode(), intent, PendingIntent.FLAG_IMMUTABLE))
                .build()
            context.getSystemService(NotificationManager::class.java).notify(phone.hashCode(), notification)
        }
    }
}
