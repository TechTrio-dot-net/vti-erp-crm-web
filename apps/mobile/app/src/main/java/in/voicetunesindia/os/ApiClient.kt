package `in`.voicetunesindia.os

import org.json.JSONObject
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL

class AuthExpiredException : IOException("Session expired — please sign in again")

class ApiException(val status: Int, message: String) : IOException(message)

/** Minimal JSON client for the CRM API (no third-party libraries) */
class ApiClient(private val prefs: Prefs) {

    private fun request(method: String, path: String, body: JSONObject?, token: String?, readTimeoutMs: Int = 30_000): Pair<Int, JSONObject> {
        val conn = (URL(prefs.serverUrl + "/api" + path).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 15_000
            readTimeout = readTimeoutMs
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("Accept", "application/json")
            setRequestProperty("X-Client", "mobile")
            if (token != null) setRequestProperty("Authorization", "Bearer $token")
            if (body != null) {
                doOutput = true
                outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
        }
        try {
            val status = conn.responseCode
            val stream = if (status in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() } ?: ""
            val json = try { if (text.isBlank()) JSONObject() else JSONObject(text) } catch (e: Exception) { JSONObject() }
            return status to json
        } finally {
            conn.disconnect()
        }
    }

    fun signIn(serverUrl: String, username: String, password: String): String {
        prefs.serverUrl = serverUrl
        val (status, json) = request("POST", "/auth/login", JSONObject().put("username", username).put("password", password), null)
        if (status != 200) throw ApiException(status, json.optString("message", "Sign-in failed ($status)"))
        prefs.accessToken = json.getString("token")
        prefs.refreshToken = json.optString("refreshToken").ifEmpty { throw ApiException(500, "Server did not return a refresh token — update the CRM") }
        val user = json.getJSONObject("user")
        prefs.userName = user.optString("name")
        if (user.optString("role") == "CLIENT") {
            prefs.signOut()
            throw ApiException(403, "Client accounts can't use call tracking")
        }
        return prefs.userName
    }

    private fun refresh(): Boolean {
        val rt = prefs.refreshToken ?: return false
        val (status, json) = request("POST", "/auth/refresh", JSONObject().put("refreshToken", rt), null)
        if (status != 200) return false
        prefs.accessToken = json.getString("token")
        json.optString("refreshToken").takeIf { it.isNotEmpty() }?.let { prefs.refreshToken = it }
        return true
    }

    /**
     * Streams a file with PUT, either to a short-lived storage address the CRM handed out (no sign-in needed)
     * or to an API path (signed in, refreshing the token once on 401).
     */
    fun putFile(target: String, apiPath: Boolean, contentType: String, size: Long, open: () -> InputStream) {
        fun send(token: String?): Int {
            val url = if (apiPath) prefs.serverUrl + "/api" + target else target
            val conn = (URL(url).openConnection() as HttpURLConnection).apply {
                requestMethod = "PUT"
                connectTimeout = 15_000
                readTimeout = 120_000
                doOutput = true
                setFixedLengthStreamingMode(size)
                setRequestProperty("Content-Type", contentType)
                if (apiPath) setRequestProperty("X-Client", "mobile")
                if (token != null) setRequestProperty("Authorization", "Bearer $token")
            }
            try {
                open().use { input -> conn.outputStream.use { input.copyTo(it, 64 * 1024) } }
                return conn.responseCode
            } finally {
                conn.disconnect()
            }
        }
        var status = send(if (apiPath) prefs.accessToken else null)
        if (status == 401 && apiPath) {
            if (!refresh()) throw AuthExpiredException()
            status = send(prefs.accessToken)
        }
        // A storage address that fails (expired link, wrong phone clock) is tried again later, and never means
        // the CRM session ended; only the CRM itself refusing the file (4xx on an API path) means it isn't wanted
        if (status !in 200..299 && !apiPath) throw IOException("Storage upload failed ($status)")
        if (status == 401) throw AuthExpiredException()
        if (status !in 200..299) throw ApiException(status, "Upload failed ($status)")
    }

    /** Authenticated GET (path with its query string); refreshes the access token once on 401 */
    fun get(path: String, readTimeoutMs: Int = 20_000): JSONObject {
        var (status, json) = request("GET", path, null, prefs.accessToken, readTimeoutMs)
        if (status == 401) {
            if (!refresh()) throw AuthExpiredException()
            val retry = request("GET", path, null, prefs.accessToken, readTimeoutMs)
            status = retry.first
            json = retry.second
        }
        if (status == 401) throw AuthExpiredException()
        if (status !in 200..299) throw ApiException(status, json.optString("message", "Request failed ($status)"))
        return json
    }

    /** Authenticated POST; refreshes the access token once on 401 */
    fun post(path: String, body: JSONObject, readTimeoutMs: Int = 30_000): JSONObject {
        var (status, json) = request("POST", path, body, prefs.accessToken, readTimeoutMs)
        if (status == 401) {
            if (!refresh()) throw AuthExpiredException()
            val retry = request("POST", path, body, prefs.accessToken, readTimeoutMs)
            status = retry.first
            json = retry.second
        }
        if (status == 401) throw AuthExpiredException()
        if (status !in 200..299) throw ApiException(status, json.optString("message", "Request failed ($status)"))
        return json
    }
}
