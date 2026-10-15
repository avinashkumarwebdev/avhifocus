-- ═══════════════════════════════════════════════════════════════════════════
-- AVHIFocus · 0007 — direct nudge/message pushes, longer answer window,
--                    guardian data-wipe (pass-guarded)
--
-- RUN THIS in the Supabase SQL Editor, but FIRST replace the two ANGLE-BRACKET
-- placeholder values below with the SAME ones you used in SETUP_PUSH_TRIGGER:
--   <YOUR-PROJECT-REF>                          → e.g. opwiziyjutvjiyajbkjo
--   <SAME-AVHI_WEBHOOK_SECRET-AS-FUNCTION-SECRET>
-- The pass for the guardian wipe is Avhi9204 (hard-coded server-side on
-- purpose — it never reaches the browser bundle).
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pg_net;

-- ── shared direct-notification poster (nudges + quick notes) ───────────────
create or replace function public.avhi_notify_student(
  p_student_id uuid,
  p_kind text,               -- 'nudge' | 'message'
  p_classroom_id uuid,
  p_from_name text,
  p_text text default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url := 'https://<YOUR-PROJECT-REF>.functions.supabase.co/focus-notify',
    body := jsonb_build_object(
      'type', 'direct',
      'kind', p_kind,
      'student_id', p_student_id,
      'classroom_id', p_classroom_id,
      'from_name', p_from_name,
      'text', p_text
    ),
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-avhi-webhook-secret', '<SAME-AVHI_WEBHOOK_SECRET-AS-FUNCTION-SECRET>'
    )
  );
end $$;

revoke execute on function public.avhi_notify_student(uuid, text, uuid, text, text) from public, anon, authenticated;

