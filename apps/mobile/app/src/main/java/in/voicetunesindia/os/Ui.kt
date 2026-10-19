package `in`.voicetunesindia.os

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.text.TextUtils
import android.view.Gravity
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.Switch
import android.widget.TextView

/** Voice Tunes India colours: the logo's yellow #FCCC13 and black, on warm neutrals */
object Palette {
    val ink = Color.parseColor("#111111")
    val yellow = Color.parseColor("#FCCC13")
    val yellowSoft = Color.parseColor("#FFF6CC")
    val muted = Color.parseColor("#6B6B6B")
    val line = Color.parseColor("#E4E0D6")
    val page = Color.parseColor("#F6F4EF")
    val surface = Color.WHITE
    val green = Color.parseColor("#047857")
    val greenSoft = Color.parseColor("#E7F6EF")
    val red = Color.parseColor("#B91C1C")
    val redSoft = Color.parseColor("#FDECEC")
    val amber = Color.parseColor("#92400E")
    val amberSoft = Color.parseColor("#FFF4DB")
}

/** Small view builders shared by the app's screens (no UI libraries, just framework views) */
class Ui(private val context: Context) {
    fun dp(v: Int) = (v * context.resources.displayMetrics.density).toInt()

    fun text(value: CharSequence, size: Float, color: Int = Palette.ink, bold: Boolean = false) = TextView(context).apply {
        text = value
        textSize = size
        setTextColor(color)
        if (bold) typeface = Typeface.create("sans-serif-medium", Typeface.BOLD)
        setLineSpacing(0f, 1.15f)
    }

    /** Small grey heading above a group of cards */
    fun sectionTitle(value: String) = text(value.uppercase(), 12f, Palette.muted, bold = true).apply {
        letterSpacing = 0.08f
    }.withMargins(top = 20, bottom = 8, start = 4)

    fun rounded(color: Int, radius: Int = 14, stroke: Int? = null) = GradientDrawable().apply {
        cornerRadius = dp(radius).toFloat()
        setColor(color)
        if (stroke != null) setStroke(dp(1), stroke)
    }

    private fun pressable(view: View, background: GradientDrawable) {
        view.background = RippleDrawable(ColorStateList.valueOf(Color.parseColor("#22000000")), background, null)
        view.isClickable = true
        view.isFocusable = true
    }

