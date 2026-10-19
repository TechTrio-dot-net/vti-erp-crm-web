# Voice Tunes India — Android App Brief (v1.2.0)

**For:** the Android developer who will build, finish and ship the app
**Code:** `apps/mobile` in this repository (Kotlin, no third-party libraries except AndroidX WorkManager)
**Backend:** the CRM at `https://<your-crm-domain>` (Next.js on Vercel). Every endpoint the app needs already exists and is covered by automated tests.

---

## 1. What the app is for

BDMs (salespeople) call leads all day from their Android phones. The app connects each phone to the CRM:

1. **Click-to-call.** When a BDM clicks **Call** on a lead in the CRM website, their phone dials that lead within about a second.
2. **Automatic call log.** Every call (number, direction, time, duration) is sent to the CRM and matched to the lead by mobile number.
3. **After-call form (new in 1.2.0).** When a call ends, a form slides up. The BDM records what happened, adds a note and sets the next follow-up, and it all goes straight into the CRM. A call from a new number can be turned into a lead on the spot.
4. **Missed calls from leads** show a "Call back" notification.

The app never reads contacts, SMS or call audio. Only the call log fields above are read.

---

## 2. Current state (read this first)

| Part | State |
|---|---|
| Sign-in, call-log sync, click-to-call (v1.1.0) | Built and in use |
| After-call form, call-end detection, offline queue, missed-call notification, new settings (v1.2.0) | **Code written but never compiled.** It was written on a machine without the Android SDK. |
| Backend for all of the above | Done, deployed with the CRM, 136 automated tests passing |

**Your job:**
1. Build v1.2.0 on a Mac and fix any compile errors.
2. Test every flow in section 9 on real phones.
3. Polish the UI where needed, keeping the behaviour described here.
4. Sign the app with a proper release key and deliver the APK.

You may restructure the code (for example move to Jetpack Compose or add Retrofit) if you prefer, as long as behaviour and the API contract stay the same. Matching the existing code style is the fastest path.

---

## 3. Build setup (Mac)

```bash
brew install openjdk@17
brew install --cask android-commandlinetools
export JAVA_HOME="$(brew --prefix openjdk@17)/libexec/openjdk.jdk/Contents/Home"
export ANDROID_HOME="$(brew --prefix)/share/android-commandlinetools"
yes | sdkmanager --licenses
sdkmanager "platforms;android-35" "build-tools;35.0.0" "platform-tools"

cd apps/mobile
./gradlew assembleRelease -PcrmUrl=https://<your-crm-domain>
```

Android Studio (Ladybug or newer) also works: open `apps/mobile`, then **Build → Generate APKs**.

