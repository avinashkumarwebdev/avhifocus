# AVHIFocus 🌿📚

A cozy multiplayer **virtual classroom** for focused study. There is exactly **one shared
classroom** — no creating, no joining codes to trade: anyone who opens the app walks to the
same door, peeks inside, and takes one of 10 benches. A shared **50-minute focus / 10-minute
break** clock keeps everyone in rhythm, a **48-hour leaderboard** rewards real focus minutes —
break time never counts — presence pulses keep every minute honest, and preset **quick
check-in notes** let classmates ask "are you there?" without a distracting chat.

If the classroom is **empty (0 benches taken)**, everything sleeps — timer, leaderboard and
study features stay stopped and the only thing available is your own profile. The first
student to take a bench wakes the room up. Difficulty defaults to **Moderate**
(randomized “still studying?” pulse checks every 10–18 min).

React + TypeScript + Vite · Three.js (React Three Fiber) · Supabase (PostgreSQL + RLS + Realtime +
Edge Functions) · PWA · Vercel.

---

## 1. Try it immediately (zero setup)

```bash
npm install
npm run dev        # http://localhost:5173
```

With **no environment variables set**, AVHIFocus runs with a clearly labelled, built-in
**demo backend** (badge shown in the UI). It enforces the same product rules — 10-seat
capacity, stable seats, eligible-focus-time scoring, 48-hour periods — and syncs
**realtime between browser tabs** via `BroadcastChannel`.

Try it: open the app in two browser tabs and take a bench in both. Two students, one
shared Hall, live updates. Inside a room, the **Demo mode** panel can also add/remove
clearly-labelled simulated classmates. Difficulty defaults to **Moderate** on the shared
Hall: start studying, and a randomized “Still studying?” pulse arrives within 10–18
minutes — ignore it and the timer freezes (earned minutes are kept; only the gap never
counts). The Hall code is `STUDY9` by default (override with `VITE_HALL_CODE`).

### Production mode (Supabase)

Copy `.env.example` → `.env.local` and fill in `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`
(see §5). The app automatically switches backends — same UI, real multi-device multiplayer.

---

## 2. Product flow (single shared classroom)

```
Welcome ──▶ (first time: Details — name/class) ──▶ Hall doorway (/hall)
                                                        │  peek: N/10 benches taken
                                                        ▼
                                         "Take a seat" ──▶ Classroom (/room/:id)
```

* **The doorway never seats anyone automatically.** `avhi_hall_peek(code)` (migration
  0006) returns bench/studying counts only — no identities cross the door. If the
  server shows an active bench from an earlier visit, the app rejoins it directly.
* **0 students ⇒ dormancy.** When every bench is free the doorway says so and all
  classroom features stay stopped; the only thing that runs is your own profile
  (edit it any time). `avhi_sweep_room` closes a disappeared student's session at
  last-heartbeat +90s and freezes it after 5 minutes offline (migration 0005), and
  an explicit Leave frees the bench instantly.
* **Difficulty defaults to Moderate** (= `balanced` integrity; migration 0006 seeds the
  production Hall `STUDY9` and sets `balanced` as the table default). Room Settings can
  raise/lower it afterwards.

## 3. Scripts

| Command           | Purpose                                  |
| ----------------- | ---------------------------------------- |
| `npm run dev`     | Vite dev server (0.0.0.0:5173)           |
| `npm run build`   | Typecheck + production build (incl. SW)  |
| `npm run preview` | Serve the production build locally       |
| `npm run test`    | Vitest — 50 unit tests                   |
| `npm run typecheck` | `tsc --noEmit` (strict)                |

---

## 4. Architecture

