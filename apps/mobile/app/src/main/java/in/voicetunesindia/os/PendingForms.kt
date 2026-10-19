package `in`.voicetunesindia.os

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException

/**
 * After-call forms saved while the phone had no connection. The next sync uploads them; each carries a
 * clientRef, so a form that reached the CRM before the connection dropped is never saved twice.
 */
object PendingForms {
    const val KEY = "pendingAfterCall"
    private const val MAX = 200

    private fun prefs(context: Context) = context.getSharedPreferences("voicetunes_calls", Context.MODE_PRIVATE)

    private fun load(context: Context): JSONArray =
        try { JSONArray(prefs(context).getString(KEY, "[]")) } catch (e: Exception) { JSONArray() }

    private fun save(context: Context, list: JSONArray) {
        prefs(context).edit().putString(KEY, list.toString()).apply()
    }

    @Synchronized
    fun add(context: Context, body: JSONObject) {
        val list = load(context)
        list.put(body)
        while (list.length() > MAX) list.remove(0)
        save(context, list)
    }

    fun count(context: Context): Int = load(context).length()

    /** Uploads every saved form; keeps the ones that failed because of the network. Returns how many were sent. */
    @Synchronized
    fun flush(context: Context): Int {
        val list = load(context)
        if (list.length() == 0) return 0
        val api = ApiClient(Prefs(context))
        val remaining = JSONArray()
        var sent = 0
        for (i in 0 until list.length()) {
            val body = list.getJSONObject(i)
            try {
                api.post("/calls/after-call", body)
                sent++
            } catch (e: AuthExpiredException) {
                for (j in i until list.length()) remaining.put(list.getJSONObject(j))
                save(context, remaining)
                throw e
            } catch (e: ApiException) {
                // Refused by the CRM (e.g. the lead was moved to another BDM): retrying won't help
                if (e.status >= 500) remaining.put(body)
            } catch (e: IOException) {
                remaining.put(body)
            }
        }
        save(context, remaining)
        return sent
    }
}
