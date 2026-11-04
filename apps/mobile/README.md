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
- **Retargeting tab:** the old leads a Super Admin allotted to you for today, oldest first, one tap to call. The
  after-call form logs the outcome as usual. Only a Super Admin can hand out a batch, and only on the CRM website.
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

### Signing

Release builds are signed with the project's own key, `apps/mobile/vti-release.jks`, whose passwords sit in
`apps/mobile/keystore.properties`. Neither file is in git (see `.gitignore`), so:

- **Back up both files somewhere safe** (password manager, company drive). Android identifies the app by this key.
  Lose it and no future build can ever update an installed app again — every phone would need the app removed and
  reinstalled, losing its sign-in.
- **Copy both files to any other computer** that needs to build releases. Then the APK installs as an update
  wherever it is built, which is the whole point of having the key.
- Without `keystore.properties` the release build falls back to the debug key so a fresh clone still compiles, but
  that APK **will not install over** a properly signed one. `./gradlew assembleRelease` prints which key it used.

The signing certificate's fingerprints — not secret, safe to keep here. Use them to confirm a restored backup is
the right key, and when registering the app with Google services (Firebase, Maps, Google sign-in):

```
SHA-256  F5:E9:41:58:5F:6F:ED:F3:09:2B:6A:21:3A:16:31:61:EA:D7:EA:82:0B:99:70:32:F7:8B:80:FA:02:77:DE:47
SHA-1    09:4B:6A:C1:A4:04:6A:10:DE:94:26:4D:54:E4:02:C0:B8:7E:4A:8C
```

Check a restored copy with:

```bash
keytool -list -v -keystore vti-release.jks -alias vti | grep SHA256
```

To create the key again from scratch (only if it was lost — see the warning above):

```bash
keytool -genkeypair -v -keystore vti-release.jks -alias vti -keyalg RSA -keysize 4096 -validity 10000
```

Then write `storeFile=vti-release.jks`, `storePassword=…`, `keyAlias=vti`, `keyPassword=…` into
`apps/mobile/keystore.properties`.

**Moving from the old debug-signed builds:** phones carrying an APK built before this key existed must have
**Voice Tunes India uninstalled once** before the new one installs ("App not installed" otherwise). This is the last
time that is needed — after it, every update installs straight over the top.

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
6. On Xiaomi, Redmi, Poco, Oppo, Realme and Vivo phones tap **Autostart** in the app's setup list and switch
   Voice Tunes India on, or the phone stops the app after every restart (Call button offline, no sync).

For local development the address can be the computer running `pnpm dev` on the office Wi-Fi, e.g.
`http://192.168.1.4:3000`.

## Why it's not on the Play Store

Google Play only allows `READ_CALL_LOG` for default dialler apps, so internal call-tracking apps are installed directly
(or published privately through Managed Google Play for company phones).