```
src/
  app shell:  App.tsx · main.tsx · sw.ts (PWA service worker, injectManifest)
  pages/      Welcome · Details · Hall (the doorway) · Classroom · Leaderboard · Settings
  components/ design system (ui.tsx) · Logo · AvatarChip · AvatarPicker · Toasts
  components/room/  TimerDisplay · ParticipantsPanel · SeatPanel (nudges + quick notes) ·
              ConnectionBadge · PulseGate (integrity modal) · ViewPicker
  three/      ClassroomScene · RoomShell · Bench · StudentAvatar · Teacher · CameraRig ·
              cameraViews · Fallback2D
  hooks/      useRoomSync (subscription/heartbeat/reconnect lifecycle) · useNow ·
              useStrictGuard (strict-mode idle/tab signals)
  stores/     identity (zustand, persisted) · app prefs + toasts
  services/backend/
              types.ts      — Backend contract
              supabase.ts   — production backend (RPC + Realtime + push)
              local.ts      — demo backend (mirrors production rules; test-injected clock)
  lib/time/   cycle.ts (shared-clock math) · periods.ts (48h rotation)
  lib/        validation (zod) · avatars · notifications · ambient (generated rain) ·
              quickMessages (5 preset check-ins) · nativePush (Capacitor FCM/local)
supabase/
  migrations/ 0001 schema · 0002 secure functions · 0003 RLS + grants ·
              0004 integrity pulses (anti-cheat engine)
  functions/  focus-notify (Edge Function for Web Push on study start)
tests/        cycle · periods · localBackend (capacity race, idempotency, scoring) ·
              integrity (pulses, halts, caps, nudges) · messages (quick check-ins)
android/      Capacitor native project (APK build — see §13)
capacitor.config.ts · .github/workflows/android.yml (CI APK builder)
```

**Design principles:** the 3D room is the product (kept prominent, overlays restrained);
a phase-aware teacher stands at the front desk keeping time (reads during focus, waves
the class up for stretches on breaks); every visible behaviour is derived from backend
state; anything a browser says is treated as untrusted and re-validated server-side.

---

## 5. Supabase setup (production backend)

