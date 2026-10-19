package `in`.voicetunesindia.os

import android.app.Activity
import android.app.DatePickerDialog
import android.app.NotificationManager
import android.app.TimePickerDialog
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.TextView
import android.widget.Toast
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.text.DateFormat
import java.text.SimpleDateFormat
import java.time.Instant
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.UUID
import java.util.concurrent.Executors

/**
 * The form that opens when a call ends. It is required: every question must be answered before it can be
 * saved, and it can't be dismissed (a new number that isn't a customer can be marked as a personal call).
 *
 *   Did the call connect? → Is the customer interested? → Was a sample shared?
 *   Business type (B2B or B2C)
 *   Next follow-up, at most 72 hours after the call — or, if not interested, the reason
 *
 * Saving sends one request that stores the call, updates the lead and logs the follow-up; the CRM checks the
 * same rules. Without a connection the form is kept on the phone and uploaded by the next sync.
 */
class AfterCallActivity : Activity() {

    private lateinit var prefs: Prefs
    private val io = Executors.newSingleThreadExecutor()
    private lateinit var sheet: LinearLayout
    private lateinit var call: PhoneCall
    private lateinit var clientRef: String

    // Form state
    private var lookup: JSONObject? = null
    private var leadId: String? = null
    private var connected: Boolean? = null
    private var interested: Boolean? = null
    private var sampleShared: Boolean? = null
    private var businessType: String? = null
    private var nextAt: Long? = null
    private var lostReason: String = DEFAULT_LOST_REASONS[0]
    private var serviceId: String? = null
    private var saving = false

    // Inputs kept across re-renders of the questions
    private lateinit var noteInput: EditText
    private var nameInput: EditText? = null
    private var cityInput: EditText? = null
    private var emailInput: EditText? = null
    private var detailsOpen = false
    private lateinit var questions: LinearLayout
    private lateinit var errorText: TextView
    private lateinit var saveButton: Button

    private val ink = Palette.ink
    private val brandYellow = Palette.yellow
    private val muted = Palette.muted
    private val line = Palette.line
    private val soft = Palette.page
    private val danger = Palette.red

