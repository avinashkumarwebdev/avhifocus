# AVHIFocus — 2026-10-15 update runbook (do these 3 things, ~10 min)

Commit `de532b6` adds: actionable study notifications, the sticky timer card,
nudge/note pushes, the pass-guarded "Guardian tools" wipe, and the mobile 3D
classroom fixes. To make it all live you need to do THREE small things.

---

## 1) Run the new database migration (2 minutes)

1. Open **Supabase dashboard → your project → SQL Editor → New query**.
2. Open the file `supabase/migrations/0007_direct_notify_guardian.sql` and
   copy its **entire** contents.
3. Before running, replace the TWO placeholder values (same ones you used last
   time in SETUP_PUSH_TRIGGER):
   - `<YOUR-PROJECT-REF>` → your project ref (looks like `opwiziyjutvjiyajbkjo`)
   - `<SAME-AVHI_WEBHOOK_SECRET-AS-FUNCTION-SECRET>` → the webhook secret you
     set for the focus-notify function
4. Run it. You should see "Success. No rows returned".

This gives you: the 3-minute answer window, push hooks for nudges/notes, and
the Guardian wipe (pass `Avhi9204` — checked server-side, never in the app).

## 2) Redeploy the Edge Function (3 minutes)

Terminal (needs supabase CLI, same as last time):

```bash
supabase functions deploy focus-notify
```

No terminal? Dashboard alternative: **Edge Functions → focus-notify →
Code → paste the entire contents of `supabase/functions/focus-notify/index.ts`
→ Deploy**.

## 3) Push the code + rebuild the APK

The git commit is ready; it just needs your GitHub token to be pushed
(credentials aren't kept between my sessions for safety). Reply in chat with
your GitHub personal access token — I push, CI builds the APK, and I verify.

If you'd rather push yourself:

```bash
git push origin main
```

Then the GitHub Action builds the APK automatically (Actions tab → workflow →
Artifacts). **Before installing the new APK: UNINSTALL the old one first**
(debug builds can't upgrade over each other — install will fail otherwise).

---

## What changed (so you can test each one)

1. **Non-removable notification** — while your timer runs there's a sticky
   "🔥 Focusing" card that can't be swiped away.
2. **"I'm here" from anywhere** — presence checks arrive as real
   notifications with buttons: **✋ I'm here — keep counting** and
   **⏸ Pause my timer**. You answer from the shade — even mid-YouTube — and
   the app parks itself again. You now have **3 minutes** instead of 2.
3. **Nudges & notes reach a closed app** — real pushes with the sender's
   name; tapping opens straight into the room (nudges auto-verify).
4. **Nicer look** — sender's name in the title, classroom in the body,
   proper colors, separate channels (You can fine-tune sound/vibration per
   type in Android Settings → Notifications → AVHIFocus).
5. **Guardian tools** — Settings → "Guardian tools": pick the student, enter
   pass `Avhi9204`, wipe. Removes their sessions, leaderboard history,
   notification subs and their bench. Server-checked; works on web too.
6. **Classroom looks right on phones** — no more beige void (there's now a
   back wall with a door and clock), camera can never leave the room, labels
   don't get cut or mirror, and the broken "Top down" view is now a proper
   "High back" corner view. Portrait phones get a wider lens so everyone fits.

## Notes

- The database has two test rooms from my checks ("Nudge Repro …",
  "Ghost Watch"). Ignore or delete them in the dashboard Table Editor.
- If a friend still has the old APK: nudge/note pushes need the NEW APK
  (or the web app) on THEIR phone to show — the server side is compatible
  either way.