-- ── newer, kinder answer window: 2 → 3 minutes (sweep, replaces 0005 def;
--    everything else in the function is verbatim from 0005) ────────────────
create or replace function public.avhi_sweep_room(p_classroom_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_room public.classrooms;
  v_id uuid;
  v_s public.study_sessions;
  v_last_seen timestamptz;
  v_is_bot boolean;
begin
  select * into v_room from public.classrooms where id = p_classroom_id;
  if not found then return; end if;

  for v_id in
    select id from public.study_sessions
    where classroom_id = p_classroom_id and ended_at is null
  loop
    select * into v_s from public.study_sessions where id = v_id;

    select last_seen_at, is_bot into v_last_seen, v_is_bot
      from public.classroom_members
     where classroom_id = p_classroom_id
       and student_id = v_s.student_id
       and membership_status = 'active'
     limit 1;

    if now() - v_s.orig_started_at > interval '6 hours' then
      perform public.avhi_close_session(v_room, v_s, now());
    elsif coalesce(v_is_bot, false) then
      continue; -- demo buddies are exempt from presence rules
    -- ghost-presence layer: hard floor regardless of integrity mode
    elsif v_last_seen is not null and now() - v_last_seen > interval '15 minutes' then
      perform public.avhi_close_session(v_room, v_s, v_last_seen + interval '90 seconds');
    elsif v_last_seen is not null and now() - v_last_seen > interval '5 minutes' and not v_s.pulse_paused then
      perform public.avhi_halt_session(v_room, v_s, greatest(v_last_seen + interval '90 seconds', v_s.started_at));
    -- integrity pulses (balanced/strict) — 3-minute answer window
    elsif v_s.pulse_paused then
      continue;
    elsif v_s.pulse_due_at is not null and now() > v_s.pulse_due_at + interval '3 minutes' then
      perform public.avhi_halt_session(v_room, v_s, v_s.pulse_due_at + interval '3 minutes');
    elsif v_s.cap_until is not null and now() > v_s.cap_until then
      perform public.avhi_halt_session(v_room, v_s, v_s.cap_until);
    end if;
  end loop;
end $$;

revoke execute on function public.avhi_sweep_room(uuid) from public, anon;
grant execute on function public.avhi_sweep_room(uuid) to authenticated;

-- ── ack pulse: 3-minute window too (replaces 0004 def) ─────────────────────
create or replace function public.avhi_ack_pulse(p_classroom_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_room public.classrooms;
  v_s public.study_sessions;
  v_due timestamptz;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  if not public.avhi_is_member(p_classroom_id) then raise exception 'NOT_A_MEMBER'; end if;
  perform public.avhi_sweep_room(p_classroom_id);
  select * into v_room from public.classrooms where id = p_classroom_id;
  select * into v_s
    from public.study_sessions
   where classroom_id = p_classroom_id and student_id = auth.uid() and ended_at is null;

  if not found or v_s.pulse_due_at is null then
    return null; -- nothing pending — idempotent
  end if;
  if now() > v_s.pulse_due_at + interval '3 minutes' then
    perform public.avhi_halt_session(v_room, v_s, v_s.pulse_due_at + interval '3 minutes');
    return jsonb_build_object('too_late', true);
  end if;

  update public.session_pulses
     set acked_at = now()
   where session_id = v_s.id and acked_at is null and due_at = v_s.pulse_due_at;

  v_due := now() + public.avhi_pulse_interval();
  update public.study_sessions set pulse_due_at = v_due where id = v_s.id;
  insert into public.session_pulses (session_id, classroom_id, student_id, kind, due_at)
  values (v_s.id, p_classroom_id, auth.uid(), 'scheduled', v_due);
  return jsonb_build_object('next_due_at', v_due);
end $$;

grant execute on function public.avhi_ack_pulse(uuid) to authenticated;

-- ── nudge: same behaviour as 0004, PLUS a direct push to the nudged student ─
create or replace function public.avhi_nudge(p_classroom_id uuid, p_target_student_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_room public.classrooms;
  v_s public.study_sessions;
  v_from_name text;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  if not public.avhi_is_member(p_classroom_id) then raise exception 'NOT_A_MEMBER'; end if;
  if p_target_student_id = auth.uid() then raise exception 'VALIDATION: cannot nudge yourself'; end if;
  if not exists (
    select 1 from public.classroom_members
    where classroom_id = p_classroom_id and student_id = p_target_student_id and membership_status = 'active'
  ) then
    raise exception 'NOT_A_MEMBER: target';
  end if;

  if exists (
    select 1 from public.session_pulses
    where classroom_id = p_classroom_id
      and kind = 'nudge'
      and created_by_student_id = auth.uid()
      and student_id = p_target_student_id
      and due_at > now() - interval '10 minutes'
  ) then
    raise exception 'NUDGE_RATE_LIMIT';
  end if;

  perform public.avhi_sweep_room(p_classroom_id);
  select * into v_room from public.classrooms where id = p_classroom_id;
  select * into v_s
    from public.study_sessions
   where classroom_id = p_classroom_id and student_id = p_target_student_id and ended_at is null;

  if found and not v_s.pulse_paused and v_room.integrity_mode <> 'relaxed' then
    update public.study_sessions set pulse_due_at = now() where id = v_s.id;
    insert into public.session_pulses (session_id, classroom_id, student_id, kind, due_at, created_by_student_id)
    values (v_s.id, p_classroom_id, p_target_student_id, 'nudge', now(), auth.uid());
  end if;

  -- direct push so a nudged student is reached even with the app closed
  select display_name into v_from_name
    from public.classroom_members
   where classroom_id = p_classroom_id and student_id = auth.uid() and membership_status = 'active';
  perform public.avhi_notify_student(p_target_student_id, 'nudge', p_classroom_id, coalesce(v_from_name, 'A classmate'));

  return jsonb_build_object('nudged', found and v_room.integrity_mode <> 'relaxed');
end $$;

grant execute on function public.avhi_nudge(uuid, uuid) to authenticated;

-- ── quick check-in note: validate + rate-limit + push (app still broadcasts
--    the note itself over realtime; this only drives the notification) ──────
create or replace function public.avhi_send_message(
  p_classroom_id uuid,
  p_target_student_id uuid,
  p_text text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_from_name text;
  -- must mirror src/lib/quickMessages.ts exactly
  v_allowed text[] := array[
    'Are you there? 👀',
    'Still studying? 🙂',
    'Take a short break ☕',
    'You’ve got this! 💪',
    'Nice focus today 🔥'
  ];
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  if not public.avhi_is_member(p_classroom_id) then raise exception 'NOT_A_MEMBER'; end if;
  if p_target_student_id = auth.uid() then raise exception 'VALIDATION: cannot message yourself'; end if;
  if not (p_text = any(v_allowed)) then raise exception 'VALIDATION: pick a preset note'; end if;
  if not exists (
    select 1 from public.classroom_members
    where classroom_id = p_classroom_id and student_id = p_target_student_id and membership_status = 'active'
  ) then
    raise exception 'NOT_A_MEMBER: target';
  end if;
  -- server-side rate limit: one note per sender-target pair per 10 minutes
  if exists (
    select 1 from public.avhi_direct_events
    where classroom_id = p_classroom_id
      and kind = 'message'
      and sender_student_id = auth.uid()
      and target_student_id = p_target_student_id
      and created_at > now() - interval '10 minutes'
  ) then
    return; -- cooldown: silently skip the push; the live broadcast still landed
  end if;

  insert into public.avhi_direct_events (classroom_id, sender_student_id, target_student_id, kind)
  values (p_classroom_id, auth.uid(), p_target_student_id, 'message');

  select display_name into v_from_name
    from public.classroom_members
   where classroom_id = p_classroom_id and student_id = auth.uid() and membership_status = 'active';
  perform public.avhi_notify_student(p_target_student_id, 'message', p_classroom_id, coalesce(v_from_name, 'A classmate'), p_text);
end $$;

grant execute on function public.avhi_send_message(uuid, uuid, text) to authenticated;

-- log table for the message rate limit above (tiny, self-cleaning enough for
-- classroom scale; rows are audit data only)
create table if not exists public.avhi_direct_events (
  id                  bigint generated always as identity primary key,
  classroom_id        uuid not null references public.classrooms(id) on delete cascade,
  sender_student_id   uuid not null,
  target_student_id   uuid not null,
  kind                text not null check (kind in ('nudge','message')),
  created_at          timestamptz not null default now()
);
create index if not exists avhi_direct_events_rate on public.avhi_direct_events (classroom_id, kind, sender_student_id, target_student_id, created_at desc);
alter table public.avhi_direct_events enable row level security; -- no policies = service/definer only

-- ── guardian wipe: with the special pass, erase ONE student's data ─────────
--    Ends any open session (uncounted), clears all focus history, removes
--    push subscriptions & preferences, and frees their bench. The pass is
--    checked server-side only.
create or replace function public.avhi_prune_student(
  p_classroom_id uuid,
  p_target_student_id uuid,
  p_pass text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_room public.classrooms;
  v_open public.study_sessions;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  if p_pass is distinct from 'Avhi9204' then raise exception 'GUARDIAN_DENIED'; end if;
  if not public.avhi_is_member(p_classroom_id) then raise exception 'NOT_A_MEMBER'; end if;

  select * into v_room from public.classrooms where id = p_classroom_id;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;

  -- stop the clock first (time in progress does not count)
  select * into v_open
    from public.study_sessions
   where classroom_id = p_classroom_id and student_id = p_target_student_id and ended_at is null;
  if found then
    update public.study_sessions
       set ended_at = now(), status = 'closed', pulse_due_at = null, pulse_paused = false
     where id = v_open.id;
  end if;

  delete from public.study_session_segments where classroom_id = p_classroom_id and student_id = p_target_student_id;
  delete from public.study_sessions        where classroom_id = p_classroom_id and student_id = p_target_student_id;
  delete from public.session_pulses        where classroom_id = p_classroom_id and student_id = p_target_student_id;
  delete from public.leaderboard_scores    where student_id = p_target_student_id
    and period_id in (select id from public.leaderboard_periods where classroom_id = p_classroom_id);
  delete from public.push_subscriptions    where student_id = p_target_student_id;
  delete from public.notification_preferences where student_id = p_target_student_id;

  update public.classroom_members
     set membership_status = 'left',
         left_at = now(),
         display_name = 'Removed student'
   where classroom_id = p_classroom_id and student_id = p_target_student_id and membership_status = 'active';

  return jsonb_build_object('removed', found);
end $$;

grant execute on function public.avhi_prune_student(uuid, uuid, text) to authenticated;
