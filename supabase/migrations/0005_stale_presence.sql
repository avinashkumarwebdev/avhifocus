-- ═══════════════════════════════════════════════════════════════════════════
-- AVHIFocus · Migration 0005 — offline presence caps (every room, every mode)
--
-- Reported behavior this fixes: a student who loses connection used to keep
-- "focusing" (and accruing) for hours. Heartbeats run every ~20s while a
-- client is present, so the server can treat absence deterministically:
--
--   last heartbeat +90s   → accrual credit ends at that point
--   +5 min                → session FREEZES (banked up to the +90s point,
--                           student resumes with a tap when back)
--   +15 min               → session CLOSED (banked up to the +90s point)
--
-- Refresh/page-switching is fully covered by the 90s grace: heartbeats resume
-- within seconds when the client returns.
-- ═══════════════════════════════════════════════════════════════════════════

drop function if exists public.avhi_sweep_room(uuid);

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
    -- integrity pulses (balanced/strict)
    elsif v_s.pulse_paused then
      continue;
    elsif v_s.pulse_due_at is not null and now() > v_s.pulse_due_at + interval '2 minutes' then
      perform public.avhi_halt_session(v_room, v_s, v_s.pulse_due_at + interval '2 minutes');
    elsif v_s.cap_until is not null and now() > v_s.cap_until then
      perform public.avhi_halt_session(v_room, v_s, v_s.cap_until);
    end if;
  end loop;
end $$;

revoke execute on function public.avhi_sweep_room(uuid) from public, anon;
grant execute on function public.avhi_sweep_room(uuid) to authenticated;
