-- ═══════════════════════════════════════════════════════════════════════════
-- AVHIFocus · Migration 0003 — Row Level Security + read-only grants.
--
-- Summary of the security model:
--  • Browsers (anon/authenticated) can SELECT only rows they need, scoped to
--    classrooms they actively belong to.
--  • All writes to core tables are prohibited at the grant level; every state
--    change flows through SECURITY DEFINER functions that validate the caller.
--  • join_code is only usable via avhi_join_classroom — no enumeration.
--  • push credentials are readable/writable only by their owner.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.classrooms enable row level security;
alter table public.classroom_members enable row level security;
alter table public.study_sessions enable row level security;
alter table public.study_session_segments enable row level security;
alter table public.leaderboard_periods enable row level security;
alter table public.leaderboard_scores enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notification_preferences enable row level security;

-- ── classrooms: members see their own rooms only (join_code ⇒ membership) ───
create policy classrooms_member_read on public.classrooms
  for select to authenticated
  using (public.avhi_is_member(id));

-- ── members: co-members read the minimum roster; no direct writes ───────────
create policy classroom_members_read on public.classroom_members
  for select to authenticated
  using (public.avhi_is_member(classroom_id));

-- ── sessions & segments: read-only within your classrooms ──────────────────
create policy study_sessions_read on public.study_sessions
  for select to authenticated
  using (public.avhi_is_member(classroom_id));

create policy segments_read on public.study_session_segments
  for select to authenticated
  using (public.avhi_is_member(classroom_id));

create policy periods_read on public.leaderboard_periods
  for select to authenticated
  using (public.avhi_is_member(classroom_id));

create policy scores_read on public.leaderboard_scores
  for select to authenticated
  using (
    exists (
      select 1 from public.leaderboard_periods lp
      where lp.id = period_id and public.avhi_is_member(lp.classroom_id)
    )
  );

-- ── push subscriptions: strictly the owner ──────────────────────────────────
create policy push_owner_all on public.push_subscriptions
  for all to authenticated
  using (student_id = auth.uid())
  with check (student_id = auth.uid());

-- ── notification preferences: strictly the owner ────────────────────────────
create policy prefs_owner_all on public.notification_preferences
  for all to authenticated
  using (student_id = auth.uid())
  with check (student_id = auth.uid());

-- ── grants: read-only tables; writes only through functions (0002) ─────────
grant select on public.classrooms to authenticated;
grant select on public.classroom_members to authenticated;
grant select on public.study_sessions to authenticated;
grant select on public.study_session_segments to authenticated;
grant select on public.leaderboard_periods to authenticated;
grant select on public.leaderboard_scores to authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant select, insert, update on public.notification_preferences to authenticated;

-- nothing for the raw 'anon' role: anonymous sign-in upgrades to authenticated