    fun card(color: Int = Palette.surface, stroke: Int? = Palette.line) = LinearLayout(context).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(16), dp(16), dp(16), dp(16))
        background = rounded(color, 16, stroke)
    }.withMargins(bottom = 12)

    fun primaryButton(label: String, onClick: (Button) -> Unit) = Button(context).apply {
        text = label
        isAllCaps = false
        textSize = 15f
        setTextColor(Color.BLACK)
        typeface = Typeface.create("sans-serif-medium", Typeface.BOLD)
        minHeight = dp(50)
        stateListAnimator = null
        pressable(this, rounded(Palette.yellow, 12))
        setOnClickListener { onClick(this) }
    }.withMargins(top = 14)

    fun secondaryButton(label: String, onClick: (Button) -> Unit) = Button(context).apply {
        text = label
        isAllCaps = false
        textSize = 14f
        setTextColor(Palette.ink)
        minHeight = dp(46)
        stateListAnimator = null
        pressable(this, rounded(Palette.surface, 12, Palette.line))
        setOnClickListener { onClick(this) }
    }.withMargins(top = 10)

    /** A compact button for the right-hand side of a row */
    fun smallButton(label: String, primary: Boolean = true, onClick: () -> Unit) = TextView(context).apply {
        text = label
        textSize = 13f
        gravity = Gravity.CENTER
        setTextColor(Palette.ink)
        typeface = Typeface.create("sans-serif-medium", Typeface.BOLD)
        setPadding(dp(14), dp(8), dp(14), dp(8))
        minHeight = dp(36)
        pressable(this, if (primary) rounded(Palette.yellow, 18) else rounded(Palette.surface, 18, Palette.line))
        setOnClickListener { onClick() }
    }

    fun input(hint: String, value: String, type: Int) = EditText(context).apply {
        this.hint = hint
        setText(value)
        inputType = type
        setSingleLine()
        textSize = 16f
        setTextColor(Palette.ink)
        setHintTextColor(Color.parseColor("#9A968C"))
        setPadding(dp(14), dp(14), dp(14), dp(14))
        background = rounded(Palette.surface, 12, Palette.line)
    }

    fun fieldLabel(value: String) = text(value, 13f, Palette.muted, bold = true).withMargins(top = 14, bottom = 6)

    /** Title and explanation on the left, an on/off switch on the right */
    fun switchRow(title: String, detail: String?, checked: Boolean, onChange: (Boolean) -> Unit): LinearLayout {
        val row = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        val labels = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f).apply { marginEnd = dp(12) }
            addView(text(title, 15f, bold = true))
            if (detail != null) addView(text(detail, 13f, Palette.muted).withMargins(top = 2))
        }
        val toggle = Switch(context).apply {
            isChecked = checked
            val states = arrayOf(intArrayOf(android.R.attr.state_checked), intArrayOf())
            thumbTintList = ColorStateList(states, intArrayOf(Palette.ink, Color.WHITE))
            trackTintList = ColorStateList(states, intArrayOf(Palette.yellow, Color.parseColor("#C9C4B8")))
            setOnCheckedChangeListener { _, value -> onChange(value) }
        }
        row.addView(labels)
        row.addView(toggle)
        // The whole row flips the switch, not just the small thumb
        row.setOnClickListener { toggle.toggle() }
        return row
    }

    /** One-of-several choice drawn as a segmented bar */
    fun segmented(options: List<Pair<String, String>>, selected: String, onPick: (String) -> Unit) = LinearLayout(context).apply {
        orientation = LinearLayout.HORIZONTAL
        setPadding(dp(4), dp(4), dp(4), dp(4))
        background = rounded(Palette.page, 12, Palette.line)
        options.forEach { (key, label) ->
            val on = key == selected
            addView(TextView(context).apply {
                text = label
                textSize = 13f
                gravity = Gravity.CENTER
                maxLines = 1
                ellipsize = TextUtils.TruncateAt.END
                setTextColor(Palette.ink)
                typeface = if (on) Typeface.create("sans-serif-medium", Typeface.BOLD) else Typeface.DEFAULT
                setPadding(dp(6), dp(10), dp(6), dp(10))
                if (on) background = rounded(Palette.yellow, 9)
                layoutParams = LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f)
                setOnClickListener { if (!on) onPick(key) }
            })
        }
    }

    /** A round marker: a tick when done, otherwise the step's number */
    fun stepMarker(done: Boolean, number: Int) = TextView(context).apply {
        text = if (done) "✓" else number.toString()
        textSize = 13f
        gravity = Gravity.CENTER
        typeface = Typeface.DEFAULT_BOLD
        setTextColor(if (done) Color.WHITE else Palette.ink)
        background = GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            if (done) setColor(Palette.green) else { setColor(Palette.yellowSoft); setStroke(dp(1), Palette.yellow) }
        }
        layoutParams = LinearLayout.LayoutParams(dp(28), dp(28)).apply { marginEnd = dp(12) }
    }

    fun pill(value: String, color: Int, background: Int) = text(value, 12f, color, bold = true).apply {
        setPadding(dp(10), dp(4), dp(10), dp(4))
        this.background = rounded(background, 12)
    }

    fun divider() = View(context).apply {
        setBackgroundColor(Palette.line)
        layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, dp(1)).apply { topMargin = dp(14); bottomMargin = dp(14) }
    }

    fun <T : View> T.withMargins(top: Int = 0, bottom: Int = 0, start: Int = 0, end: Int = 0): T = apply {
        layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply {
            topMargin = dp(top); bottomMargin = dp(bottom); marginStart = dp(start); marginEnd = dp(end)
        }
    }
}
