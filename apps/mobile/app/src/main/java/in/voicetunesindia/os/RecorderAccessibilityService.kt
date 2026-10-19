package `in`.voicetunesindia.os

import android.accessibilityservice.AccessibilityService
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.view.accessibility.AccessibilityEvent

/**
 * "Voice Tunes India call recorder" in Settings → Accessibility. It reads nothing on the screen; while it is on,
 * Android lets this app use the microphone during a call, which is what the call recorder needs.
 */
class RecorderAccessibilityService : AccessibilityService() {
    override fun onServiceConnected() {
        instance = this
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {}

    override fun onInterrupt() {}

    override fun onDestroy() {
        if (instance === this) instance = null
        super.onDestroy()
    }

    companion object {
        @Volatile
        var instance: RecorderAccessibilityService? = null
            private set
    }
}

/**
 * Starts and stops the recording as the call connects and ends (called from CallStateReceiver). The recording
 * runs inside a foreground service with a "Recording call" notification; if the phone refuses to start one
 * from the background, it runs under the accessibility service instead.
 */
object CallRecording {
    fun onCallConnected(context: Context) {
        if (!CallRecorder.ready(context)) return
        try {
            context.startForegroundService(Intent(context, CallRecordingService::class.java).setAction(CallRecordingService.ACTION_START))
        } catch (e: Exception) {
            // Android 12+ may refuse a foreground service started from the background
            CallRecorder.start(RecorderAccessibilityService.instance ?: context.applicationContext)
        }
    }

    fun onCallEnded(context: Context) {
        if (CallRecorder.isRecording) CallRecorder.stop(context.applicationContext)
        context.stopService(Intent(context, CallRecordingService::class.java))
    }
}

class CallRecordingService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action != ACTION_START) {
            stopSelf()
            return START_NOT_STICKY
        }
        try {
            if (Build.VERSION.SDK_INT >= 30) startForeground(NOTIFICATION_ID, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
            else startForeground(NOTIFICATION_ID, notification())
        } catch (e: Exception) {
            // Not allowed to use the microphone from here; record under the accessibility service instead
            CallRecorder.start(RecorderAccessibilityService.instance ?: applicationContext)
            stopSelf()
            return START_NOT_STICKY
        }
        if (!CallRecorder.start(applicationContext)) stopSelf()
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        stopForeground(STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }

    private fun notification(): Notification {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "Call recording", NotificationManager.IMPORTANCE_LOW).apply {
            description = "Shown while a call is being recorded for the CRM"
            setShowBadge(false)
        })
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        return Notification.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle("Recording call")
            .setContentText("The recording goes to the CRM and is turned into text")
            .setContentIntent(open)
            .setOngoing(true)
            .build()
    }

    companion object {
        const val ACTION_START = "in.voicetunesindia.os.RECORD_CALL"
        private const val CHANNEL = "call-recording"
        private const val NOTIFICATION_ID = 42
    }
}
