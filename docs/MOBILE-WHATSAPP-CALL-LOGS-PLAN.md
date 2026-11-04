# Capturing WhatsApp call logs on the BDM phone

**Question:** can the Android app record WhatsApp calls in the CRM — the call log data (who, when, how long, which
direction), not the audio?

**Answer: yes, partially, and only one route is worth building.** WhatsApp gives no call history to other apps, so the
only thing that works on the phone is listening to WhatsApp's own *notifications*. That gets you direction, the
contact's name, start and end time, and therefore duration. It does **not** reliably get you the phone number, which
is what the CRM matches leads on. Read "What you get and what you don't" before deciding.

---

## 1. What does not work (checked, so nobody tries it again)

| Route | Why not |
|---|---|
| The phone's call log (`CallLog.Calls`) — what the app reads today | WhatsApp calls are VoIP over WhatsApp's own stack. WhatsApp does not register them with Android's Telecom service, so **they never appear in the system call log**. `CallLogReader.kt` cannot see them, and no permission changes that. |
| A WhatsApp API or content provider on the device | There is none. WhatsApp exports nothing about calls to other apps. |
| Reading WhatsApp's database (`msgstore.db`) | It lives in `/data/data/com.whatsapp/`, private to WhatsApp. Needs root. Not an option on a BDM's phone. |
| `AudioManager` / `MODE_IN_COMMUNICATION` | Tells you *a* VoIP call is happening. Not which app, not with whom. Useful only as a cross-check. |

## 2. What works: listening to WhatsApp's notifications

`NotificationListenerService` lets our app read the notifications other apps post. WhatsApp posts one for every call,
and the sequence tells us the whole story:

| WhatsApp posts | We learn |
|---|---|
| Incoming ringing notification (full-screen, "Incoming voice call") | an incoming call is starting, and the caller's name |
| Ongoing-call notification, which stays up for the whole call | the call connected — **posted time = call start** |
| …that notification is removed | **removal time = call end**, so end − start = duration |
| "Missed voice call" | a missed call, and from whom |

Direction comes from the order: an ongoing notification with no ringing notification before it is an **outgoing** call;
one preceded by ringing is **incoming answered**. This is the same technique third-party WhatsApp call recorders use,
and it is the only route that does not depend on reading another app's screen.

**Access needed:** *Notification access* — Settings → Apps → Special app access → Notification access (on MIUI:
Settings → Apps → Permissions → Notification access). One switch, same kind of one-time setup as the existing
"call recorder" accessibility switch. Works on Android 13 Go / the Poco C51.

### What you get and what you don't

**You get:** direction (incoming / outgoing / missed), the contact name as WhatsApp shows it, start time, end time,
duration, and whether it was a voice or video call.

**You don't get, and this is the catch:**

- **The phone number, when the person is saved in the phone's contacts.** WhatsApp shows the saved name, not the
  number, so that is all the notification carries. For a number *not* in contacts, WhatsApp shows the raw number and
  we do get it. Since BDMs usually save their leads, expect the common case to be **name only**.
  - Way out (a): match the name against the lead's name. Works, but is fuzzy — two "Sharma Textiles" break it.
  - Way out (b): add `READ_CONTACTS` and resolve name → number on the phone. Reliable, but the app currently promises
    "Contacts and SMS are never accessed" — that promise would have to change, and the BDMs told about it.
- **Nothing before you switch it on.** There is no history to import; only calls from that moment on.
- **A call can be missed** if the listener gets killed (likely on a 4 GB Go phone under MIUI). Android rebinds it, but
  a call that happens during the gap is lost. Same mitigation as the rest of the app: unrestricted battery + Autostart.
- **WhatsApp's wording is read as text.** It is translated per language and changes between WhatsApp versions, so the
  parsing has to be forgiving and the detection has to lean on notification *structure* (ongoing-call flag, call-style
  category, channel) rather than on matching English strings.

### The route we should *not* take

The app's accessibility service could scrape WhatsApp's Calls tab and get full history including numbers. Rejected:
it means reading the content of another app's screen, it breaks every time WhatsApp redesigns, and it contradicts what
the app tells BDMs today ("it reads nothing on your screen"). Not worth the trust.

### The robust alternative, if WhatsApp calling becomes important

The **WhatsApp Business Platform Calling API** gives real call events server-side, by webhook, with proper metadata and
no device tricks at all. That means BDMs calling *through* a VTI WhatsApp Business number rather than their personal
WhatsApp. It is a product decision, not a code change — but it is the only version of this that is genuinely reliable.
Worth knowing before investing in the notification route.

---

## 3. How it fits this app

The good news: almost all of the plumbing exists. A WhatsApp call ends up looking like any other call.

**Already there, reused as-is:**

- `call_logs.source` is already a column (`'device' | 'exotel'`) with a unique index on `(source, external_id)`. Adding
  `'whatsapp'` is a **one-line type change and no migration** — WhatsApp calls cannot collide with phone calls.
- `CallSync` / `PendingForms` / `SyncWorker` already queue calls offline and upload them. New calls go down the same
  pipe; no second pipeline.
- `AfterCallActivity` already asks what happened and logs the follow-up. A WhatsApp call reuses it unchanged.
- The setup checklist in `MainActivity.setupSteps()` already handles "open this Settings screen" steps — the new
  switch is one more entry, exactly like the Autostart step.

**New work, in order:**

1. **`WhatsAppCallListener : NotificationListenerService`** (new file, ~120 lines). Declared in the manifest with
   `BIND_NOTIFICATION_LISTENER_SERVICE` and the notification-listener intent filter. Filters to `com.whatsapp` and
   `com.whatsapp.w4b` (WhatsApp Business) and ignores everything else — it must never look at other apps' notifications.
2. **A small state machine**, mirroring `CallStateReceiver`'s ring → connected → ended, with its progress in `Prefs`
   the way `callState` / `callStartedAt` already are, so a killed process picks up where it left off.
3. **On call end**, build `{ source: "whatsapp", direction, contactName, phone?, startedAt, durationSec, video }` and
   hand it to the existing sync queue.
4. **Server:** add `'whatsapp'` to `CallSource`; accept an optional `source` on `POST /api/calls/device-sync`
   (defaulting to `'device'` so the current app keeps working); let lead matching fall back to **name** when there is no
   number. Nothing else on the server changes.
5. **After-call form** opens for a WhatsApp call when the lead is identified, as it does for a phone call.
6. **Setup step** "WhatsApp call tracking" → opens `Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS`, with an on/off
   switch next to "Record calls" so a BDM can decline.
7. **Reporting:** the CRM's call screens gain a WhatsApp/Phone filter, since mixing the two silently would make the
   call counts misleading.

**Rough size:** 1–2 days for the phone side, a few hours for the server, plus real testing on a Xiaomi device — the
notification behaviour has to be confirmed on the actual phone and WhatsApp version the BDMs use, because nothing
about it is documented or guaranteed.

## 4. Recommendation

Build it as **item 1–6 above, number-matching by name at first**, and decide on `READ_CONTACTS` only once you have seen
how often the name alone fails to find the lead. Before any of it, spend an hour on the phone itself: switch on
notification access, make four WhatsApp calls (incoming answered, incoming missed, outgoing answered, outgoing
unanswered), and log exactly what notifications arrive. If WhatsApp on that device does not post a removable
ongoing-call notification, the duration half of this plan does not work and only direction and time survive — better to
find that out in an hour than after two days.
