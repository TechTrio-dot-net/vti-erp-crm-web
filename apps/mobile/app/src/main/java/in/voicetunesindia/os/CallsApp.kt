package `in`.voicetunesindia.os

import android.app.Application

class CallsApp : Application() {
    override fun onCreate() {
        super.onCreate()
        if (Prefs(this).isSignedIn) {
            SyncWorker.schedulePeriodic(this)
            DialerService.start(this)
        }
    }
}