    /** The latest the next follow-up may be: 72 hours after the call ended (or after now, for a form filled in late) */
    private val followupLimit: Long get() = maxOf(call.startedAt + call.durationSec * 1000, System.currentTimeMillis()) + FOLLOWUP_WINDOW_MS

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)
        if (!prefs.isSignedIn) {
            finish()
            return
        }
        call = PhoneCall(
            phone = intent.getStringExtra(EXTRA_PHONE) ?: run { finish(); return },
            direction = intent.getStringExtra(EXTRA_DIRECTION) ?: "outgoing",
            startedAt = intent.getLongExtra(EXTRA_STARTED_AT, System.currentTimeMillis()),
            durationSec = intent.getLongExtra(EXTRA_DURATION, 0L),
            contactName = intent.getStringExtra(EXTRA_CONTACT),
        )
        clientRef = savedInstanceState?.getString("clientRef") ?: UUID.randomUUID().toString()
        // An outgoing call nobody picked up didn't connect
        if (call.direction == "outgoing" && call.durationSec == 0L) connected = false

        // A dimmed backdrop with the form as a sheet at the bottom, like a dialog
        val root = FrameLayout(this).apply {
            setBackgroundColor(Color.parseColor("#99000000"))
            fitsSystemWindows = true
            setOnClickListener { /* taps outside the sheet don't dismiss: the form is required */ }
        }
        sheet = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(18), dp(20), dp(20))
        }
        val scroll = ScrollView(this).apply {
            isFillViewport = false
            background = GradientDrawable().apply {
                setColor(Color.WHITE)
                cornerRadii = floatArrayOf(dp(20).toFloat(), dp(20).toFloat(), dp(20).toFloat(), dp(20).toFloat(), 0f, 0f, 0f, 0f)
            }
            addView(sheet)
        }
        root.addView(scroll, FrameLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT, Gravity.BOTTOM).apply { topMargin = dp(48) })
        setContentView(root)

        val passed = intent.getStringExtra(EXTRA_LOOKUP)?.let { runCatching { JSONObject(it) }.getOrNull() }
        if (passed != null) {
            lookup = passed
            renderForm()
        } else {
            renderLoading()
            io.execute {
                val result = try {
                    ApiClient(prefs).post("/calls/after-call/lookup", JSONObject().put("phone", call.phone), readTimeoutMs = 10_000)
                } catch (e: Exception) {
                    null
                }
                runOnUiThread {
                    if (isFinishing) return@runOnUiThread
                    lookup = result
                    renderForm()
                }
            }
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        if (::clientRef.isInitialized) outState.putString("clientRef", clientRef)
    }

    override fun onDestroy() {
        io.shutdown()
        super.onDestroy()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        // Only someone else's lead has nothing to fill in
        if (lookup?.optBoolean("otherOwner") == true) return done()
        Toast.makeText(this, "Answer the questions and save — this form is required after every call", Toast.LENGTH_SHORT).show()
    }

    /** Closes the form for good, with its reminder notification */
    private fun done() {
        getSystemService(NotificationManager::class.java).cancel(intent.getIntExtra(EXTRA_NOTIFICATION, 0))
        finish()
    }

    // ─── Screens ────────────────────────────────────────────────────────────────────────────────────────────

    private fun header() {
        sheet.addView(text("Log this call", 20f, ink, bold = true))
        val time = DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(call.startedAt))
        sheet.addView(text("${AfterCall.describe(call)} · $time · required", 13f, muted).margin(top = 2, bottom = 12))
    }

    private fun renderLoading() {
        sheet.removeAllViews()
        header()
        sheet.addView(text(call.contactName?.takeIf { it.isNotBlank() } ?: call.phone, 17f, ink, bold = true))
        sheet.addView(LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            addView(ProgressBar(this@AfterCallActivity).apply { layoutParams = LinearLayout.LayoutParams(dp(22), dp(22)) })
            addView(text("Looking up this number in the CRM…", 14f, muted).apply { setPadding(dp(10), 0, 0, 0) })
        }.margin(top = 16, bottom = 16))
    }

    private fun renderForm() {
        sheet.removeAllViews()
        header()
        val data = lookup
        val lead = data?.optJSONObject("lead")
        leadId = lead?.optString("id")?.takeIf { it.isNotBlank() }
        serviceId = serviceId ?: lead?.optNullableString("serviceId")
        businessType = businessType ?: lead?.optNullableString("businessType")?.takeIf { it in BUSINESS_TYPES }

        when {
            data?.optBoolean("otherOwner") == true -> {
                sheet.addView(card("#FEF2F2").apply {
                    addView(text(call.phone, 16f, ink, bold = true))
                    addView(text("This number is another BDM's lead. The call is logged automatically; there's nothing to fill in.", 14f, muted).margin(top = 4))
                })
                sheet.addView(primaryButton("Close").apply { setOnClickListener { done() } })
                return
            }
            lead != null -> renderLeadCard(lead, data.optJSONArray("history"))
            else -> renderNewNumber(offline = data == null)
        }

        questions = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        sheet.addView(questions)

        sheet.addView(label("Note"))
        noteInput = input("What did the customer say?", "", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES, singleLine = false).apply {
            minLines = 2
            gravity = Gravity.TOP or Gravity.START
        }
        sheet.addView(noteInput)
        renderQuestions()

        if (lead != null) renderDetailsToggle(lead)

        errorText = text("", 14f, danger).margin(top = 10)
        errorText.visibility = View.GONE
        sheet.addView(errorText)

        saveButton = primaryButton(if (lead == null && data != null) "Save & add as lead" else "Save to CRM").apply { setOnClickListener { save(skip = false) } }
        sheet.addView(saveButton)
        // A new number may be a personal call; a lead's form must be filled in
        if (lead == null) {
            sheet.addView(secondaryButton("Personal call — not a customer").apply {
                layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { topMargin = dp(10) }
                setOnClickListener { save(skip = true) }
            })
        }
    }

    private fun renderLeadCard(lead: JSONObject, history: JSONArray?) {
        sheet.addView(card().apply {
            val top = LinearLayout(this@AfterCallActivity).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
            top.addView(text(lead.optNullableString("name") ?: call.phone, 17f, ink, bold = true).apply { layoutParams = LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f) })
            top.addView(badge(lead.optNullableString("stageLabel") ?: lead.optString("stage")))
            addView(top)
            val facts = listOfNotNull(
                lead.optNullableString("phone") ?: call.phone,
                lead.optNullableString("service"),
                lead.optNullableString("city"),
                lead.optNullableString("businessType"),
            ).joinToString(" · ")
            addView(text(facts, 13f, muted).margin(top = 2))
            lead.optNullableString("nextFollowupAt")?.let { iso ->
                parseIso(iso)?.let { addView(text("Follow-up was due ${formatWhen(it)}", 13f, if (it < System.currentTimeMillis()) danger else muted).margin(top = 4)) }
            }
            if (lead.optNullableString("sampleSharedAt") != null) addView(text("✓ Sample already shared", 13f, Palette.green).margin(top = 4))
            lead.optNullableString("statusLabel")?.let { addView(text("Status: $it", 13f, ink).margin(top = 4)) }
            // The last few calls with their remarks, so the BDM knows where the conversation stands
            for (i in 0 until minOf(history?.length() ?: 0, 3)) {
                val h = history!!.getJSONObject(i)
                val whenText = h.optNullableString("createdAt")?.let { parseIso(it) }?.let { formatWhen(it) } ?: ""
                val what = listOfNotNull(h.optNullableString("callActivity") ?: h.optString("outcomeLabel"), h.optNullableString("statusLabel")?.let { "→ $it" }).joinToString(" ")
                addView(text("$what${if (whenText.isNotEmpty()) " · $whenText" else ""}", 13f, ink, bold = true).margin(top = if (i == 0) 8 else 6))
                h.optNullableString("note")?.let { addView(text("“$it”", 13f, muted)) }
            }
        })
    }

    private fun renderNewNumber(offline: Boolean) {
        sheet.addView(card("#FFFBEB").apply {
            addView(text(call.phone, 17f, ink, bold = true))
            addView(text(
                if (offline) "No connection to the CRM right now. Fill this in anyway — it's saved on the phone and sent when you're back online."
                else "New number — not in the CRM yet. Add the customer's name to create the lead, or mark it as a personal call.",
                13f, muted,
            ).margin(top = 4))
        })
        sheet.addView(label("Customer name"))
        nameInput = input("Name", call.contactName ?: "", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_WORDS).also { sheet.addView(it) }
        sheet.addView(label("City"))
        cityInput = input("City (optional)", "", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_WORDS).also { sheet.addView(it) }
        serviceSpinner()?.let { sheet.addView(label("Service")); sheet.addView(it) }
    }

    private fun renderDetailsToggle(lead: JSONObject) {
        val container = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val toggle = text("✎  Update customer details", 14f, ink, bold = true).margin(top = 14)
        toggle.setOnClickListener {
            detailsOpen = !detailsOpen
            container.removeAllViews()
            if (detailsOpen) {
                container.addView(label("Name"))
                nameInput = input("Name", lead.optNullableString("name") ?: "", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_WORDS).also { container.addView(it) }
                container.addView(label("City"))
                cityInput = input("City", lead.optNullableString("city") ?: "", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_WORDS).also { container.addView(it) }
                container.addView(label("Email"))
                emailInput = input("Email", lead.optNullableString("email") ?: "", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS).also { container.addView(it) }
                serviceSpinner()?.let { container.addView(label("Service")); container.addView(it) }
            } else {
                nameInput = null; cityInput = null; emailInput = null
            }
        }
        sheet.addView(toggle)
        sheet.addView(container)
    }

    /** The required questions; each answer shows the next one */
    private fun renderQuestions() {
        questions.removeAllViews()
        questions.addView(label("1. Did the call connect?"))
        questions.addView(yesNo(connected) {
            connected = it
            if (!it) { interested = null; sampleShared = null }
        })
        var step = 2
        if (connected == true) {
            questions.addView(label("${step++}. Is the customer interested?"))
            questions.addView(yesNo(interested) {
                interested = it
                if (!it) sampleShared = null
            })
        }
        if (interested == true) {
            questions.addView(label("${step++}. Sample shared?"))
            questions.addView(yesNo(sampleShared) { sampleShared = it })
        }
        questions.addView(label("${step++}. Business type"))
        questions.addView(choiceRow(BUSINESS_TYPES.map { it to it }, businessType) { businessType = it })

        if (connected == true && interested == false) {
            questions.addView(label("${step}. Why not interested?"))
            val reasons = lostReasons()
            if (lostReason !in reasons) lostReason = if ("Not interested" in reasons) "Not interested" else reasons.first()
            questions.addView(spinner(reasons, reasons.indexOf(lostReason)) { lostReason = reasons[it] })
            questions.addView(text("The lead will be closed as lost.", 12f, muted).margin(top = 4))
        } else if (connected != null) {
            renderFollowup(step)
        }
    }

    /** Next follow-up: required, between now and 72 hours after the call */
    private fun renderFollowup(step: Int) {
        val limit = followupLimit
        if (nextAt?.let { it > limit } == true) nextAt = null
        questions.addView(label("$step. Next follow-up (within 72 hours)"))
        questions.addView(text(nextAt?.let { formatWhen(it) } ?: "Choose when to follow up", 16f, if (nextAt != null) ink else danger, bold = nextAt != null).margin(bottom = 4))
        val now = System.currentTimeMillis()
        val quick = mutableListOf<Pair<String, Long>>()
        quick += "In 1 hour" to roundUp(now + 3_600_000L)
        if (Calendar.getInstance().get(Calendar.HOUR_OF_DAY) < 17) quick += "This evening" to at(daysAhead = 0, hour = 18)
        quick += "Tomorrow 11 AM" to at(daysAhead = 1, hour = 11)
        quick += "In 2 days" to at(daysAhead = 2, hour = 11)
        quick += "In 3 days" to at(daysAhead = 3, hour = 11)
        val wrap = FlowRow(this)
        quick.filter { (_, value) -> value in now..limit }.forEach { (labelText, value) ->
            wrap.addView(smallChip(labelText, value == nextAt).apply {
                setOnClickListener {
                    nextAt = value
                    renderQuestions()
                }
            })
        }
        wrap.addView(smallChip("Pick date & time…", false).apply { setOnClickListener { pickDateTime() } })
        questions.addView(wrap)
        questions.addView(text("Latest allowed: ${formatWhen(limit)}", 12f, muted).margin(top = 2))
    }

    // ─── Saving ─────────────────────────────────────────────────────────────────────────────────────────────

    private fun save(skip: Boolean) {
        if (saving) return
        val isNew = leadId == null
        val needsFollowup = !(connected == true && interested == false)
        if (!skip) {
            when {
                isNew && nameInput?.text.isNullOrBlank() -> return showError("Add the customer's name to create the lead")
                connected == null -> return showError("Answer: did the call connect?")
                connected == true && interested == null -> return showError("Answer: is the customer interested?")
                interested == true && sampleShared == null -> return showError("Answer: was a sample shared?")
                businessType == null -> return showError("Choose the business type: B2B or B2C")
                needsFollowup && nextAt == null -> return showError("Set the next follow-up (within 72 hours of the call)")
                needsFollowup && nextAt!! > followupLimit -> return showError("The next follow-up must be within 72 hours of the call")
            }
        }
        val body = JSONObject()
            .put("clientRef", clientRef)
            .put("deviceId", CallSync.deviceId(this))
            .put("leadsOnly", prefs.leadsOnly)
            .put("call", JSONObject()
                .put("phone", call.phone)
                .put("direction", call.direction)
                .put("startedAt", call.startedAt)
                .put("durationSec", call.durationSec)
                .put("contactName", call.contactName ?: JSONObject.NULL))
        if (skip) {
            body.put("skip", true)
        } else {
            val outcome = when {
                connected == false -> "NOT_REACHABLE"
                interested == true -> "INTERESTED"
                else -> "NOT_INTERESTED"
            }
            body.put("form", 2)
                .put("outcome", outcome)
                .put("connected", connected)
                .put("businessType", businessType)
                .put("note", noteInput.text.toString().trim())
            if (connected == true) body.put("interested", interested)
            if (interested == true) body.put("sampleShared", sampleShared)
            if (needsFollowup) body.put("nextFollowupAt", Instant.ofEpochMilli(nextAt!!).toString()) else body.put("lostReason", lostReason)
            if (isNew) {
                body.put("newLead", JSONObject()
                    .put("name", nameInput?.text?.toString()?.trim() ?: "")
                    .put("city", cityInput?.text?.toString()?.trim() ?: "")
                    .put("serviceId", serviceId ?: JSONObject.NULL))
            } else {
                body.put("leadId", leadId)
                if (detailsOpen) {
                    body.put("details", JSONObject()
                        .put("name", nameInput?.text?.toString()?.trim() ?: "")
                        .put("city", cityInput?.text?.toString()?.trim() ?: "")
                        .put("email", emailInput?.text?.toString()?.trim() ?: "")
                        .put("serviceId", serviceId ?: JSONObject.NULL))
                }
            }
        }

        saving = true
        saveButton.isEnabled = false
        saveButton.text = "Saving…"
        errorText.visibility = View.GONE
        io.execute {
            val message: String? = try {
                val result = ApiClient(prefs).post("/calls/after-call", body, readTimeoutMs = 20_000)
                when {
                    skip -> "Call logged"
                    result.optString("status") == "lead-created" -> "Lead added: ${result.optJSONObject("lead")?.optString("name") ?: ""}"
                    needsFollowup -> "Saved — next follow-up ${formatWhen(nextAt!!)}"
                    else -> "Saved to the CRM"
                }
            } catch (e: AuthExpiredException) {
                PendingForms.add(this, body)
                "Saved on the phone. Open the app and sign in again to upload it."
            } catch (e: ApiException) {
                runOnUiThread {
                    saving = false
                    saveButton.isEnabled = true
                    saveButton.text = if (leadId == null) "Save & add as lead" else "Save to CRM"
                    showError(e.message ?: "The CRM couldn't save this")
                }
                null
            } catch (e: IOException) {
                PendingForms.add(this, body)
                SyncWorker.syncSoon(this, 60)
                "No connection — saved on the phone, it will upload automatically"
            }
            if (message != null) runOnUiThread {
                Toast.makeText(this, message, Toast.LENGTH_LONG).show()
                done()
            }
        }
    }

    private fun showError(message: String) {
        errorText.text = message
        errorText.visibility = View.VISIBLE
    }

    // ─── Choices ────────────────────────────────────────────────────────────────────────────────────────────

    private fun lostReasons(): List<String> {
        val fromServer = lookup?.optJSONObject("options")?.optJSONArray("lostReasons")
        if (fromServer != null && fromServer.length() > 0) return (0 until fromServer.length()).map { fromServer.getString(it) }
        return DEFAULT_LOST_REASONS
    }

    private fun serviceSpinner(): Spinner? {
        val list = lookup?.optJSONObject("options")?.optJSONArray("services") ?: return null
        if (list.length() == 0) return null
        val ids = mutableListOf<String?>(null)
        val names = mutableListOf("— Not sure —")
        for (i in 0 until list.length()) {
            val s = list.getJSONObject(i)
            ids += s.getString("id")
            names += s.getString("name")
        }
        return spinner(names, ids.indexOf(serviceId).coerceAtLeast(0)) { serviceId = ids[it] }
    }

    private fun pickDateTime() {
        val limit = followupLimit
        val now = System.currentTimeMillis()
        val start = Calendar.getInstance().apply { timeInMillis = (nextAt ?: at(daysAhead = 1, hour = 11)).coerceIn(now, limit) }
        DatePickerDialog(this, { _, year, month, day ->
            TimePickerDialog(this, { _, hour, minute ->
                val picked = Calendar.getInstance().apply { set(year, month, day, hour, minute, 0); set(Calendar.MILLISECOND, 0) }.timeInMillis
                when {
                    picked < now - 60_000 -> showError("Pick a time that hasn't passed")
                    picked > limit -> showError("Pick a time within 72 hours of the call — by ${formatWhen(limit)}")
                    else -> {
                        nextAt = picked
                        errorText.visibility = View.GONE
                        renderQuestions()
                    }
                }
            }, start.get(Calendar.HOUR_OF_DAY), start.get(Calendar.MINUTE), false).show()
        }, start.get(Calendar.YEAR), start.get(Calendar.MONTH), start.get(Calendar.DAY_OF_MONTH)).apply {
            datePicker.minDate = now - 60_000
            datePicker.maxDate = limit
        }.show()
    }

    // ─── Time helpers ───────────────────────────────────────────────────────────────────────────────────────

    private fun at(daysAhead: Int, hour: Int): Long = Calendar.getInstance().apply {
        add(Calendar.DAY_OF_YEAR, daysAhead)
        set(Calendar.HOUR_OF_DAY, hour); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
    }.timeInMillis

    /** Rounded up to the next quarter hour */
    private fun roundUp(millis: Long): Long {
        val quarter = 15 * 60_000L
        return ((millis + quarter - 1) / quarter) * quarter
    }

    private fun parseIso(value: String): Long? = runCatching { Instant.parse(value).toEpochMilli() }.getOrNull()

    private fun formatWhen(millis: Long): String {
        val target = Calendar.getInstance().apply { timeInMillis = millis }
        val today = Calendar.getInstance()
        val time = SimpleDateFormat("h:mm a", Locale.getDefault()).format(Date(millis))
        val dayDiff = ((startOfDay(target) - startOfDay(today)) / 86_400_000L).toInt()
        return when (dayDiff) {
            0 -> "today $time"
            1 -> "tomorrow $time"
            -1 -> "yesterday $time"
            else -> SimpleDateFormat("EEE d MMM, h:mm a", Locale.getDefault()).format(Date(millis))
        }
    }

    private fun startOfDay(c: Calendar): Long = (c.clone() as Calendar).apply {
        set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
    }.timeInMillis

    // ─── Tiny view helpers ──────────────────────────────────────────────────────────────────────────────────

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    private fun text(value: String, size: Float, color: Int, bold: Boolean = false) = TextView(this).apply {
        text = value
        textSize = size
        setTextColor(color)
        if (bold) typeface = Typeface.DEFAULT_BOLD
    }

    private fun label(value: String) = text(value, 14f, ink, bold = true).margin(top = 16, bottom = 4)

    private fun input(hint: String, value: String, type: Int, singleLine: Boolean = true) = EditText(this).apply {
        this.hint = hint
        setText(value)
        inputType = type
        if (singleLine) setSingleLine()
        setTextColor(ink)
        setPadding(dp(14), dp(12), dp(14), dp(12))
        background = GradientDrawable().apply { cornerRadius = dp(10).toFloat(); setStroke(dp(1), line) }
    }

    /** Yes / No as two big buttons; an answer redraws the questions that follow from it */
    private fun yesNo(value: Boolean?, onPick: (Boolean) -> Unit) =
        choiceRow(listOf("yes" to "Yes", "no" to "No"), value?.let { if (it) "yes" else "no" }) { onPick(it == "yes") }

    private fun choiceRow(options: List<Pair<String, String>>, selected: String?, onPick: (String) -> Unit) = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        options.forEachIndexed { index, (key, labelText) ->
            addView(chip(labelText, key == selected).apply {
                layoutParams = LinearLayout.LayoutParams(0, dp(48), 1f).apply { if (index < options.size - 1) rightMargin = dp(8) }
                setOnClickListener {
                    onPick(key)
                    errorText.visibility = View.GONE
                    renderQuestions()
                }
            })
        }
    }

    private fun chip(value: String, selected: Boolean) = TextView(this).apply {
        text = value
        textSize = 15f
        gravity = Gravity.CENTER
        setTextColor(ink)
        if (selected) typeface = Typeface.DEFAULT_BOLD
        background = GradientDrawable().apply {
            cornerRadius = dp(10).toFloat()
            if (selected) setColor(brandYellow) else setStroke(dp(1), line)
        }
    }

    private fun smallChip(value: String, selected: Boolean) = TextView(this).apply {
        text = value
        textSize = 13f
        setTextColor(ink)
        setPadding(dp(12), dp(8), dp(12), dp(8))
        if (selected) typeface = Typeface.DEFAULT_BOLD
        background = GradientDrawable().apply {
            cornerRadius = dp(16).toFloat()
            if (selected) setColor(brandYellow) else setStroke(dp(1), line)
        }
    }

    private fun badge(value: String) = TextView(this).apply {
        text = value
        textSize = 12f
        setTextColor(ink)
        typeface = Typeface.DEFAULT_BOLD
        setPadding(dp(10), dp(3), dp(10), dp(3))
        background = GradientDrawable().apply { cornerRadius = dp(12).toFloat(); setColor(brandYellow) }
    }

    private fun spinner(items: List<String>, selected: Int, onPick: (Int) -> Unit) = Spinner(this).apply {
        adapter = ArrayAdapter(this@AfterCallActivity, android.R.layout.simple_spinner_dropdown_item, items)
        setSelection(selected.coerceIn(0, (items.size - 1).coerceAtLeast(0)))
        background = GradientDrawable().apply { cornerRadius = dp(10).toFloat(); setStroke(dp(1), line) }
        setPadding(dp(6), dp(6), dp(6), dp(6))
        onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) = onPick(position)
            override fun onNothingSelected(parent: AdapterView<*>?) {}
        }
    }

    private fun primaryButton(value: String) = Button(this).apply {
        text = value
        isAllCaps = false
        setTextColor(Color.BLACK)
        typeface = Typeface.DEFAULT_BOLD
        background = GradientDrawable().apply { cornerRadius = dp(10).toFloat(); setColor(brandYellow) }
    }.margin(top = 16)

    private fun secondaryButton(value: String) = Button(this).apply {
        text = value
        isAllCaps = false
        setTextColor(ink)
        background = GradientDrawable().apply { cornerRadius = dp(10).toFloat(); setStroke(dp(1), line) }
    }

    private fun card(color: String? = null) = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(14), dp(12), dp(14), dp(12))
        background = GradientDrawable().apply { cornerRadius = dp(12).toFloat(); setColor(color?.let { Color.parseColor(it) } ?: soft) }
    }

    private fun <T : View> T.margin(top: Int = 0, bottom: Int = 0): T = apply {
        layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { topMargin = dp(top); bottomMargin = dp(bottom) }
    }

    private fun JSONObject.optNullableString(key: String): String? =
        if (isNull(key)) null else optString(key).takeIf { it.isNotBlank() && it != "null" }

    /** Lays chips out left to right, wrapping onto new lines */
    private class FlowRow(context: Context) : android.view.ViewGroup(context) {
        private val gap = (6 * context.resources.displayMetrics.density).toInt()

        override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
            val width = MeasureSpec.getSize(widthMeasureSpec)
            var x = 0
            var y = 0
            var rowHeight = 0
            for (i in 0 until childCount) {
                val child = getChildAt(i)
                child.measure(MeasureSpec.makeMeasureSpec(width, MeasureSpec.AT_MOST), MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED))
                if (x > 0 && x + child.measuredWidth > width) {
                    x = 0
                    y += rowHeight + gap
                    rowHeight = 0
                }
                x += child.measuredWidth + gap
                rowHeight = maxOf(rowHeight, child.measuredHeight)
            }
            setMeasuredDimension(width, y + rowHeight + gap)
        }

        override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
            val width = r - l
            var x = 0
            var y = gap
            var rowHeight = 0
            for (i in 0 until childCount) {
                val child = getChildAt(i)
                if (x > 0 && x + child.measuredWidth > width) {
                    x = 0
                    y += rowHeight + gap
                    rowHeight = 0
                }
                child.layout(x, y, x + child.measuredWidth, y + child.measuredHeight)
                x += child.measuredWidth + gap
                rowHeight = maxOf(rowHeight, child.measuredHeight)
            }
        }
    }

    companion object {
        private const val EXTRA_PHONE = "phone"
        private const val EXTRA_DIRECTION = "direction"
        private const val EXTRA_STARTED_AT = "startedAt"
        private const val EXTRA_DURATION = "durationSec"
        private const val EXTRA_CONTACT = "contactName"
        private const val EXTRA_LOOKUP = "lookup"
        private const val EXTRA_NOTIFICATION = "notificationId"

        /** The next follow-up may be at most this long after the call ends (the CRM checks it too) */
        private const val FOLLOWUP_WINDOW_MS = 72 * 3600_000L
        private val BUSINESS_TYPES = listOf("B2B", "B2C")
        private val DEFAULT_LOST_REASONS = listOf("Price too high", "Not interested", "Chose competitor", "Not reachable", "Location / timing", "Duplicate / invalid", "Other")

        fun intent(context: Context, call: PhoneCall, lookup: JSONObject?, notificationId: Int): Intent =
            Intent(context, AfterCallActivity::class.java)
                // A distinct address per call, so each call's notification opens its own form
                .setData(Uri.parse("vti-call://${call.startedAt}"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                .putExtra(EXTRA_PHONE, call.phone)
                .putExtra(EXTRA_DIRECTION, call.direction)
                .putExtra(EXTRA_STARTED_AT, call.startedAt)
                .putExtra(EXTRA_DURATION, call.durationSec)
                .putExtra(EXTRA_CONTACT, call.contactName)
                .putExtra(EXTRA_NOTIFICATION, notificationId)
                .apply { if (lookup != null) putExtra(EXTRA_LOOKUP, lookup.toString()) }
    }
}
