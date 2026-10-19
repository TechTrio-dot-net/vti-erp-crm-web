package `in`.voicetunesindia.os

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.telecom.TelecomManager
import android.text.InputType
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.view.inputmethod.EditorInfo
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.text.DateFormat
import java.text.SimpleDateFormat
import java.time.Instant
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors

/**
 * The app's screen. Signed out: sign in. Signed in: three tabs in a bottom bar — Home (today's calls and
 * leads at a glance), Leads (your CRM leads, one tap to call) and More (setup and every setting).
 */
class MainActivity : Activity() {
    private lateinit var prefs: Prefs
    private lateinit var ui: Ui
    private val io = Executors.newSingleThreadExecutor()
    /** Syncing runs on its own thread, so Home and Leads never wait behind it */
    private val syncer = Executors.newSingleThreadExecutor()
    @Volatile private var syncing = false
    private lateinit var scroll: ScrollView
    private lateinit var root: LinearLayout
    private lateinit var nav: LinearLayout
    private lateinit var navLine: View

    private var tab = TAB_HOME

    // Home: the CRM's dashboard answer, kept while the app is open
    private var home: JSONObject? = null
    private var homeAt = 0L
    private var homeError: String? = null
    private var homeLoading = false

    // Leads: the current list, its filter, search and page
    private var leadFilter = "due"
    private var leadSearch = ""
    private var leadRows = JSONArray()
    private var leadTotal = 0
    private var leadPage = 1
    private var leadsLoaded = false
    private var leadsLoading = false
    private var leadsError: String? = null
    /** Bumped on every new lead request, so a slow older answer never replaces a newer one */
    private var leadsRequest = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)
        ui = Ui(this)
        tab = savedInstanceState?.getString("tab") ?: TAB_HOME
        root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(ui.dp(20), ui.dp(16), ui.dp(20), ui.dp(28)) }
        scroll = ScrollView(this).apply {
            clipToPadding = false
            setBackgroundColor(Palette.page)
            addView(root)
            layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, 0, 1f)
        }
        nav = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(Palette.surface)
            setPadding(ui.dp(8), ui.dp(6), ui.dp(8), ui.dp(6))
        }
        // Android 15 draws apps edge-to-edge; keep content and the bar clear of the status and gesture bars
        setContentView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            fitsSystemWindows = true
            setBackgroundColor(Palette.surface)
            addView(scroll)
            navLine = View(this@MainActivity).apply { setBackgroundColor(Palette.line); layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, ui.dp(1)) }
            addView(navLine)
            addView(nav)
        })
        render()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putString("tab", tab)
    }

    override fun onResume() {
        super.onResume()
        if (::root.isInitialized) render()
        // Opening the app syncs by itself (at most once a minute), so nobody has to press Sync
        if (prefs.isSignedIn && System.currentTimeMillis() - prefs.lastSyncAt > AUTO_SYNC_MS) sync(manual = false)
    }

    private fun render() {
        root.removeAllViews()
        if (!prefs.isSignedIn) {
            nav.visibility = View.GONE
            navLine.visibility = View.GONE
            renderSignIn()
            return
        }
        DialerService.start(this)
        nav.visibility = View.VISIBLE
        navLine.visibility = View.VISIBLE
        renderNav()
        when (tab) {
            TAB_LEADS -> renderLeads()
            TAB_MORE -> renderMore()
            else -> renderHome()
        }
    }

    private fun open(target: String) {
        if (tab != target) scroll.scrollTo(0, 0)
        tab = target
        render()
    }

    // ─── Bottom bar ─────────────────────────────────────────────────────────────────────────────────────────

    private fun renderNav() {
        nav.removeAllViews()
        val setupLeft = setupSteps().count { !it.done }
        listOf(
            Triple(TAB_HOME, "⌂", "Home"),
            Triple(TAB_LEADS, "☰", "Leads"),
            Triple(TAB_MORE, "⋯", "More"),
        ).forEach { (key, glyph, label) ->
            val on = tab == key
            nav.addView(LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER
                layoutParams = LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f)
                setPadding(0, ui.dp(4), 0, ui.dp(4))
                contentDescription = label
                isClickable = true
                setOnClickListener { open(key) }
                addView(TextView(this@MainActivity).apply {
                    text = glyph
                    textSize = 20f
                    gravity = Gravity.CENTER
                    setTextColor(Palette.ink)
                    background = if (on) ui.rounded(Palette.yellow, 16) else null
                    layoutParams = LinearLayout.LayoutParams(ui.dp(64), ui.dp(32))
                })
                val caption = if (key == TAB_MORE && setupLeft > 0) "$label ●" else label
                addView(ui.text(caption, 12f, if (on) Palette.ink else Palette.muted, bold = on).apply { gravity = Gravity.CENTER; setPadding(0, ui.dp(2), 0, 0) })
            })
        }
    }

    // ─── Sign in ────────────────────────────────────────────────────────────────────────────────────────────

    private fun renderSignIn() = with(ui) {
        root.addView(logo(200).withMargins(top = 24, bottom = 8))
        root.addView(text("Sign in", 26f, bold = true).withMargins(top = 16))
        root.addView(text("Use the same username and password as the CRM website.", 14f, Palette.muted).withMargins(top = 4, bottom = 8))

        val form = card()
        val server = input("https://your-crm.vercel.app", prefs.serverUrl.ifEmpty { BuildConfig.DEFAULT_SERVER_URL }, InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI)
        val username = input("Username, email or employee ID", "", InputType.TYPE_CLASS_TEXT)
        val password = input("Password", "", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD)
        val status = text("", 14f, Palette.red).withMargins(top = 10).apply { visibility = View.GONE }
        fun showStatus(message: String) {
            status.text = message
            status.visibility = View.VISIBLE
        }
        val button = primaryButton("Sign in") { button ->
            val url = normalizeServerUrl(server.text.toString())
            if (url.length <= "https://".length) return@primaryButton showStatus("Enter the CRM address")
            if (username.text.isBlank() || password.text.isEmpty()) return@primaryButton showStatus("Enter your username and password")
            button.isEnabled = false
            button.text = "Signing in…"
            status.visibility = View.GONE
            io.execute {
                try {
                    val name = ApiClient(prefs).signIn(url, username.text.toString().trim(), password.text.toString())
                    runOnUiThread {
                        resetCaches()
                        tab = TAB_HOME
                        SyncWorker.schedulePeriodic(this@MainActivity)
                        render()
                        requestNeededPermissions()
                        toast("Signed in as $name")
                    }
                } catch (e: Exception) {
                    prefs.signOut()
                    runOnUiThread {
                        button.isEnabled = true
                        button.text = "Sign in"
                        showStatus(
                            if (e is java.net.ConnectException || e is java.net.UnknownHostException || e is java.net.SocketTimeoutException)
                                "Can't reach $url — check the address and the phone's internet connection"
                            else e.message ?: "Sign-in failed"
                        )
                    }
                }
            }
        }
        listOf(fieldLabel("CRM address").withMargins(bottom = 6), server, fieldLabel("Username or employee ID"), username, fieldLabel("Password"), password, button, status)
            .forEach { form.addView(it) }
        root.addView(form)
        root.addView(text("Your calls stay private: only the number, time and length of calls go to the CRM — never contacts or messages.", 12f, Palette.muted).withMargins(top = 4, start = 4, end = 4))
    }

    // ─── Home ───────────────────────────────────────────────────────────────────────────────────────────────

    private fun renderHome() {
        renderHeader()
        renderToday()
        renderLeadSummary()
        val left = setupSteps().count { !it.done }
        if (left > 0) {
            root.addView(ui.card(Palette.amberSoft, null).apply {
                addView(ui.text("$left setup step${if (left == 1) "" else "s"} left", 15f, Palette.amber, bold = true))
                addView(ui.text("Finish setup so calls are tracked${if (prefs.recordCalls) " and recorded" else ""}.", 13f, Palette.amber).withMarginsOf(top = 2))
                isClickable = true
                setOnClickListener { open(TAB_MORE) }
            }.withMarginsOf(top = 12))
        }
        if (home == null || System.currentTimeMillis() - homeAt > 60_000) loadHome()
    }

    private fun renderHeader() = with(ui) {
        val row = LinearLayout(this@MainActivity).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        row.addView(logo(132).apply { layoutParams = LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f) })
        val online = DialerService.isOnline(this@MainActivity)
        row.addView(pill(if (online) "● Online" else "● Offline", if (online) Palette.green else Palette.muted, if (online) Palette.greenSoft else Palette.surface))
        root.addView(row.withMargins(bottom = 18))
        root.addView(text("Hi, ${prefs.userName.substringBefore(' ').ifEmpty { "there" }}", 24f, bold = true))
        root.addView(text(SimpleDateFormat("EEEE, d MMMM", Locale.getDefault()).format(Date()), 13f, Palette.muted).withMargins(top = 2, bottom = 14))
    }

    /** Dark card: today's calls from this phone, the last sync and the Sync button */
    private fun renderToday() = with(ui) {
        val card = card(Palette.ink, null)
        val (calls, connected, talkSec) = CallSync.todayStats(prefs)
        card.addView(text("TODAY'S CALLS", 12f, Palette.yellow, bold = true).apply { letterSpacing = 0.1f })
        card.addView(statRow(listOf(calls.toString() to "Calls", connected.toString() to "Connected", CallSync.formatDuration(talkSec) to "Talk time"), Color.WHITE).withMargins(top = 8))

        val synced = when {
            syncing -> "Syncing calls, forms and recordings…"
            prefs.lastSyncAt > 0 -> "Synced ${ago(prefs.lastSyncAt)} · syncs by itself after every call"
            else -> "Not synced yet"
        }
        card.addView(text(synced, 13f, Color.parseColor("#B8B4AA")).withMargins(top = 14))
        if (!CallSync.hasPermission(this@MainActivity)) {
            card.addView(text("Call log access is off — calls can't be counted.", 13f, Palette.yellow).withMargins(top = 4))
        } else if (prefs.lastSyncMessage.startsWith("Waiting") || prefs.lastSyncMessage.startsWith("Sync error") || prefs.lastSyncMessage.startsWith("Session")) {
            card.addView(text(prefs.lastSyncMessage, 13f, Palette.yellow).withMargins(top = 4))
        }
        val pending = PendingForms.count(this@MainActivity)
        if (pending > 0) card.addView(text("$pending after-call form${if (pending == 1) "" else "s"} waiting to upload", 13f, Palette.yellow).withMargins(top = 4))
        card.addView(primaryButton(if (syncing) "Syncing…" else "Sync now") { sync(manual = true) }.apply { isEnabled = !syncing })
        root.addView(card)
    }

    /** Sends new calls, saved forms and recordings, then refreshes Home and Leads from the CRM */
    private fun sync(manual: Boolean) {
        if (syncing) return
        syncing = true
        render()
        syncer.execute {
            var failed = false
            val message = try {
                val r = CallSync.run(this)
                val forms = PendingForms.flush(this)
                val recordings = try { RecordingUploader.flush(this) } catch (e: AuthExpiredException) { throw e } catch (e: Exception) { 0 }
                "Synced ${r.sent} new call${if (r.sent == 1) "" else "s"} (${r.matched} matched to leads)" +
                    (if (forms > 0) " · uploaded $forms saved form${if (forms == 1) "" else "s"}" else "") +
                    if (recordings > 0) " · $recordings recording${if (recordings == 1) "" else "s"}" else ""
            } catch (e: AuthExpiredException) {
                prefs.signOut()
                failed = true
                e.message
            } catch (e: Exception) {
                failed = true
                "Couldn't sync: ${friendlyError(e)}"
            }
            runOnUiThread {
                syncing = false
                if (manual || failed) toast(message ?: "Done")
                homeAt = 0L
                leadsLoaded = false
                if (!isFinishing) render()
            }
        }
    }

    /** "just now", "5 min ago", else the time */
    private fun ago(millis: Long): String {
        val minutes = (System.currentTimeMillis() - millis) / 60_000
        return when {
            minutes < 1 -> "just now"
            minutes < 60 -> "$minutes min ago"
            else -> "at " + DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(millis))
        }
    }

    /** Your leads today from the CRM: tiles that open the matching list, then the follow-ups to call first */
    private fun renderLeadSummary() = with(ui) {
        root.addView(sectionTitle("Your leads"))
        val data = home
        if (data == null) {
            root.addView(card().apply {
                if (homeError != null) {
                    addView(text("Couldn't load your leads", 15f, bold = true))
                    addView(text(homeError!!, 13f, Palette.muted).withMargins(top = 2))
                    addView(secondaryButton("Try again") { loadHome() })
                } else addView(loadingRow("Loading your leads…"))
            })
            return
        }
        val today = data.optJSONObject("today") ?: JSONObject()
        val tiles = listOf(
            Triple("today", today.optInt("dueToday"), "Due today"),
            Triple("overdue", today.optInt("overdue"), "Overdue"),
            Triple("pending", today.optInt("pending"), "New, not called"),
            Triple("open", today.optInt("open"), "Open leads"),
        )
        tiles.chunked(2).forEach { pair ->
            val row = LinearLayout(this@MainActivity).apply { orientation = LinearLayout.HORIZONTAL }
            pair.forEachIndexed { i, (filter, count, label) ->
                val warn = filter == "overdue" && count > 0
                row.addView(LinearLayout(this@MainActivity).apply {
                    orientation = LinearLayout.VERTICAL
                    setPadding(dp(16), dp(14), dp(16), dp(14))
                    background = rounded(if (warn) Palette.redSoft else Palette.surface, 14, if (warn) null else Palette.line)
                    layoutParams = LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f).apply { if (i == 0) marginEnd = dp(10); bottomMargin = dp(10) }
                    isClickable = true
                    contentDescription = "$label: $count. Show these leads"
                    setOnClickListener { showLeads(filter) }
                    addView(text(count.toString(), 26f, if (warn) Palette.red else Palette.ink, bold = true))
                    addView(text("$label  ›", 13f, if (warn) Palette.red else Palette.muted))
                })
            }
            root.addView(row)
        }
        if (today.optInt("wonToday") > 0) root.addView(text("🎉 ${today.optInt("wonToday")} won today", 14f, Palette.green, bold = true).withMargins(bottom = 8, start = 4))

        val due = data.optJSONArray("due") ?: JSONArray()
        root.addView(sectionTitle("Call these first"))
        root.addView(card().apply {
            if (due.length() == 0) {
                addView(text("No follow-ups due. You're all caught up.", 14f, Palette.muted))
            } else {
                for (i in 0 until minOf(due.length(), 5)) {
                    if (i > 0) addView(divider())
                    addView(leadRow(due.getJSONObject(i)))
                }
                if (due.length() > 5) addView(secondaryButton("See all ${due.length()} follow-ups") { showLeads("due") })
            }
        })
    }

    private fun loadHome() {
        if (homeLoading) return
        homeLoading = true
        io.execute {
            val (data, error) = try {
                ApiClient(prefs).get("/crm/reports/dashboard") to null
            } catch (e: AuthExpiredException) {
                prefs.signOut()
                null to (e.message ?: "Please sign in again")
            } catch (e: Exception) {
                null to friendlyError(e)
            }
            runOnUiThread {
                homeLoading = false
                if (data != null) { home = data; homeAt = System.currentTimeMillis(); homeError = null } else homeError = error
                if (tab == TAB_HOME || !prefs.isSignedIn) render()
            }
        }
    }

    // ─── Leads ──────────────────────────────────────────────────────────────────────────────────────────────

    private fun showLeads(filter: String) {
        leadFilter = filter
        leadSearch = ""
        leadsLoaded = false
        open(TAB_LEADS)
    }

    private fun renderLeads() = with(ui) {
        root.addView(text("Leads", 24f, bold = true))
        root.addView(text("Your CRM leads. Tap one for details, or Call to dial.", 13f, Palette.muted).withMargins(top = 2, bottom = 12))

        val search = input("Search name, mobile or email", leadSearch, InputType.TYPE_CLASS_TEXT).apply {
            imeOptions = EditorInfo.IME_ACTION_SEARCH
            setOnEditorActionListener { v, actionId, event ->
                val go = actionId == EditorInfo.IME_ACTION_SEARCH || (event?.keyCode == KeyEvent.KEYCODE_ENTER && event.action == KeyEvent.ACTION_DOWN)
                if (go) {
                    leadSearch = v.text.toString().trim()
                    loadLeads(reset = true)
                }
                go
            }
        }
        root.addView(search)

        // Filter chips, wrapping onto a second line on narrow phones
        val chips = LinearLayout(this@MainActivity).apply { orientation = LinearLayout.VERTICAL }
        LEAD_FILTERS.chunked(3).forEach { line ->
            chips.addView(LinearLayout(this@MainActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                line.forEach { (key, label) ->
                    addView(smallButton(label, primary = key == leadFilter) {
                        if (key != leadFilter) { leadFilter = key; loadLeads(reset = true) }
                    }.apply { layoutParams = LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f).apply { marginEnd = dp(8); topMargin = dp(8) } })
                }
                repeat(3 - line.size) { addView(View(this@MainActivity).apply { layoutParams = LinearLayout.LayoutParams(0, 0, 1f) }) }
            })
        }
        root.addView(chips.withMargins(top = 4, bottom = 12))

        // Loads after this screen is drawn; it redraws itself when the answer comes
        if (!leadsLoaded && !leadsLoading) {
            leadsLoading = true
            root.post { loadLeads(reset = true) }
        }
        val list = card()
        when {
            leadsLoading && leadRows.length() == 0 -> list.addView(loadingRow("Loading leads…"))
            leadsError != null && leadRows.length() == 0 -> {
                list.addView(text("Couldn't load leads", 15f, bold = true))
                list.addView(text(leadsError!!, 13f, Palette.muted).withMargins(top = 2))
                list.addView(secondaryButton("Try again") { loadLeads(reset = true) })
            }
            leadRows.length() == 0 -> list.addView(text(if (leadSearch.isNotEmpty()) "No leads match “$leadSearch”." else "No leads here.", 14f, Palette.muted))
            else -> {
                list.addView(text("${leadTotal} lead${if (leadTotal == 1) "" else "s"}", 13f, Palette.muted, bold = true).withMargins(bottom = 4))
                for (i in 0 until leadRows.length()) {
                    if (i > 0) list.addView(divider())
                    list.addView(leadRow(leadRows.getJSONObject(i)))
                }
                if (leadRows.length() < leadTotal) {
                    list.addView(secondaryButton(if (leadsLoading) "Loading…" else "Show more") { if (!leadsLoading) loadLeads(reset = false) })
                }
            }
        }
        root.addView(list)
    }

    private fun loadLeads(reset: Boolean) {
        if (reset) { leadPage = 1; leadRows = JSONArray(); leadTotal = 0 } else leadPage++
        leadsLoading = true
        leadsError = null
        val request = ++leadsRequest
        val page = leadPage
        val sort = if (leadFilter in listOf("due", "overdue", "today")) "followup" else "created"
        val query = "/crm/leads?status=$leadFilter&sort=$sort&limit=$PAGE_SIZE&page=$page" +
            if (leadSearch.isNotEmpty()) "&q=" + URLEncoder.encode(leadSearch, "UTF-8") else ""
        if (tab == TAB_LEADS) render()
        io.execute {
            val (data, error) = try {
                ApiClient(prefs).get(query) to null
            } catch (e: AuthExpiredException) {
                prefs.signOut()
                null to (e.message ?: "Please sign in again")
            } catch (e: Exception) {
                null to friendlyError(e)
            }
            runOnUiThread {
                if (request != leadsRequest) return@runOnUiThread
                leadsLoading = false
                leadsLoaded = true
                if (data != null) {
                    val rows = data.optJSONArray("rows") ?: JSONArray()
                    for (i in 0 until rows.length()) leadRows.put(rows.getJSONObject(i))
                    leadTotal = data.optInt("total", leadRows.length())
                } else {
                    leadsError = error
                    if (!reset) leadPage--
                }
                if (tab == TAB_LEADS || !prefs.isSignedIn) render()
            }
        }
    }

    /** One lead: name, stage and next follow-up; tap for details, Call to dial */
    private fun leadRow(lead: JSONObject): LinearLayout = with(ui) {
        val row = LinearLayout(this@MainActivity).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, dp(4), 0, dp(4))
            isClickable = true
            setOnClickListener { showLead(lead) }
        }
        val body = LinearLayout(this@MainActivity).apply { orientation = LinearLayout.VERTICAL; layoutParams = LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f) }
        val top = LinearLayout(this@MainActivity).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        top.addView(text(lead.str("name") ?: lead.str("phone") ?: "Lead", 15f, bold = true).apply {
            maxLines = 1
            ellipsize = android.text.TextUtils.TruncateAt.END
            layoutParams = LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f).apply { marginEnd = dp(8) }
        })
        top.addView(stagePill(lead.optString("stage")))
        body.addView(top)
        val next = lead.str("nextFollowupAt")?.let { parseIso(it) }
        val overdue = next != null && next < startOfToday()
        val detail = listOfNotNull(lead.str("phone"), next?.let { "follow-up ${formatWhen(it)}" } ?: if (lead.optBoolean("pending")) "not called yet" else null).joinToString(" · ")
        body.addView(text(detail, 13f, if (overdue) Palette.red else Palette.muted).withMargins(top = 2))
        val remark = listOfNotNull(lead.str("statusLabel"), lead.str("lastRemark")?.replace('\n', ' ')).joinToString(" · ")
        if (remark.isNotEmpty()) body.addView(text(remark, 13f, Palette.ink).apply {
            maxLines = 2
            ellipsize = android.text.TextUtils.TruncateAt.END
        }.withMargins(top = 2))
        row.addView(body)
        lead.str("phone")?.let { phone ->
            row.addView(smallButton("Call") { callLead(phone) }.apply {
                layoutParams = LinearLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT).apply { marginStart = dp(10) }
                contentDescription = "Call ${lead.str("name") ?: phone}"
            })
        }
        row
    }

    /** Details of a lead, with its latest follow-ups loaded from the CRM */
    private fun showLead(lead: JSONObject) = with(ui) {
        val id = lead.str("id") ?: return@with
        val content = LinearLayout(this@MainActivity).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(24), dp(20), dp(24), dp(8)) }
        val head = LinearLayout(this@MainActivity).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        head.addView(text(lead.str("name") ?: "Lead", 20f, bold = true).apply { layoutParams = LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f).apply { marginEnd = dp(8) } })
        head.addView(stagePill(lead.optString("stage")))
        content.addView(head)
        lead.str("statusLabel")?.let { content.addView(text("Status: $it", 14f, Palette.muted).withMargins(top = 4)) }
        listOf(
            "Contact" to lead.str("contactName")?.takeIf { it != lead.str("name") },
            "Mobile" to lead.str("phone"),
            "Email" to lead.str("email"),
            "Service" to lead.str("service"),
            "City" to lead.str("city"),
            "Source" to listOfNotNull(lead.str("source"), lead.str("campaign")).joinToString(" · ").ifEmpty { null },
            "Value" to lead.optDouble("estimatedValue").takeIf { !it.isNaN() && it > 0 }?.let { "₹" + "%,.0f".format(it) },
            "Next follow-up" to lead.str("nextFollowupAt")?.let { parseIso(it) }?.let { formatWhen(it) },
            "Assigned to" to lead.str("assignedName"),
            "Business type" to lead.str("businessType"),
        ).forEach { (label, value) ->
            if (value != null) {
                content.addView(text(label.uppercase(), 11f, Palette.muted, bold = true).apply { letterSpacing = 0.06f }.withMargins(top = 12))
                content.addView(text(value, 15f).withMargins(top = 2))
            }
        }
        lead.str("notes")?.let {
            content.addView(text("NOTES", 11f, Palette.muted, bold = true).withMargins(top = 12))
            content.addView(text(it, 14f).withMargins(top = 2))
        }
        content.addView(text("FOLLOW-UP HISTORY", 11f, Palette.muted, bold = true).withMargins(top = 16))
        val history = LinearLayout(this@MainActivity).apply { orientation = LinearLayout.VERTICAL }
        history.addView(loadingRow("Loading…"))
        content.addView(history)

        val dialog = AlertDialog.Builder(this@MainActivity)
            .setView(ScrollView(this@MainActivity).apply { addView(content) })
            .setNegativeButton("Close", null)
            .apply { lead.str("phone")?.let { phone -> setPositiveButton("Call") { _, _ -> callLead(phone) } } }
            .create()
        dialog.show()

        io.execute {
            val followups = try { ApiClient(prefs).get("/crm/leads/$id").optJSONArray("followups") } catch (e: Exception) { null }
            runOnUiThread {
                if (!dialog.isShowing) return@runOnUiThread
                history.removeAllViews()
                if (followups == null) {
                    history.addView(text("Couldn't load follow-ups.", 14f, Palette.muted).withMargins(top = 4))
                } else if (followups.length() == 0) {
                    history.addView(text("None yet.", 14f, Palette.muted).withMargins(top = 4))
                } else {
                    for (i in 0 until minOf(followups.length(), 15)) {
                        val f = followups.getJSONObject(i)
                        if (i > 0) history.addView(divider())
                        val what = f.str("callActivity") ?: OUTCOMES[f.optString("outcome")] ?: f.optString("outcome")
                        history.addView(text(listOfNotNull(what, f.str("statusLabel")?.let { "→ $it" }).joinToString(" "), 14f, bold = true).withMargins(top = 8))
                        history.addView(text(f.str("note") ?: "No remark", 14f, if (f.str("note") != null) Palette.ink else Palette.muted).withMargins(top = 2))
                        f.str("reason")?.let { history.addView(text("Reason: $it", 13f, Palette.red).withMargins(top = 2)) }
                        val meta = listOfNotNull(
                            f.str("createdAt")?.let { parseIso(it) }?.let { formatWhen(it) },
                            f.str("userName"),
                            f.optInt("callDurationSec").takeIf { it > 0 }?.let { "call ${CallSync.formatDuration(it)}" },
                            f.str("nextFollowupAt")?.let { parseIso(it) }?.let { "next ${formatWhen(it)}" },
                        ).joinToString(" · ")
                        history.addView(text(meta, 12f, Palette.muted).withMargins(top = 2))
                    }
                    if (followups.length() > 15) history.addView(text("+ ${followups.length() - 15} older — see the CRM website", 12f, Palette.muted).withMargins(top = 8))
                }
            }
        }
    }

    /** Dials straight away when the phone permission is on (the after-call form follows), else opens the dialler */
    private fun callLead(phone: String) {
        val number = phone.filter { it.isDigit() || it == '+' }
        if (number.isEmpty()) return toast("This lead has no mobile number")
        val uri = Uri.fromParts("tel", number, null)
        try {
            if (DialerService.canDial(this)) getSystemService(TelecomManager::class.java).placeCall(uri, Bundle())
            else startActivity(Intent(Intent.ACTION_DIAL, uri))
        } catch (e: Exception) {
            startActivity(Intent(Intent.ACTION_DIAL, uri))
        }
    }

    // ─── More: setup and settings ───────────────────────────────────────────────────────────────────────────

    private fun renderMore() {
        root.addView(ui.text("More", 24f, bold = true))
        root.addView(ui.text("Setup and settings for this phone.", 13f, Palette.muted).withMarginsOf(top = 2, bottom = 4))
        renderSetup()
        renderRecording()
        renderAfterCall()
        renderPhoneType()
        renderAccount()
    }

    private class Step(
        val title: String,
        val detail: String,
        val done: Boolean,
        val action: String? = null,
        val onAction: (() -> Unit)? = null,
        val help: String? = null,
        val secondary: Pair<String, () -> Unit>? = null,
    )

    /** Everything the phone must allow, in order */
    private fun setupSteps(): List<Step> {
        val appInfo = { startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName"))) }
        val steps = mutableListOf(
            Step("Call log access", "Counts your calls in the CRM. Only number, time and length — never contacts or SMS.",
                CallSync.hasPermission(this), "Allow", { requestNeededPermissions() }),
            Step("CRM Call button", "Click Call on a lead in the CRM website and this phone dials it.",
                DialerService.canDial(this), "Allow", { requestNeededPermissions() }),
        )
        if (Build.VERSION.SDK_INT >= 33) {
            steps += Step("Notifications", "Shows the after-call reminder and the “Ready for calls” status.",
                checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED, "Allow", { requestNeededPermissions() })
        }
        if (prefs.afterCallMode != "off") {
            steps += Step("Pop-up after calls", "Lets the after-call form open by itself when a call ends.",
                Settings.canDrawOverlays(this), "Open", {
                    startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
                }, help = "On Xiaomi, Vivo and Oppo also allow “Display pop-up windows while running in the background” in App info → Other permissions.")
        }
        if (prefs.recordCalls) {
            steps += Step("Microphone", "Needed to record calls.",
                CallRecorder.hasMicPermission(this), "Allow", { requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQUEST_RECORDINGS) })
            steps += Step("Call recorder switch", "Android only lets an app use the microphone during a call through Accessibility. It reads nothing on your screen.",
                CallRecorder.accessibilityOn(this), "Open", { startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) },
                help = "Settings → Accessibility → Installed apps → Voice Tunes India call recorder → On." +
                    if (Build.VERSION.SDK_INT >= 33) " Greyed out (“Restricted setting”)? Open App info, tap ⋮ → “Allow restricted settings”, then try again." else "",
                secondary = if (Build.VERSION.SDK_INT >= 33) "Open App info" to appInfo else null)
        }
        val pm = getSystemService(PowerManager::class.java)
        steps += Step("Unrestricted battery", "Stops the phone from pausing sync and the Call button in the background.",
            pm == null || pm.isIgnoringBatteryOptimizations(packageName), "Open", appInfo,
            help = "App info → Battery → Unrestricted.")
        return steps
    }

    private fun renderSetup() = with(ui) {
        val steps = setupSteps()
        val left = steps.count { !it.done }
        root.addView(sectionTitle("Setup"))
        val card = card()
        val head = LinearLayout(this@MainActivity).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        head.addView(text(if (left == 0) "All set" else "$left step${if (left == 1) "" else "s"} left", 17f, bold = true).apply {
            layoutParams = LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f)
        })
        head.addView(pill("${steps.size - left} of ${steps.size}", if (left == 0) Palette.green else Palette.amber, if (left == 0) Palette.greenSoft else Palette.amberSoft))
        card.addView(head)
        if (left == 0) card.addView(text("Calls are tracked, the Call button works${if (prefs.recordCalls) " and calls are recorded" else ""}.", 13f, Palette.muted).withMargins(top = 4))

        steps.forEachIndexed { index, step ->
            card.addView(divider())
            val row = LinearLayout(this@MainActivity).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.TOP }
            row.addView(stepMarker(step.done, index + 1))
            val body = LinearLayout(this@MainActivity).apply { orientation = LinearLayout.VERTICAL; layoutParams = LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f) }
            body.addView(text(step.title, 15f, if (step.done) Palette.muted else Palette.ink, bold = true))
            if (!step.done) {
                body.addView(text(step.detail, 13f, Palette.muted).withMargins(top = 2))
                step.help?.let { body.addView(text(it, 12f, Palette.muted).withMargins(top = 6)) }
                step.secondary?.let { (label, action) ->
                    body.addView(smallButton(label, primary = false, onClick = action).apply {
                        layoutParams = LinearLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT).apply { topMargin = dp(8) }
                    })
                }
            }
            row.addView(body)
            if (!step.done && step.action != null && step.onAction != null) {
                row.addView(smallButton(step.action, onClick = step.onAction).apply {
                    layoutParams = LinearLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT).apply { marginStart = dp(10) }
                })
            }
            card.addView(row)
        }
        root.addView(card)
    }

    private fun renderRecording() = with(ui) {
        root.addView(sectionTitle("Call recording"))
        val card = card()
        card.addView(switchRow("Record calls", "Sends each call's recording to the CRM, which turns it into text in the language spoken.", prefs.recordCalls) { checked ->
            prefs.recordCalls = checked
            if (checked && !CallRecorder.hasMicPermission(this@MainActivity)) requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQUEST_RECORDINGS)
            root.post { render() }
        })
        if (prefs.recordCalls) {
            val ready = CallRecorder.ready(this@MainActivity)
            val waiting = LocalRecordings.count(this@MainActivity)
            val (label, color, bg) = when {
                !ready -> Triple("Finish the setup steps above to start recording", Palette.amber, Palette.amberSoft)
                prefs.lastRecordingSilent -> Triple(prefs.lastRecordingMessage, Palette.amber, Palette.amberSoft)
                else -> Triple(prefs.lastRecordingMessage.ifEmpty { "Ready — your next call will be recorded" }, Palette.green, Palette.greenSoft)
            }
            card.addView(text(label, 13f, color).apply {
                setPadding(dp(12), dp(10), dp(12), dp(10))
                background = rounded(bg, 10)
            }.withMargins(top = 14))
            if (waiting > 0) card.addView(text("$waiting recording${if (waiting == 1) "" else "s"} waiting to upload", 13f, Palette.muted).withMargins(top = 8))
            card.addView(divider())
            card.addView(switchRow("Upload on Wi-Fi only", "Saves mobile data; recordings wait until you're on Wi-Fi.", prefs.recordingsWifiOnly) { prefs.recordingsWifiOnly = it })
            card.addView(text("Your voice is always clear; the customer's is clearest on speaker. Recordings are deleted from the phone once uploaded.", 12f, Palette.muted).withMargins(top = 12))
        }
        root.addView(card)
    }

    private fun renderAfterCall() = with(ui) {
        root.addView(sectionTitle("After-call form"))
        val card = card()
        card.addView(text("When should the form open?", 15f, bold = true))
        card.addView(text("Log the outcome, a note and the next follow-up while the call is fresh.", 13f, Palette.muted).withMargins(top = 2, bottom = 12))
        card.addView(segmented(listOf("all" to "Every call", "leads" to "Leads only", "off" to "Off"), prefs.afterCallMode) { mode ->
            prefs.afterCallMode = mode
            root.post { render() }
        })
        val note = when {
            prefs.afterCallMode == "all" && prefs.leadsOnly -> "Personal phone is on, so the form only opens for CRM leads."
            prefs.afterCallMode == "all" -> "New numbers can be added as leads straight from the form."
            prefs.afterCallMode == "leads" -> "Opens only after calls with numbers that are CRM leads."
            else -> "Missed calls from your leads still show a call-back reminder."
        }
        card.addView(text(note, 12f, Palette.muted).withMargins(top = 10))
        root.addView(card)
    }

    private fun renderPhoneType() = with(ui) {
        root.addView(sectionTitle("This phone"))
        val card = card()
        card.addView(switchRow("Personal phone", "Only send calls with numbers that are CRM leads. Leave off on company phones so new enquiries can become leads.", prefs.leadsOnly) {
            prefs.leadsOnly = it
            root.post { render() }
        })
        root.addView(card)
    }

    private fun renderAccount() = with(ui) {
        root.addView(sectionTitle("Account"))
        root.addView(card().apply {
            addView(text(prefs.userName, 15f, bold = true))
            addView(text(Uri.parse(prefs.serverUrl).host ?: prefs.serverUrl, 13f, Palette.muted).withMargins(top = 2))
            addView(secondaryButton("Sign out") {
                prefs.signOut()
                LocalRecordings.clear(this@MainActivity)
                SyncWorker.cancelAll(this@MainActivity)
                DialerService.stop(this@MainActivity)
                resetCaches()
                tab = TAB_HOME
                render()
            }.apply { setTextColor(Palette.red) })
        })
        root.addView(text("App ${BuildConfig.VERSION_NAME}", 12f, Palette.muted).apply { gravity = Gravity.CENTER }.withMargins(top = 8))
    }

    // ─── Helpers ────────────────────────────────────────────────────────────────────────────────────────────

    private fun resetCaches() {
        home = null; homeAt = 0L; homeError = null
        leadRows = JSONArray(); leadTotal = 0; leadsLoaded = false; leadsError = null; leadFilter = "due"; leadSearch = ""
    }

    private fun logo(widthDp: Int) = ImageView(this).apply {
        setImageResource(R.drawable.vti_logo)
        contentDescription = "Voice Tunes India"
        adjustViewBounds = true
        scaleType = ImageView.ScaleType.FIT_START
        layoutParams = LinearLayout.LayoutParams(ui.dp(widthDp), WRAP_CONTENT)
    }

    private fun statRow(stats: List<Pair<String, String>>, color: Int) = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        stats.forEach { (value, label) ->
            addView(LinearLayout(this@MainActivity).apply {
                orientation = LinearLayout.VERTICAL
                layoutParams = LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f)
                addView(ui.text(value, 24f, color, bold = true))
                addView(ui.text(label, 12f, Color.parseColor("#B8B4AA")))
            })
        }
    }

    private fun loadingRow(label: String) = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        addView(ProgressBar(this@MainActivity).apply { layoutParams = LinearLayout.LayoutParams(ui.dp(20), ui.dp(20)) })
        addView(ui.text(label, 14f, Palette.muted).apply { setPadding(ui.dp(10), 0, 0, 0) })
    }

    private fun stagePill(stage: String): TextView {
        val (label, fg, bg) = when (stage) {
            "WON" -> Triple("Won", Palette.green, Palette.greenSoft)
            "LOST" -> Triple("Lost", Palette.red, Palette.redSoft)
            "AWARENESS" -> Triple("New", Palette.ink, Palette.yellowSoft)
            else -> Triple(STAGES[stage] ?: stage.lowercase().replaceFirstChar { it.uppercase() }, Palette.ink, Palette.page)
        }
        return ui.pill(label, fg, bg).apply { typeface = Typeface.DEFAULT_BOLD }
    }

    private fun <T : View> T.withMarginsOf(top: Int = 0, bottom: Int = 0): T = with(ui) { withMargins(top = top, bottom = bottom) }

    private fun JSONObject.str(key: String): String? = if (isNull(key)) null else optString(key).takeIf { it.isNotBlank() && it != "null" }

    private fun friendlyError(e: Exception): String = when (e) {
        is java.net.UnknownHostException, is java.net.ConnectException -> "No connection to the CRM. Check the internet and try again."
        is java.net.SocketTimeoutException -> "The CRM took too long to answer. Try again."
        else -> e.message ?: "Something went wrong"
    }

    private fun parseIso(value: String): Long? = runCatching { Instant.parse(value).toEpochMilli() }.getOrNull()

    private fun startOfToday(): Long = Calendar.getInstance().apply {
        set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
    }.timeInMillis

    private fun formatWhen(millis: Long): String {
        val time = SimpleDateFormat("h:mm a", Locale.getDefault()).format(Date(millis))
        return when (Math.floorDiv(millis - startOfToday(), 86_400_000L)) {
            0L -> "today $time"
            1L -> "tomorrow $time"
            -1L -> "yesterday $time"
            else -> SimpleDateFormat("d MMM, h:mm a", Locale.getDefault()).format(Date(millis))
        }
    }

    /** "crm.example.com" → https://crm.example.com; office addresses like 192.168.1.4:3000 stay on http */
    private fun normalizeServerUrl(raw: String): String {
        val value = raw.trim().trimEnd('/')
        if (value.startsWith("http://") || value.startsWith("https://")) return value
        val host = value.substringBefore('/').substringBefore(':')
        val local = host == "localhost" || host.matches(Regex("""\d{1,3}(\.\d{1,3}){3}""")) || host.endsWith(".local")
        return (if (local) "http://" else "https://") + value
    }

    private fun requestNeededPermissions() {
        val wanted = mutableListOf(Manifest.permission.READ_CALL_LOG, Manifest.permission.READ_PHONE_STATE, Manifest.permission.CALL_PHONE)
        if (Build.VERSION.SDK_INT >= 33) wanted += Manifest.permission.POST_NOTIFICATIONS
        val missing = wanted.filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isNotEmpty()) {
            requestPermissions(missing.toTypedArray(), 1)
        } else {
            SyncWorker.syncSoon(this, 0)
            DialerService.start(this)
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQUEST_RECORDINGS) {
            if (!CallRecorder.hasMicPermission(this) && !shouldShowRequestPermissionRationale(Manifest.permission.RECORD_AUDIO)) {
                toast("Allow “Microphone” in App info → Permissions")
                startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
            }
            render()
            return
        }
        if (DialerService.canDial(this)) DialerService.start(this)
        val denied = permissions.filterIndexed { i, _ -> grantResults.getOrNull(i) != PackageManager.PERMISSION_GRANTED }
        if (CallSync.hasPermission(this)) SyncWorker.syncSoon(this, 0)
        if (denied.isEmpty()) {
            toast("Call tracking and the CRM Call button are on")
        } else if (denied.any { it != Manifest.permission.POST_NOTIFICATIONS && !shouldShowRequestPermissionRationale(it) }) {
            toast("Enable “Call logs” and “Phone” in App info → Permissions")
            startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
        }
        render()
    }

    private fun toast(message: String) = android.widget.Toast.makeText(this, message, android.widget.Toast.LENGTH_LONG).show()

    private companion object {
        const val REQUEST_RECORDINGS = 3
        const val TAB_HOME = "home"
        const val TAB_LEADS = "leads"
        const val TAB_MORE = "more"
        const val PAGE_SIZE = 30
        const val AUTO_SYNC_MS = 60_000L

        /** The CRM's lead lists (GET /crm/leads?status=…) */
        val LEAD_FILTERS = listOf(
            "due" to "Due",
            "today" to "Today",
            "overdue" to "Overdue",
            "pending" to "New",
            "open" to "Open",
            "all" to "All",
        )
        val STAGES = mapOf("AWARENESS" to "New", "CONTACTED" to "Contacted", "PROPOSAL" to "Proposal", "NEGOTIATION" to "Negotiation", "WON" to "Won", "LOST" to "Lost")
        val OUTCOMES = mapOf(
            "CONNECTED" to "Connected", "CALL_BACK" to "Call back", "NOT_REACHABLE" to "Not reachable", "INTERESTED" to "Interested",
            "NOT_INTERESTED" to "Not interested", "CONVERTED" to "Converted", "LOST" to "Lost",
        )
    }

    override fun onDestroy() {
        io.shutdown()
        syncer.shutdown()
        super.onDestroy()
    }
}
