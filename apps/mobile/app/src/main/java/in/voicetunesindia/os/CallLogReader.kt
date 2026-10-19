package `in`.voicetunesindia.os

import android.content.Context
import android.provider.CallLog

data class PhoneCall(
    val phone: String,
    val direction: String,
    val startedAt: Long,
    val durationSec: Long,
    val contactName: String?,
)

/** Reads entries from the phone's call log that are newer than [sinceMillis] */
object CallLogReader {
    private const val MAX_PER_READ = 2000

    fun readSince(context: Context, sinceMillis: Long): List<PhoneCall> {
        val projection = arrayOf(
            CallLog.Calls.NUMBER,
            CallLog.Calls.TYPE,
            CallLog.Calls.DATE,
            CallLog.Calls.DURATION,
            CallLog.Calls.CACHED_NAME,
        )
        val calls = ArrayList<PhoneCall>()
        context.contentResolver.query(
            CallLog.Calls.CONTENT_URI,
            projection,
            "${CallLog.Calls.DATE} > ?",
            arrayOf(sinceMillis.toString()),
            "${CallLog.Calls.DATE} ASC",
        )?.use { c ->
            val iNumber = c.getColumnIndexOrThrow(CallLog.Calls.NUMBER)
            val iType = c.getColumnIndexOrThrow(CallLog.Calls.TYPE)
            val iDate = c.getColumnIndexOrThrow(CallLog.Calls.DATE)
            val iDuration = c.getColumnIndexOrThrow(CallLog.Calls.DURATION)
            val iName = c.getColumnIndexOrThrow(CallLog.Calls.CACHED_NAME)
            while (c.moveToNext() && calls.size < MAX_PER_READ) {
                val number = c.getString(iNumber)?.trim().orEmpty()
                if (number.isEmpty()) continue // private / withheld numbers
                val direction = when (c.getInt(iType)) {
                    CallLog.Calls.OUTGOING_TYPE -> "outgoing"
                    CallLog.Calls.INCOMING_TYPE, CallLog.Calls.ANSWERED_EXTERNALLY_TYPE -> "incoming"
                    CallLog.Calls.MISSED_TYPE -> "missed"
                    CallLog.Calls.REJECTED_TYPE, CallLog.Calls.BLOCKED_TYPE -> "rejected"
                    else -> null // voicemail and others
                } ?: continue
                calls.add(
                    PhoneCall(
                        phone = number,
                        direction = direction,
                        startedAt = c.getLong(iDate),
                        durationSec = c.getLong(iDuration),
                        contactName = c.getString(iName),
                    )
                )
            }
        }
        return calls
    }
}
