package `in`.voicetunesindia.os

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.telephony.TelephonyManager

/**
 * Follows each call through ringing / off-hook / idle. When a call ends (back to idle) the call log is
 * synced within a few seconds and the after-call form opens, so the outcome and next follow-up go into
 * the CRM while the conversation is fresh.
 */
class CallStateReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val prefs = Prefs(context)
        if (!prefs.isSignedIn) return
        val state = intent.getStringExtra(TelephonyManager.EXTRA_STATE) ?: return
        val previous = prefs.callState
        // Android sends each change twice when the app may read call numbers; act on the first only
        if (state == previous) return
        prefs.callState = state
        val now = System.currentTimeMillis()

        when (state) {
            TelephonyManager.EXTRA_STATE_RINGING -> {
                prefs.callStartedAt = now
                prefs.callWasOffhook = false
            }
            TelephonyManager.EXTRA_STATE_OFFHOOK -> {
                // Straight from idle means we are dialling out; after ringing it's an answered incoming call
                if (previous == TelephonyManager.EXTRA_STATE_IDLE) prefs.callStartedAt = now
                prefs.callWasOffhook = true
                CallRecording.onCallConnected(context)
            }
            TelephonyManager.EXTRA_STATE_IDLE -> {
                // Finish the recording first, so the sync a few seconds later can upload it
                CallRecording.onCallEnded(context)
                SyncWorker.syncSoon(context)
                val startedAt = prefs.callStartedAt
                val talked = prefs.callWasOffhook
                prefs.callWasOffhook = false
                prefs.callStartedAt = 0L
                if (startedAt > 0L) AfterCall.onCallEnded(context, startedAt, now, talked, goAsync())
            }
        }
    }
}

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        // Also runs after an app update, which would otherwise leave the Call button offline until the app is opened
        val ok = intent.action == Intent.ACTION_BOOT_COMPLETED || intent.action == Intent.ACTION_MY_PACKAGE_REPLACED
        if (ok && Prefs(context).isSignedIn) {
            Prefs(context).callState = TelephonyManager.EXTRA_STATE_IDLE
            SyncWorker.schedulePeriodic(context)
            if (intent.action == Intent.ACTION_BOOT_COMPLETED) SyncWorker.syncSoon(context, 30)
            DialerService.start(context)
        }
    }
}
