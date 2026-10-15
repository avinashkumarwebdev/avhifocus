-- ═══════════════════════════════════════════════════════════════════════════
-- AVHIFocus · Migration 0006 — one shared classroom ("the Hall") + calm peek
--
-- Product change: classroom creation is gone. Everyone enters the same shared
-- Hall. Before taking a bench, students peek through the door: 0 benches taken
-- means the room is dormant (all features stopped); they may still edit their
-- profile and can take a bench at any time — which wakes features up.
--
-- Default difficulty is Moderate (= 'balanced' integrity): pulse-verified
-- minutes with random "still studying?" checks.
-- ═══════════════════════════════════════════════════════════════════════════

-- default difficulty for any classroom is Moderate
alter table public.classrooms alter column integrity_mode set default 'balanced';

-- the one shared classroom. join codes never use I/L/O/0/1.
insert into public.classrooms (name, join_code, integrity_mode)
values ('AVHIFocus Hall', 'STUDY9', 'balanced')
on conflict (join_code) do update set integrity_mode = excluded.integrity_mode;

-- ── hallway peek: what a non-member may know before taking a bench ─────────
create or replace function public.avhi_hall_peek(p_code text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_room public.classrooms;
  v_members int;
  v_studying int;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;

  select * into v_room
    from public.classrooms
   where join_code = upper(btrim(p_code))
     and is_active;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;

  -- settle ghosts before counting (closes stale sessions, freezes capped ones)
  perform public.avhi_sweep_room(v_room.id);

  select count(*) into v_members
    from public.classroom_members
   where classroom_id = v_room.id and membership_status = 'active';

  select count(distinct student_id) into v_studying
    from public.study_sessions
   where classroom_id = v_room.id and ended_at is null;

  return jsonb_build_object(
    'id', v_room.id,
    'name', v_room.name,
    'join_code', v_room.join_code,
    'capacity', v_room.capacity,
    'integrity_mode', v_room.integrity_mode,
    'members', v_members,
    'studying', v_studying,
    'cycle_anchor_at', v_room.cycle_anchor_at,
    'focus_duration_seconds', v_room.focus_duration_seconds,
    'break_duration_seconds', v_room.break_duration_seconds
  );
end $$;

revoke execute on function public.avhi_hall_peek(text) from public, anon;
grant execute on function public.avhi_hall_peek(text) to authenticated;
