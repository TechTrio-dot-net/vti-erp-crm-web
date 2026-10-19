package `in`.voicetunesindia.os

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.io.IOException
import java.util.concurrent.TimeUnit

class SyncWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result = try {
        CallSync.run(applicationContext)
        // After-call forms filled in while offline go up once the calls themselves are in
        PendingForms.flush(applicationContext)
        uploadRecordings(applicationContext)
        if (PendingForms.count(applicationContext) > 0) Result.retry() else Result.success()
    } catch (e: AuthExpiredException) {
        Prefs(applicationContext).lastSyncMessage = e.message ?: "Please sign in again"
        Result.failure()
    } catch (e: IOException) {
        Prefs(applicationContext).lastSyncMessage = "Waiting for connection to the CRM: ${e.message}"
        Result.retry()
    } catch (e: Exception) {
        Prefs(applicationContext).lastSyncMessage = "Sync error: ${e.message}"
        Result.retry()
    }

    /** Call recordings after the calls; a problem here never fails the call sync itself */
    private fun uploadRecordings(context: Context) {
        try {
            RecordingUploader.flush(context)
        } catch (e: AuthExpiredException) {
            throw e
        } catch (e: Exception) {
            Prefs(context).lastRecordingMessage = "Recording upload problem: ${e.message}"
        }
        // A call may still be being recorded (calls back to back): look again in a few minutes
        if (RecordingUploader.hasFreshPending(context)) recordingsLater(context)
    }

    companion object {
        private val online = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

        /** Background sync every 15 minutes (the shortest interval Android allows) */
        fun schedulePeriodic(context: Context) {
            val request = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES).setConstraints(online).build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork("call-sync", ExistingPeriodicWorkPolicy.KEEP, request)
        }

        /** Sync shortly after a call ends (the phone writes the call log a moment later) */
        fun syncSoon(context: Context, delaySeconds: Long = 8) {
            val request = OneTimeWorkRequestBuilder<SyncWorker>()
                .setInitialDelay(delaySeconds, TimeUnit.SECONDS)
                .setConstraints(online)
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork("call-sync-now", ExistingWorkPolicy.REPLACE, request)
        }

        /** One more look for recordings a few minutes from now (kept, not pushed back, by later calls) */
        fun recordingsLater(context: Context) {
            val request = OneTimeWorkRequestBuilder<SyncWorker>()
                .setInitialDelay(3, TimeUnit.MINUTES)
                .setConstraints(online)
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork("recordings-later", ExistingWorkPolicy.KEEP, request)
        }

        fun cancelAll(context: Context) = WorkManager.getInstance(context).cancelAllWork()
    }
}
