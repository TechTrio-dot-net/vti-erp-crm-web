package `in`.voicetunesindia.os

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.graphics.PixelFormat
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.View
import android.view.WindowManager
import org.json.JSONObject

/**
 * What happens when a call ends: find it in the call log, decide whether the after-call form applies
 * (setting "all calls" / "only CRM leads" / "off"), then open the form. Android only lets an app open a
 * screen by itself while it may "display over other apps"; without that permission the form waits in a
 * heads-up notification that opens it with one tap.
 */
object AfterCall {
    private const val CHANNEL = "after-call"
    private const val CHANNEL_MISSED = "missed-lead-call"

    fun onCallEnded(context: Context, startedAt: Long, endedAt: Long, talked: Boolean, pending: BroadcastReceiver.PendingResult) {
        val app = context.applicationContext
        Thread({
            try {
                handle(app, startedAt, endedAt, talked)
            } catch (e: Exception) {
                // Never let a call-log or network problem crash the app; the background sync still runs
            } finally {
                pending.finish()
            }
        }, "after-call").start()
    }

    private fun handle(context: Context, startedAt: Long, endedAt: Long, talked: Boolean) {
        val prefs = Prefs(context)
        // A personal phone only ever deals with CRM leads
        val mode = if (prefs.leadsOnly && prefs.afterCallMode == "all") "leads" else prefs.afterCallMode
        if (mode == "off" || !CallSync.hasPermission(context)) return
        val call = findCall(context, startedAt, endedAt) ?: return
        val missed = !talked || call.direction == "missed" || call.direction == "rejected"

        var lookup: JSONObject? = null
        if (mode == "leads" || (missed && call.direction != "outgoing")) {
            lookup = try {
                ApiClient(prefs).post("/calls/after-call/lookup", JSONObject().put("phone", call.phone), readTimeoutMs = 8_000)
            } catch (e: Exception) {
                null
            }
            // Not a lead (or no connection to check): nothing to ask about
            if (lookup?.optJSONObject("lead") == null) return
        }
        if (missed && call.direction != "outgoing") {
            showMissed(context, call, lookup!!.getJSONObject("lead"))
            return
        }
        show(context, call, lookup)
    }

    /** The call log is written a moment after the call ends, so look for it for a few seconds */
    private fun findCall(context: Context, startedAt: Long, endedAt: Long): PhoneCall? {
        repeat(10) { attempt ->
            if (attempt > 0) Thread.sleep(700)
            val match = CallLogReader.readSince(context, startedAt - 60_000)
                .lastOrNull { it.startedAt >= startedAt - 15_000 && it.startedAt <= endedAt + 5_000 }
            if (match != null) return match
        }
        return null
    }

    fun show(context: Context, call: PhoneCall, lookup: JSONObject?) {
        val notificationId = notificationId(call)
        val intent = AfterCallActivity.intent(context, call, lookup, notificationId)
        // The notification is always posted: it is the way in when the screen can't open by itself, and
        // stays as a reminder. The form removes it once it's open.
        postReminder(context, call, lookup, intent, notificationId, fullScreen = true)
        openOverOtherApps(context, intent)
    }

    fun postReminder(context: Context, call: PhoneCall, lookup: JSONObject?, intent: Intent, notificationId: Int, fullScreen: Boolean) {
        createChannels(context)
        val who = lookup?.optJSONObject("lead")?.optString("name")?.takeIf { it.isNotBlank() && it != "null" }
            ?: call.contactName?.takeIf { it.isNotBlank() }
            ?: call.phone
        val pi = PendingIntent.getActivity(context, notificationId, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val builder = Notification.Builder(context, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_sys_phone_call)
            .setContentTitle("Log call with $who")
            .setContentText("${describe(call)} — add what happened and the next follow-up")
            .setCategory(Notification.CATEGORY_REMINDER)
            .setAutoCancel(true)
            .setContentIntent(pi)
            .addAction(Notification.Action.Builder(null, "Log call", pi).build())
        if (fullScreen) builder.setFullScreenIntent(pi, true)
        context.getSystemService(NotificationManager::class.java).notify(notificationId, builder.build())
    }

    /**
     * Opens the form in front of whatever app is showing. Since Android 15 the "display over other apps"
     * permission only allows this while one of the app's overlay windows is visible, so a tiny invisible
     * overlay is shown for a moment around the launch.
     */
    private fun openOverOtherApps(context: Context, intent: Intent) {
        if (!Settings.canDrawOverlays(context)) return
        Handler(Looper.getMainLooper()).post {
            val wm = context.getSystemService(WindowManager::class.java)
            val marker = View(context)
            val params = WindowManager.LayoutParams(
                1, 1,
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE,
                PixelFormat.TRANSLUCENT,
            )
            val added = try { wm.addView(marker, params); true } catch (e: Exception) { false }
            try {
                context.startActivity(Intent(intent).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            } catch (e: Exception) {
                // The notification is there to fall back on
            }
            if (added) Handler(Looper.getMainLooper()).postDelayed({ try { wm.removeView(marker) } catch (_: Exception) { } }, 2_000)
        }
    }

    /** A missed call from one of your leads: remind to call back */
    private fun showMissed(context: Context, call: PhoneCall, lead: JSONObject) {
        createChannels(context)
        val name = lead.optString("name").takeIf { it.isNotBlank() && it != "null" } ?: call.phone
        val dial = Intent(Intent.ACTION_DIAL, Uri.fromParts("tel", call.phone.filter { it.isDigit() || it == '+' }, null))
        val pi = PendingIntent.getActivity(context, notificationId(call), dial, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val notification = Notification.Builder(context, CHANNEL_MISSED)
            .setSmallIcon(android.R.drawable.stat_notify_missed_call)
            .setContentTitle("Missed call from $name")
            .setContentText("Your lead · ${lead.optString("stageLabel")} — tap to call back")
            .setAutoCancel(true)
            .setContentIntent(pi)
            .addAction(Notification.Action.Builder(null, "Call back", pi).build())
            .build()
        context.getSystemService(NotificationManager::class.java).notify(notificationId(call), notification)
    }

    fun notificationId(call: PhoneCall): Int = 10_000 + ((call.startedAt / 1000) % 1_000_000).toInt()

    fun describe(call: PhoneCall): String {
        val kind = when (call.direction) {
            "outgoing" -> if (call.durationSec > 0) "Outgoing call" else "Not answered"
            "incoming" -> "Incoming call"
            "missed" -> "Missed call"
            else -> "Rejected call"
        }
        return if (call.durationSec > 0) "$kind · ${CallSync.formatDuration(call.durationSec.toInt())}" else kind
    }

    private fun createChannels(context: Context) {
        val nm = context.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "After-call form", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "Opens the form to log a call's outcome and next follow-up in the CRM"
        })
        nm.createNotificationChannel(NotificationChannel(CHANNEL_MISSED, "Missed calls from leads", NotificationManager.IMPORTANCE_HIGH))
    }
}