1. **Create a project** at [supabase.com](https://supabase.com) (free tier is fine).
2. **Apply migrations** — either via the SQL editor (paste each file, in order) or CLI:
   ```bash
   npm install -g supabase
   supabase link --project-ref <your-ref>
   supabase db push            # applies supabase/migrations in order
   ```
3. **Enable anonymous sign-ins**: Dashboard → Authentication → Providers →
   turn on **Anonymous Sign-Ins**. Students never type an email or password; Supabase
   issues a JWT that RLS uses as the principal.
4. **Environment**: in your Vite env (`.env.local` for dev, Vercel env for prod):
   ```
   VITE_SUPABASE_URL=https://<your-ref>.supabase.co
   VITE_SUPABASE_ANON_KEY=<anon public key>
   ```
   Only ever use the **anon** key client-side. The **service-role key must never
   appear** in any `VITE_*` variable or the repo — it lives solely in Edge Function
   secrets.
5. **Realtime**: the migrations add `classroom_members` and `study_sessions` to the
   `supabase_realtime` publication; no dashboard action needed. If Realtime is disabled
   project-wide, enable it under Project Settings → API.

---

## 6. Security model (read this before modifying SQL)

| Requirement | Enforcement |
|---|---|
| Max 10 students, race-proof | `avhi_join_classroom()` takes `pg_advisory_xact_lock` on the classroom, counts active members, assigns the lowest free seat — inside one transaction. |
| Identity without passwords | Supabase **anonymous auth** → `auth.uid()`. RLS + every SECURITY DEFINER function checks the caller's membership. `student_id` from the client is never trusted. |
| No self-awarded points | Sessions are opened/closed only by `avhi_start_study`/`avhi_stop_study`; elapsed time uses **`now()` on the server**, never client durations. Eligible time = overlap with focus-phase intervals. |
| Clock can’t be reset | `cycle_anchor_at` is written once at creation; no UPDATE policy exists on `classrooms`. Phase is *derived*, not stored. |
| Code enumeration | No SELECT policy exposes rooms you’re not in; `rooms` are only entered via the join RPC. |
| Ghost-studying | Presence pulses are generated and checked **server-side** (`avhi_sweep_room` runs on every read/RPC); a missed pulse halts accrual at server time. Only verified, banked segments ever appear on the leaderboard (plus a 10h/daily cap). |
| Nudge abuse | Rate-limited to one nudge per sender→classmate per 10 minutes inside the nudge RPC itself. |
| Push secrets | `push_subscriptions` policies: `student_id = auth.uid()` for all operations. |
| Grants | Browsers get `SELECT` (+ self-service on push/prefs). All other writes flow through reviewed functions. `anon` role gets nothing. |

**Disconnect policy (documented):** an open session survives refresh/tab close so students
can rejoin gracefully; it is automatically **closed and capped at 6 hours** by
`avhi_sweep_room`/`avhi_close_stale_sessions` (callable via `pg_cron` or an Edge-Function
cron for invocations when nobody is reading). Presence is by heartbeat (`last_seen_at`);
avatars of disconnected students render dimmed as “away”, never as studying.

---

## 7. The shared 50/10 clock

* Stored: `cycle_anchor_at`, `focus_duration_seconds` (3000), `break_duration_seconds` (600).
* Any client's phase = `(server_now − anchor) mod 3600` — focus below 3000s, else break.
* Clients sync a server-time **offset** (`server_now()`) on load, on reconnect, and on
  visibility restore, then tick locally. Two devices with wrong local clocks still agree.
* Nothing ever resets the anchor: joining, leaving, refresh, sleep, or an empty room for
  hours. Realtime carries **state changes only** — no per-second traffic.
* **Scoring**: `focusSegmentsBetween()` (TS) and `avhi_focus_segments()` (SQL) implement the
  same interval-overlap rule; sessions spanning breaks or the 48h boundary are split exactly.
  Test-covered in `tests/cycle.test.ts` and `tests/periods.test.ts`.

**48-hour leaderboard:** periods derive from `classrooms.created_at` (stable anchor),
`rank()` gives shared ranks for ties, segments are pre-split per period so **history is
immutable** — a new period never rewrites the old one.

---

## 8. Fair-play integrity (anti-cheat)

The problem it solves: a student leaves their timer running, does something else, and
tops the leaderboard. AVHIFocus makes *idle* progress structurally impossible while
staying kind to honest students.

**The rules nobody opted into (always on):** server-side timestamps only · at most one
open session per student · 6-hour stale-session sweep · **10h/day leaderboard cap**
per UTC day (applied at read time, history untouched).

**Integrity levels per room** (Settings → Classroom integrity):

| Mode | What happens |
|---|---|
| **Relaxed** (default) | Trust-based. Sessions run uninterrupted (6h safety cap only). |
| **Balanced** | Presence pulses: a randomized “Still studying?” check every **10–18 minutes** of focus time with a **2-minute** tap-to-confirm. Missed → the session **halts**. 2-hour session cap (prompt to continue). Classmates can send rate-limited **nudges** that put an immediate short pulse on someone’s session. Leaderboard carries a “✓ verified minutes” note. |
| **Strict** | Balanced + client-side signals: no input for 18 minutes, or the tab hidden >90 seconds → auto-pause (documented as best-effort; everything real is still enforced server-side). |

**How a halt works (the important part):** earned time is *banked* — segments up to the
missed pulse are recorded at server time — then accrual freezes. **Resuming opens a new
accrual window; the gap away can never be counted retroactively.** Pauses are public
(paused avatars slump, “paused 💤” in the roster and seat panel), so disappearance is
socially visible. Clock math, boundaries and caps are mirrored identically in
`src/services/backend/local.ts` (demo) and `supabase/migrations/0004_integrity_pulses.sql`
(`avhi_ack_pulse` · `avhi_resume_session` · `avhi_nudge` · `avhi_set_integrity` ·
`avhi_bank_window`/`avhi_halt_session`, sweeping on every read; nudge abuse limited to one
per sender→target per 10 minutes server-side).

**Quick check-in notes (the “4–5 message chat”):** tap a classmate’s seat → *Send a quick
note* → one of five fixed presets (“Are you there? 👀”, “Still studying? 🙂”, “Take a short
break ☕”, “You’ve got this! 💪”, “Nice focus today 🔥”). Deliberately preset-only — no free
text — so there is nothing to moderate and no distraction rabbit hole. Notes are ephemeral
broadcasts (never stored, never scored), rate-limited to one per sender→classmate per 45 s,
and validation rejects anything that isn't a known preset.

---

## 9. PWA

* `vite-plugin-pwa` (injectManifest) → `src/sw.ts`: precaches the app shell, offline
  navigation fallback to `index.html`, auto-update on new deploys.
* Installability: manifest + SVG/PNG/maskable icons + `display: standalone` + HTTPS.
  The **Install app** button appears only when the browser fires `beforeinstallprompt`.
* Offline: cached shell + last-known room snapshot stays visible with an
  **“Offline — last sync shown”** badge; offline edits are never accepted as scores.

---

## 10. Web Push (focus-start notifications)

Notifications degrade gracefully by layer:

1. **Realtime UI** — always: open-room views update instantly.
2. **In-app + native notifications** (permission granted): fired from room events.
3. **Background/closed-app push**: requires the Edge Function + VAPID keys.

Setup:

```bash
npx web-push generate-vapid-keys        # prints a public/private pair

supabase functions deploy focus-notify
supabase secrets set \
  AVHI_VAPID_PUBLIC_KEY=<public> \
  AVHI_VAPID_PRIVATE_KEY=<private> \
  AVHI_VAPID_CONTACT=mailto:you@example.com \
  AVHI_APP_ORIGIN=https://your-app.vercel.app \
  AVHI_WEBHOOK_SECRET=<random-long-string>
```

Then in the Dashboard → Database → Webhooks: create a webhook on
`study_sessions` **INSERT**, HTTP POST to
`https://<ref>.functions.supabase.co/focus-notify`, with header
`x-avhi-webhook-secret: <same secret>`.
Add `VITE_VAPID_PUBLIC_KEY=<public>` to the frontend env so the browser can subscribe.

> **No "Webhooks" UI or programmatic setup?** Use `supabase/SETUP_PUSH_TRIGGER.sql`
> instead — it wires the same INSERT→function call with a `pg_net` trigger
> (verified on projects without the dashboard webhooks surface). Keep
> `ENABLE hardening`: the trigger function's EXECUTE is revoked from clients.

Behaviour: the **starter is never notified**, quiet hours are respected client-side,
dead subscriptions are pruned, and a notification click **opens the right classroom**.
FCM remains an option: Web Push endpoints (incl. FCM's) are stored per-student; swap
`npm:web-push` delivery for FCM HTTP v1 in `focus-notify` if you prefer.

---

## 11. Deploy to Vercel

```bash
npm i -g vercel && vercel
```

`vercel.json` is already configured (Vite framework + SPA rewrites). Add the env vars
(§4, §8) in the Vercel project settings → Environment Variables, then redeploy.
HTTPS is automatic → PWA install + Web Push become available.

---

## 12. Tests

`npm run test` — 46 checks covering the critical guarantees:

* **Clock**: phase at boundaries, correctness hours later, determinism across clients.
* **Scoring**: full blocks, break exclusion, sessions spanning breaks, multiple cycles.
* **48h periods**: index derivation, exact splitting at the boundary, immutability of history.
* **Capacity**: 10 succeed, 11th rejected, two-way race for the last seat, freed seats reused.
* **Sessions**: start/stop idempotency, visibility across “tabs”, abandoned-session capping.
* **Integrity**: pulse scheduling/acks, missed-pulse halts, resume windows excluding the gap,
  2h session caps, nudge rate-limiting + immediate pulses, self-pause, 10h/day leaderboard cap.
* **Quick notes**: preset-only delivery across tabs, sender→target rate limit, ephemerality.
* **AuthZ**: non-members cannot read a room.
* **Realtime**: `focus-started` payloads include validated display info.

---

## 13. Known limits (honest list)

* Demo mode is single-device by design (it’s a local simulator, not a server).
* 3D: procedural geometry only — no external models — so it stays light; devices without
  WebGL get the fully-functional 2D seat map.
* Presence and stale-session sweeping are heartbeat/timeout based, which suits
  classroom-scale collaboration (it is not a hard realtime game protocol).
* Push delivery is best-effort and depends on the OS/browser — the app never blocks
  studying on it.
* Strict-mode idle/tab signals are browser hints and can be forged by a determined
  cheater; the server-enforced pulses, session caps and daily caps are the real deterrents
  (a scripted cheater gains nothing a one-tap ack doesn't already give an honest student
  — but their *nudge pressure and visible pauses* persist).
* Quick notes are preset-only by design (five fixed phrases, 45 s sender→target cooldown);
  on Supabase the cooldown is enforced client-side because notes are ephemeral broadcasts —
  an attacker could only emit *those same five presets* faster, which is annoying, not
  harmful. Web Push on some Chinese/Indian OEM Android ROMs is unreliable — install the APK
  (§14) for guaranteed OS-level delivery.

---

## 14. Android APK (native app with reliable notifications)

The browser build is a fine PWA, but Web Push depends on the browser/OS being generous.
The **APK** gives Android-class notifications through FCM plus in-app local notification
fallbacks. The project is pre-configured with Capacitor (`capacitor.config.ts` →
`android/`), including the FCM service, notification channel `avhi_study_buddies`, status
icon and deep-link handling (notification taps open the right classroom).

### Option A — no Android tooling on your machine (recommended)

The repo includes **`.github/workflows/android.yml`**: push to `main` (Actions tab →
*Android APK* → Run workflow) and download **`avhifocus-debug-apk`** from the workflow
artifacts. Debug builds are unsigned — Android will offer the normal “install anyway”
prompt for sideloads. That’s expected and fine for your own devices.

### Option B — build locally (Android Studio)

Prereqs: **JDK 17+** and **Android Studio** (with SDK Platform 35).

```bash
npm install
npm run build
npx cap sync android          # copies dist/ into android/app assets
npx cap open android          # opens Android Studio → ▶ Run, or:
cd android && ./gradlew assembleDebug
# → android/app/build/outputs/apk/debug/app-debug.apk
```

### Enabling FCM push delivery (production-grade notifications)

> **Canonical step-by-step?** `docs/apk-notifications-setup.md` — resolves the 4 missing pieces in order (Firebase project, google-services.json, FCM secret, CI env). Summary below:

1. [console.firebase.google.com](https://console.firebase.google.com) → create a project
   → **Add Android app** with package `com.avhifocus.app` → download `google-services.json`
   → place it at **`android/app/google-services.json`**, then `npx cap sync` and rebuild.
   (The gradle plugin applies automatically when the file exists; without it the app still
   builds/runs, registration just no-ops.)
2. Firebase project settings → Service accounts → **Generate new private key** → set it as
   an Edge Function secret:
   ```bash
   supabase secrets set AVHI_FCM_SERVICE_ACCOUNT='<full JSON on one line>'
   ```
   The `focus-notify` function already routes tokens stored as `fcm:<token>` via **FCM
   HTTP v1** (both VAPID Web Push and FCM coexist per-device).
3. In the installed app: Settings → *Enable notifications* grants the runtime permission;
   the FCM token is saved to `push_subscriptions` automatically once the student joins any
   classroom.

Release signing for Play/side-load distribution: standard Android keystore
(`keytool -genkey …`, configure `signingConfigs` in `android/app/build.gradle`) —
documented in Android's official guide; switch CI to `assembleRelease` when ready.
