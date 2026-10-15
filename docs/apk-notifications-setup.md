# Make notifications work in the installed APK — step by step

Everything in the app is already wired (FCM registration, token saving, the
`focus-notify` Edge Function that routes `fcm:` tokens, deep-links). Missing are
exactly four config pieces. Follow in order; each step ends with a check.

---

## Step 1 — Create the Firebase project (5 min)

1. Open [console.firebase.google.com](https://console.firebase.google.com) → **Add project** →
   name it `avhifocus` (any name) → disable Google Analytics (not needed) → **Create**.
2. On the project page click the **Android** icon → register the app:
   - **Package name:** `com.avhifocus.app` (must match — it's in `capacitor.config.ts`)
   - Nickname: AVHIFocus · SHA-1: leave empty (debug builds)
3. Click **Register app** → **Download `google-services.json`**.

✅ **Check:** the JSON contains `"package_name": "com.avhifocus.app"`.

## Step 2 — Place `google-services.json` in the repo (2 min)

1. Copy the downloaded file to **`android/app/google-services.json`**.
2. Commit and push it. It is client config, not a credential (Firebase docs treat it
   as public-by-design; our Gradle script applies the google-services plugin only when
   the file exists — without this commit the CI APK builds fine but FCM never registers).

✅ **Check:** `android/app/google-services.json` appears on GitHub after pushing.

## Step 3 — Tell the Edge Function how to send FCM (5 min)

> ✅ **DONE** (via the Management API) — `AVHI_FCM_SERVICE_ACCOUNT` is live on project
> `opwiziyjutvjiyajbkjo`. If you ever rotate the key, repeat: Firebase → Project
> settings → Service accounts → Generate new private key → set the new one-line JSON
> as the same secret. "One line" just means remove newlines; the file you uploaded
> was already minified when set programmatically.

## Step 4 — Bake the Supabase keys into the CI APK (3 min)

Without these, the workflow-built APK silently falls into **demo mode** with no
notifications. (Local `.env.local` builds don't need this — it's CI only.)

1. GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**, add:
   - `VITE_SUPABASE_URL` = `https://opwiziyjutvjiyajbkjo.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = your publishable key (`sb_publishable_…`)
2. The workflow (`.github/workflows/android.yml`) already writes these into `.env.production`
   before building — as of this commit.

✅ **Check:** both secrets exist under Actions secrets.

## Step 5 — Build & install the APK

**CI:** push to `main` (or Actions → *Android APK* → Run workflow) → download
**`avhifocus-debug-apk`** from artifacts → install on your phone (allow "install anyway").

**Local:** `npm run build && npx cap sync android && cd android && ./gradlew assembleDebug`
→ `android/app/build/outputs/apk/debug/app-debug.apk`.

✅ **Check the APK is real backend, not demo:** open the app — if you see a
"Demo mode (no Supabase configured)" chip on the welcome screen, Step 4 was skipped.

## Step 6 — Turn notifications on inside the app

1. Open the APK → enter the classroom → take a seat.
2. Top-right ⚙ Settings → **Notifications → Classmate focus alerts** → toggle ON.
3. Android shows the permission prompt (now — and only now, by design) → **Allow**.
4. The app registers with FCM and saves your token quietly in the background.

✅ **Check:** in Supabase → Table Editor → `push_subscriptions` a new row appears with
`endpoint` starting with `fcm:`.

## Step 7 — Prove it end-to-end

1. From **a second device or browser tab**: enter the classroom → take a seat → **Start studying**.
2. Within seconds your **phone** gets: *“X (Class Y) started focusing”*.
3. Tap the notification → the APK opens straight into the classroom.

If you close the app completely the notification still arrives (that is the whole
point of the FCM path).

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| "Demo mode" chip in the APK | Supabase env not baked in | Step 4 (CI) or build with `.env.local` present |
| Nothing in `push_subscriptions` | google-services.json missing at build time | Step 2, rebuild |
| Token row exists, no notification | FCM secret missing/wrong | Step 3; check function logs in dashboard |
| Works in browser, not APK | Browser uses Web Push (VAPID) — different channel | APK needs Steps 1–3 regardless |
| Notifications arrive but silent delay on some phones | OEM battery savers | Settings → Battery → the app → "No restrictions" |

Function logs: Supabase dashboard → Edge Functions → `focus-notify` → **Logs** shows
each delivery attempt (`fcm: sent=true` etc.).
