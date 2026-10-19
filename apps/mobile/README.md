# Voice Tunes India (Android)

Android app for salespeople (BDMs). It dials leads when Call is clicked in the CRM, adds every call to the CRM, and
after each call opens a short form so the outcome, a note and the next follow-up go straight into the CRM. Only the
number, type, time and length of calls are read — never contacts or SMS. Calls are recorded only when **Record
calls** is switched on (see below).

- **Call button:** clicking Call on a lead in the CRM website makes this phone dial the lead. The app keeps one
  request open to the CRM (`POST /api/calls/dialer/poll`, shown as the "Ready for calls from the CRM" notification);
  a click reaches the phone in about a second. No Firebase or other push service is needed.
- **After-call form:** when a call ends the form slides up with the lead's name, stage, last follow-up and when it
  was due. Pick what happened (Connected, Call back, Not reachable, Interested, Not interested, Converted, Lost), add
  a note, and choose the next follow-up (quick picks or any date and time). Won deals ask for the value, lost ones
  for the reason. A new number can become a lead right there (name, city, service), or be skipped as a personal call.
  Saving runs the same rules as the website: the lead's stage, first/last contact and next follow-up are updated and
  the follow-up appears on the lead, tagged **Phone**.
- **Offline:** a form filled in without a connection is kept on the phone and uploaded by the next sync; it is
  never saved twice.
- **Missed calls from your leads** show a "Call back" notification.
- **Sync:** a few seconds after every call ends, every 15 minutes in the background, and on "Sync now". The first sync
  after sign-in starts from the beginning of that day — older history is never sent.
- **When the form opens** (in the app): after every call, only after calls with CRM leads, or never. "Personal phone"
  sends and asks about CRM leads only.
- **Call recording (in this app):** tick **Record calls**, allow the **Microphone**, and switch on **Voice Tunes India
  call recorder** in Settings → Accessibility (the app has buttons for each step). Every connected call is then
  recorded by the app itself — a "Recording call" notification shows while it runs — saved in the app's private
  storage, matched to the call once it syncs, uploaded straight to the CRM's storage and deleted from the phone. The
  CRM converts it to text in the language that was spoken. Recordings are about 250 KB a minute; tick **only on
  Wi-Fi** to save mobile data. Personal calls on a "Personal phone" are never uploaded.
  - Android keeps the call's own audio for the phone's built-in dialer, so the app records through the microphone:
    the salesperson is always clear; the customer is as loud as the phone plays them — clearest on speaker.
  - The accessibility setting reads nothing on screen; while it is on, Android lets the app use the microphone during
    calls. On Android 13+ a sideloaded app's accessibility switch is greyed out until App info → ⋮ → **Allow
    restricted settings**.
  - Some phones still give apps silence during calls. The app notices (the recording is dropped and a warning shows)
    and tries a different microphone source on the next call.
- Android 8.0+ only. iPhones don't allow apps to read call history — use the Exotel calling line for them.

## Build the APK

Needs JDK 17 and the Android SDK (platform 35). Pass the CRM's address so it is filled in on the sign-in screen:

```bash
cd apps/mobile
./gradlew assembleRelease -PcrmUrl=https://your-crm.vercel.app
```

The APK is at `app/build/outputs/apk/release/app-release.apk`. Or open `apps/mobile` in Android Studio and press Run
(add `crmUrl=https://your-crm.vercel.app` to `gradle.properties` to pre-fill the address there too).

First-time toolchain setup on a Mac:

```bash
brew install openjdk@17
brew install --cask android-commandlinetools
export JAVA_HOME="$(brew --prefix openjdk@17)/libexec/openjdk.jdk/Contents/Home"
export ANDROID_HOME="$(brew --prefix)/share/android-commandlinetools"
yes | sdkmanager --licenses
sdkmanager "platforms;android-35" "build-tools;35.0.0" "platform-tools"
```

On Windows, install [Android Studio](https://developer.android.com/studio) (it includes JDK 17 and the SDK), open
`apps/mobile` and use **Build → Generate APKs**, or run `gradlew.bat assembleRelease -PcrmUrl=…` from its terminal.

The APK is signed with the building computer's debug key. Keep building updates on the same computer (or back up
`~/.android/debug.keystore`) — an update signed with a different key won't install over the old app.

## Install on a phone

1. Send the APK to the phone (WhatsApp / Drive / USB) and open it; allow "Install unknown apps" when asked.
2. Open **Voice Tunes India**, check the CRM address (e.g. `https://your-crm.vercel.app`) and sign in with the CRM
   username, email or employee ID and password.
3. Allow **Call logs**, **Phone** (make calls) and **Notifications** — and, for call recording, the **Microphone** and
   **Voice Tunes India call recorder** in Accessibility settings.
4. Tap **Allow pop-up after calls** and switch on **Display over other apps**, so the after-call form opens by itself.
   On Xiaomi, Vivo and Oppo phones also allow **Display pop-up windows while running in the background**
   (App info → Other permissions). Without these, the form waits in a notification instead.
5. Set battery use to **Unrestricted** so the Call button stays connected when the screen is off.

For local development the address can be the computer running `pnpm dev` on the office Wi-Fi, e.g.
`http://192.168.1.4:3000`.

## Why it's not on the Play Store

Google Play only allows `READ_CALL_LOG` for default dialler apps, so internal call-tracking apps are installed directly
(or published privately through Managed Google Play for company phones).
