-- ═══════════════════════════════════════════════════════════════════════════
-- AVHIFocus · 0008 — close-guard: never write ended_at before started_at
--
-- Bug: a session that crosses its 6-hour ORIGIN window (halted → resumed past
-- the cap) could be closed with ended_at = orig_started_at + 6h < started_at,
-- violating study_sessions_check. The failing UPDATE rolled back, leaving an
-- unclosable open session that then broke every later RPC in that room.
--
-- This migration (a) hardens avhi_close_session, (b) closes any sessions
-- already stuck in that state, and (c) restores the full 0005 sweep
-- (bot exemption + cap_until enforcement) with the 3-minute pulse window.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.avhi_close_session(
  p_room public.classrooms,
  p_session public.study_sessions,
  p_end timestamptz
) returns public.study_sessions
language plpgsql security definer set search_path = public as $$
declare
  v_end timestamptz;
  v_total int;
  v_updated public.study_sessions;
begin
  -- end can never precede the start of the CURRENT accrual window
  v_end := greatest(least(p_end, p_session.orig_started_at + interval '6 hours'), p_session.started_at);

  if p_session.pulse_paused then
    v_total := coalesce(p_session.eligible_focus_seconds, 0); -- already banked at halt
  else
    v_total := coalesce(p_session.eligible_focus_seconds, 0)
      + public.avhi_bank_window(p_room, p_session.id, p_session.student_id, p_session.started_at, v_end);
  end if;

  update public.study_sessions
     set ended_at = v_end,
         status = 'closed',
         eligible_focus_seconds = v_total,
         pulse_due_at = null,
         pulse_paused = false
   where id = p_session.id and ended_at is null
  returning * into v_updated;

  if not found then return p_session; end if; -- idempotent
  return v_updated;
end $$;

-- heal rows already wedged past their 6-hour origin window: close them at the
-- start of their current window (their beyond-cap time could never count)
update public.study_sessions
   set ended_at = started_at,
       status = 'closed',
       pulse_due_at = null,
       pulse_paused = false
 where ended_at is null
   and started_at >= orig_started_at + interval '6 hours';

-- full 0005 sweep (verbatim) with the 3-minute pulse answer window
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