| Setting | Value |
|---|---|
| Package / applicationId | `in.voicetunesindia.os` (**do not change**, or phones can't update the installed app) |
| minSdk / targetSdk / compileSdk | 26 / 35 / 35 |
| Kotlin / AGP / JDK | 2.1.20 / 8.11.0 / 17 |
| versionCode / versionName | 5 / 1.2.0 (raise both for every release) |
| `crmUrl` Gradle property | Becomes `BuildConfig.DEFAULT_SERVER_URL`, pre-filled on the sign-in screen |

**Signing:** release builds are currently signed with the debug key. Create a proper release keystore, sign with it, and hand the keystore and passwords to the company owner to keep safely. Every future update must be signed with the same key. Existing installs signed with the old debug key must be uninstalled once, then the new app installed.

**Distribution:** the app is installed directly as an APK, or privately through Managed Google Play. Google Play rejects public apps that read the call log unless they are the default dialler.

---

## 4. Code map (`apps/mobile/app/src/main/java/in/voicetunesindia/os/`)

| File | Responsibility |
|---|---|
| `CallsApp.kt` | App start: schedules sync, starts the dialer service when signed in |
| `MainActivity.kt` | The only regular screen: sign-in, permissions, after-call settings, sync status, sign-out |
| `ApiClient.kt` | JSON over HttpURLConnection; bearer token; refreshes once on 401; header `X-Client: mobile` |
| `Prefs.kt` | SharedPreferences: server URL, tokens, settings, sync cursor, call-state tracking |
| `CallLogReader.kt` | Reads call-log rows newer than a timestamp |
| `CallSync.kt` | Sends new call-log rows in batches of 500; advances the cursor only after the server accepts them |
| `SyncWorker.kt` | WorkManager: every 15 min, a few seconds after each call, and uploads saved after-call forms |
| `DialerService.kt` | Foreground service holding the click-to-call long-poll; places the call |
| `CallStateReceiver.kt` | Follows ringing → off-hook → idle; on idle, triggers sync and the after-call flow. Also `BootReceiver`. |
| `AfterCall.kt` | Finds the finished call in the call log, decides whether to show the form, opens it or posts a notification, handles missed calls |
| `AfterCallActivity.kt` | The after-call form (bottom sheet over whatever app is open) |
| `PendingForms.kt` | Offline queue of after-call forms |

---

## 5. Screens

Design: Voice Tunes India colours, yellow `#FCCC13` with black text on buttons, ink `#111111`, muted `#666666`, borders `#D9D5CC`, cards `#FAF8F3`. Clean, large touch targets; BDMs use it one-handed between calls.

### 5.1 Main screen (`MainActivity`)
**Signed out:**
- CRM address, pre-filled from `BuildConfig.DEFAULT_SERVER_URL`. A bare host gets `https://`; LAN IPs and `localhost` get `http://`.
- Username / email / employee ID, and password.
- Sign-in errors are shown inline. Network errors say "Can't reach <url> — check the address and the phone's internet connection".

**Signed in, top to bottom:**
1. "Signed in as <name>" and the CRM address.
2. Call-log permission card: green when granted, otherwise a red card with an **Allow** button.
3. Call-button card: phone permission, plus the dialer status text ("Ready for calls from the CRM", "Reconnecting…").
4. **After-call form card:**
   - Mode, one of: *After every call* (default) / *Only after calls with CRM leads* / *Off*.
   - When the mode isn't Off and "Display over other apps" isn't granted: an explanation and an **Allow pop-up after calls** button, which opens `Settings.ACTION_MANAGE_OVERLAY_PERMISSION` for the package. Also a note for Xiaomi / Vivo / Oppo about "Display pop-up windows while running in the background".
   - When granted: "✓ Opens by itself when a call ends".
5. Last sync: time, today's totals (calls, connected, talk time), "N after-call forms waiting to upload" if any, and a **Sync now** button (syncs calls, then uploads saved forms).
6. **Personal phone** checkbox. When ticked, only calls with numbers that are CRM leads are ever sent, and the form only opens for leads.
7. A battery-optimisation tip with a button to App info, shown until the app is unrestricted.
8. **Sign out**, which clears tokens, the sync cursor and saved forms, and stops the service and workers.

### 5.2 After-call form (`AfterCallActivity`)
A see-through activity: dimmed backdrop, white bottom sheet with rounded top corners, scrollable, keyboard-aware. It runs in its own task (`taskAffinity`, `excludeFromRecents`), so closing it returns the BDM to whatever they were doing. Tapping outside does **not** close it.

**Header:** "Log this call", a ✕ button, and a line like "Outgoing call · 1m 24s · 3:42 PM" or "Not answered · 3:42 PM".

**Body depends on the lookup result (see 7.6):**

| Case | Show |
|---|---|
| **Loading** | Number and a spinner: "Looking up this number in the CRM…" |
| **Known lead** | Card with name, stage badge, phone · service · city, "Follow-up was due <when>" (red if overdue), last follow-up outcome with its time and note. A collapsible **Update customer details** section (name, city, email, service). |
| **New number** | Yellow card: "New number — not in the CRM yet…". Fields: customer name (pre-filled from the contact name if there is one), city, service (dropdown). |
| **Offline** (lookup failed) | Same as a new number, with the message "No connection… saved on the phone and sent when you're back online" |
| **Another BDM's lead** | "This number is another BDM's lead. The call is logged automatically; there's nothing to fill in." and a **Close** button only |

**Common fields:**
1. **What happened?** Two-column chips: Connected, Call back, Not reachable, Interested, Not interested, Converted (won), Lost. An outgoing call with 0 seconds pre-selects *Not reachable*. Labels come from the lookup; the list is built into the app for offline use.
2. **Note**: multi-line, "What did the customer say?"
3. **Depends on the outcome:**
   - *Converted*: **Deal value (₹)**, a number, with the lead's current value as the hint.
   - *Lost* / *Not interested*: **Reason** dropdown (Price too high, Not interested, Chose competitor, Not reachable, Location / timing, Duplicate / invalid, Other). *Not interested* pre-selects "Not interested".
   - Anything else: **Next follow-up**. Shows the chosen time in words ("tomorrow 11:00 AM"). Quick chips: In 1 hour, This evening (6 PM, hidden after 5 PM), Tomorrow 11 AM, In 2 days, Next week, None, and **Pick date & time…** (date picker then time picker; no past dates). Default once an outcome is picked: *Not reachable* → in 2 hours (rounded up to a quarter hour); everything else → tomorrow 11 AM. Once the BDM picks something, it stays.
4. Inline red error text for validation and server errors.

**Buttons:**
- **Save to CRM** (known lead) or **Save & add as lead** (new number). Shows "Saving…" while it works.
- **Personal call — skip** (new numbers only): stores the call only and creates no lead.
- **Later** (also the ✕ and Back): closes the form but re-posts its notification, so the BDM can come back to it.

**After saving:** a toast, then the form closes. Examples: "Saved — next follow-up tomorrow 11:00 AM", "Lead added: Ravi Studio", "No connection — saved on the phone, it will upload automatically".

### 5.3 Notifications
| Channel | Importance | Used for |
|---|---|---|
| `dialer-status` "Call button connection" | MIN | Ongoing foreground-service notification with the dialer status |
| `dialer-call` "Calls from the CRM" | HIGH | "Tap to call X" when the phone couldn't dial by itself |
| `after-call` "After-call form" | HIGH | "Log call with <name>", with a **Log call** action and a full-screen intent. Removed when the form opens. |
| `missed-lead-call` "Missed calls from leads" | HIGH | "Missed call from <lead> — tap to call back", which opens the dialler |

---

## 6. Behaviour in detail

### 6.1 Detecting that a call ended (`CallStateReceiver`)
- Manifest receiver for `android.intent.action.PHONE_STATE`, protected by `READ_PHONE_STATE`.
- Keep the last state in Prefs. Android sends each change twice when the app can read numbers, so ignore a broadcast whose state equals the stored one.
- **RINGING**: store `callStartedAt = now` and `wasOffhook = false`.
- **OFFHOOK**: if the previous state was IDLE this is an outgoing call, so set `callStartedAt = now`. Either way set `wasOffhook = true`.
- **IDLE**: schedule a sync in 8 s. If `callStartedAt > 0`, start the after-call flow with `(callStartedAt, now, wasOffhook)` using `goAsync()`. Then reset both values.
- After boot or an app update, reset the stored state to IDLE.

### 6.2 After-call flow (`AfterCall`)
1. Effective mode = setting, except *All* becomes *Leads only* when "Personal phone" is ticked. Stop if the mode is Off or call-log permission is missing.
2. Find the call in the call log: poll up to 10 times, 700 ms apart. Take the newest row whose `DATE` is between `callStartedAt − 15 s` and `endedAt + 5 s`. The log is written a moment after the call ends.
3. **Missed** = not picked up, or the direction is missed/rejected, and it wasn't outgoing. Look the number up. If it is a lead, post the missed-call notification. Otherwise do nothing. No form for missed calls.
4. In *Leads only* mode, look the number up first. If it is not a lead, or the lookup failed, do nothing.
5. Otherwise show the form:
   - **Always** post the `after-call` notification (full-screen intent + Log call action). This is the fallback, and the form removes it once open.
   - If `Settings.canDrawOverlays()`, also open the form directly. **Android 15 rule:** the overlay permission only allows starting an activity from the background while one of the app's overlay windows is visible. So add a 1×1 transparent `TYPE_APPLICATION_OVERLAY` view on the main thread, start the activity, and remove the view 2 s later. **Verify this on Android 14, 15 and 16 devices.**
6. Each call's intent has a unique data URI `vti-call://<startedAt>` and `FLAG_ACTIVITY_NEW_TASK`, so every call gets its own form and notification.

### 6.3 Saving and offline queue
- Each form instance generates a `clientRef` (UUID) once and keeps it across rotation. It is sent with the form; the server saves each `clientRef` only once.
- Save → `POST /api/calls/after-call` (section 7.7):
  - Success: toast, close.
  - **4xx:** show the message inline and keep the form open (for example a 403 because the lead was reassigned).
  - **Network error / timeout:** add the body to `PendingForms`, schedule a sync, toast, close.
  - **401 after refresh fails:** save to `PendingForms` and tell the BDM to sign in again.
- `PendingForms` holds up to 200 forms in SharedPreferences. `SyncWorker` and **Sync now** upload them after the call sync.
  - Keep a form on network errors and 5xx.
  - Drop it on other 4xx (retrying won't help).
  - Stop on 401.
  - The worker returns `retry()` while forms remain.

### 6.4 Call-log sync (`CallSync`, `SyncWorker`)
- The cursor `lastCallTimestamp` starts at the beginning of the sign-in day, so older history is never sent.
- Read rows with `DATE > cursor`, oldest first, up to 2000. Skip empty or withheld numbers.
- Map `TYPE`:
  - OUTGOING → `outgoing`
  - INCOMING / ANSWERED_EXTERNALLY → `incoming`
  - MISSED → `missed`
  - REJECTED / BLOCKED → `rejected`
  - Skip voicemail and other types.
- Send in batches of 500. Always send at least one request, even an empty one, so the CRM knows the phone is alive. Advance the cursor after each accepted batch.
- Runs every 15 minutes (network required), 8 s after each call, 30 s after boot, and on demand.

### 6.5 Click-to-call (`DialerService`)
- A foreground service (`specialUse`, subtype text in the manifest). It only runs when signed in **and** `CALL_PHONE` is granted.
- Loop: `POST /api/calls/dialer/poll` with a 45 s read timeout. The server holds it for up to 25 s.
  - `request` is present: place the call with `TelecomManager.placeCall(tel:…)`, then report `dialing`. If placing fails, report `failed` with the reason and post "Tap to call" (ACTION_DIAL).
  - `request` is null: poll again immediately.
  - Errors: exponential back-off from 2 s up to 60 s, with status "Reconnecting to the CRM…".
  - 401 that can't be refreshed: stop and show "Signed out — open the app and sign in again".
- Restart after boot and after an app update (`BootReceiver`). Opening the app also restarts it.
- Show the status in the ongoing notification and in the app.

### 6.6 Session
- The access token lasts 15 minutes and the refresh token 7 days. The server issues a new refresh token on every refresh, so always store it.
- On any 401: refresh once, then retry the request once. If refresh fails, the user is signed out (`AuthExpiredException`).
- `role == CLIENT` is refused at sign-in. The API also refuses roles outside the CRM (403).

---

## 7. API contract

Base: `<serverUrl>/api`. Every request uses JSON and these headers: `Content-Type: application/json`, `Accept: application/json`, `X-Client: mobile`, and `Authorization: Bearer <accessToken>` except for sign-in and refresh.
Errors always look like `{ "message": "Human readable text" }`. Show the message as it is.
`deviceId` is `Settings.Secure.ANDROID_ID`. `deviceName` is `"<MANUFACTURER> <MODEL>"`. `appVersion` is `BuildConfig.VERSION_NAME`.

### 7.1 Sign in — `POST /auth/login`
```json
{ "username": "KR_01", "password": "••••••" }
```
The username can be a username, email or employee ID. Response 200:
```json
{ "token": "<access>", "refreshToken": "<refresh>",
  "user": { "id": "uuid", "name": "Ravi", "username": "kr_01", "email": null, "role": "SALES" } }
```
Errors: 401 "Invalid credentials", 401 "Account is deactivated", 429 (too many attempts).

### 7.2 Refresh — `POST /auth/refresh`
```json
{ "refreshToken": "<refresh>" }
```
Response 200: `{ "token": "<access>", "refreshToken": "<new refresh>" }`. Returns 401 when the session has ended.

### 7.3 Call-log sync — `POST /calls/device-sync`
```json
{ "deviceId": "a1b2…", "deviceName": "Samsung SM-A155F", "appVersion": "1.2.0",
  "permissionGranted": true, "leadsOnly": false,
  "calls": [ { "phone": "+919876543210", "direction": "outgoing", "startedAt": 1790071200000,
               "durationSec": 84, "contactName": null } ] }
```
`startedAt` is epoch milliseconds. Up to 1000 calls per request. Duplicates are ignored, so resending is safe. Response 200:
```json
{ "received": 1, "skippedPersonal": 0, "inserted": 1, "matched": 1, "connected": 1,
  "today": { "calls": 23, "connected": 15, "talkSec": 2710 } }
```

### 7.4 Dialer long-poll — `POST /calls/dialer/poll`
```json
{ "deviceId": "a1b2…", "deviceName": "Samsung SM-A155F", "appVersion": "1.2.0", "canDial": true }
```
The server holds the request for up to 25 s. Response 200: `{ "request": { "id": "uuid", "phone": "+917380868301", "name": "Kartikey" } }` or `{ "request": null }`.

### 7.5 Dial result — `POST /calls/dialer/{id}/result`
```json
{ "status": "dialing" }                      // or
{ "status": "failed", "error": "Phone permission is off in the app" }
```
Response 200: `{ "ok": true }`. Report within about 12 s: the website waits that long before telling the BDM the phone didn't respond.

### 7.6 Look up a number — `POST /calls/after-call/lookup`
```json
{ "phone": "+91 73808 68301" }
```
Response 200:
```json
{
  "phone": "+91 73808 68301",
  "lead": {
    "id": "uuid", "name": "Kartikey Pandey", "phone": "+917380868301", "email": "k@x.com",
    "city": "Allahabad", "service": "Reel / social media content", "serviceId": "uuid",
    "stage": "CONTACTED", "stageLabel": "Contacted", "estimatedValue": 25000, "notes": "…",
    "source": "Google Sheet", "campaign": "…", "assignedName": "adarsh",
    "nextFollowupAt": "2026-09-23T05:30:00.000Z", "lastContactAt": "…", "closedAt": null
  },
  "otherOwner": false,
  "history": [ { "outcome": "CALL_BACK", "outcomeLabel": "Call back", "note": "Call after lunch",
                 "nextFollowupAt": "…", "createdAt": "…", "userName": "adarsh" } ],
  "options": {
    "outcomes": [ { "key": "CONNECTED", "label": "Connected" }, "…7 in total" ],
    "stages":   [ { "key": "AWARENESS", "label": "New" }, "…" ],
    "lostReasons": [ "Price too high", "Not interested", "Chose competitor", "Not reachable",
                     "Location / timing", "Duplicate / invalid", "Other" ],
    "services": [ { "id": "uuid", "name": "Voice Over" }, "…" ]
  }
}
```
- `lead` is `null` for a new number.
- `lead: null, otherOwner: true` means the number is another BDM's lead: show nothing about it.
- `history` holds the last 3 follow-ups, newest first. Dates are ISO-8601 UTC strings.

### 7.7 Save the form — `POST /calls/after-call`
```json
{
  "clientRef": "8f0c…uuid",
  "deviceId": "a1b2…",
  "leadsOnly": false,
  "call": { "phone": "+917380868301", "direction": "outgoing", "startedAt": 1790071200000,
            "durationSec": 84, "contactName": null },

  "leadId": "uuid",
  "outcome": "INTERESTED",
  "note": "Wants a 60s explainer, send rates",
  "nextFollowupAt": "2026-09-23T05:30:00Z",

  "details": { "name": "…", "city": "…", "email": "…", "serviceId": "uuid" }
}
```
Variants:
- **Won:** `"outcome": "CONVERTED", "estimatedValue": "45000"`, with no `nextFollowupAt`.
- **Lost:** `"outcome": "LOST"` or `"NOT_INTERESTED"` with `"lostReason": "Price too high"`.
- **No follow-up:** `"nextFollowupAt": null`.
- **New number:** leave out `leadId` and send `"newLead": { "name": "Ravi Studio", "city": "Indore", "serviceId": "uuid" }`. The name is required.
- **Personal call:** `"skip": true`, with no outcome. Only the call is stored (unless `leadsOnly` is true).
- `details` is optional: send it only when the BDM opened "Update customer details".

Response **201** when saved (or 200 when this `clientRef` was already saved: `"saved": false`):
```json
{ "status": "updated" | "lead-created" | "call-only", "saved": true, "lead": { "id": "…", "name": "…", "stage": "PROPOSAL", "nextFollowupAt": "…", "…": "…" } }
```
Errors:
- 400: "Choose a call outcome", "This number isn't a lead yet — add the customer's name…", invalid fields.
- 403: "This number is another BDM's lead" / "This lead is assigned to someone else".

**What the server does with a save** (the same rules as the website, for your understanding only):
- Stores the call (the same record as the background sync, never duplicated).
- Creates the lead for a new number, owned by this BDM.
- Applies detail edits.
- Logs the follow-up tagged "Phone".
- Sets last contact and the next follow-up.
- Moves the stage: Connected / Call back → Contacted, Interested → Interested, Converted → Won (closed, with the deal value), Lost / Not interested → Lost (with the reason). A follow-up on a closed lead reopens it.
- Open CRM screens refresh within about 8 s.

---

## 8. Permissions (manifest) and when to ask

| Permission | Why | When asked |
|---|---|---|
| `READ_CALL_LOG` | Read calls to sync and find the finished call | After sign-in |
| `READ_PHONE_STATE` | Know when a call ends | After sign-in |
| `CALL_PHONE` | Dial when Call is clicked in the CRM | After sign-in |
| `POST_NOTIFICATIONS` (13+) | Form, missed-call and status notifications | After sign-in |
| `SYSTEM_ALERT_WINDOW` | Open the form by itself after a call | Button in the After-call card (Settings screen) |
| `USE_FULL_SCREEN_INTENT` | Show the form over the lock screen | Declared. On Android 14+ it may need the user's approval in Settings; the heads-up notification still works without it. |
| `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_SPECIAL_USE` | Keep the Call button connected | Automatic |
| `RECEIVE_BOOT_COMPLETED`, `INTERNET`, `ACCESS_NETWORK_STATE` | Restart after boot; networking | Automatic |

If a permission is permanently denied, send the user to App info → Permissions with a short explanation.

---

## 9. Acceptance tests (all must pass on real phones)

Test on at least **Samsung (Android 14 or 15), Xiaomi / Redmi (MIUI / HyperOS), and a Pixel or other stock Android 15/16**. Also one Android 10 or 11 device.

**Sign-in and setup**
1. Sign in with an employee ID and password against the production CRM. A wrong password shows the server's message.
2. Grant all permissions. The main screen shows every card green, and the dialer shows "Ready for calls from the CRM".
3. Kill the app, reboot the phone: the dialer reconnects without opening the app.

**Click-to-call**
4. Click Call on a lead in the website. The phone dials within 2 s, and the website says "Calling … on <phone>".
5. Turn off the phone permission, click Call: the website shows the failure and the phone shows "Tap to call".

**After-call form**
6. Outgoing call to a known lead, 30 s: the form opens by itself over the dialler or home screen, with the lead's details.
7. Choose Interested, add a note, pick "Tomorrow 11 AM", Save. Within 10 s the website's lead drawer shows the follow-up tagged **Phone**, the stage is Interested, and the next follow-up is tomorrow 11:00.
8. Outgoing call not answered: *Not reachable* is pre-selected, and the follow-up defaults to about 2 hours later.
9. Converted: asks for the deal value, and the lead becomes Won with that value. Lost: asks for a reason, and the lead becomes Lost with that reason.
10. Pick date & time: custom date and time saved correctly (check the IST time in the website).
11. Incoming call from an unknown number, answered: "New number" form. Enter a name, city and service, Save: the lead is created, owned by this BDM, stage Contacted, and the call is linked.
12. Unknown number → **Personal call — skip**: the call is logged, no lead is created.
13. Number owned by another BDM: only the "another BDM's lead" message, no details shown.
14. **Later** / ✕ / Back: the form closes and a "Log call with …" notification remains. Tapping it reopens the same form.
15. Without the overlay permission: no pop-up, but a heads-up "Log call with …" notification appears, and tapping it opens the form.
16. Locked phone: the form or notification appears after unlocking (or full-screen if allowed).
17. Two calls back to back without saving: each call has its own notification and form.
18. Rotate the phone and switch apps while the form is open: nothing typed is lost, and there's no crash.

**Modes and offline**
19. Mode "Only CRM leads": no form after a call to an unknown number, but the form appears for a lead. Mode "Off": never.
20. "Personal phone" ticked: calls to non-leads never appear in the CRM Call Log, and the form only opens for leads.
21. Airplane mode during a call, then fill the form and Save: "saved on the phone" message. Turn the network back on: within a sync (or **Sync now**) the follow-up appears in the CRM exactly once.
22. Missed call from a lead: "Missed call from <name>" notification, and tapping it opens the dialler with the number.

**Robustness**
23. Leave the phone idle overnight: next morning the Call button still works, and yesterday's calls are all in the CRM.
24. Sign out: the service stops, notifications stop, and saved forms are cleared.
25. No crashes or ANRs across a full working day (check logcat and Android vitals).

---

## 10. Known risks to check carefully

- **Android 15+ background activity start** with the overlay permission (section 6.2 step 5). If the invisible-overlay approach doesn't open the form on some devices, the notification path must still work reliably. Report which devices behave how.
- **OEM battery killers** (Xiaomi, Vivo, Oppo, Realme, OnePlus). Keep the foreground service alive and guide users to "Autostart" and "No restrictions". Consider adding deep links to those OEM settings screens.
- **Dual-SIM phones:** the call log must be read correctly for both SIMs, and click-to-call uses the default SIM. If there's a preference, open the system chooser.
- **Call-log write delay** on some phones can be longer than 7 s. Increase the search window in `AfterCall.findCall` if needed.
- **VoIP calls (WhatsApp etc.)** aren't in the call log and are out of scope.

---

## 11. Deliverables

1. Signed release APK **v1.2.0** (versionCode 5) built with `-PcrmUrl=https://<your-crm-domain>`.
2. The release keystore, its passwords and alias, handed over privately to the owner.
3. Source changes committed back to `apps/mobile` in this repository, with a short changelog.
4. A test report: device models and Android versions against the checklist in section 9, with screenshots of the form (known lead, new number, lost reason, follow-up picker).
5. Updated `apps/mobile/README.md` if the build steps changed.

**Not in scope:** iOS (Apple doesn't allow reading call history), call recording, reading contacts or SMS, Play Store publishing.

**Backend contact:** if an endpoint behaves differently from section 7, report the exact request and response. The backend has automated tests for every endpoint listed here (`apps/web/test/afterCall.test.ts`, `apps/web/test/mobile.test.ts`).
