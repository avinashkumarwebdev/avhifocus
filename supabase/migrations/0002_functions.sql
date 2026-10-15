-- ═══════════════════════════════════════════════════════════════════════════
-- AVHIFocus · Migration 0002 — privileged operations.
-- All sensitive writes run here, SECURITY DEFINER, with explicit caller
-- validation. The browser receives SELECT-only access (RLS in 0003) plus
-- execute on these functions. Direct table writes are revoked.
-- ═══════════════════════════════════════════════════════════════════════════

-- trusted server clock for client offset sync
create or replace function public.server_now()
returns timestamptz language sql stable as $$ select now(); $$;

-- membership check used by RLS policies and functions alike
create or replace function public.avhi_is_member(p_classroom_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.classroom_members
    where classroom_id = p_classroom_id
      and student_id = auth.uid()
      and membership_status = 'active'
  );
$$;

-- ── eligible focus intervals (the exact rule the leaderboard enforces) ──────
create or replace function public.avhi_focus_segments(
  p_start timestamptz,
  p_end timestamptz,
  p_anchor timestamptz,
  p_focus_seconds int,
  p_break_seconds int
) returns table (seg_start timestamptz, seg_end timestamptz)
language plpgsql immutable as $$
declare
  v_cycle int := p_focus_seconds + p_break_seconds;
  v_k bigint;
  v_fs timestamptz;
  v_fe timestamptz;
begin
  if p_end <= p_start then return; end if;
  v_k := floor(extract(epoch from (p_start - p_anchor)) / v_cycle) - 1;
  loop
    v_fs := p_anchor + make_interval(secs => (v_k * v_cycle)::double precision);
    v_fe := v_fs + make_interval(secs => p_focus_seconds);
    exit when v_fs >= p_end;
    if v_fe > p_start then
      seg_start := greatest(v_fs, p_start);
      seg_end := least(v_fe, p_end);
      return next;
    end if;
    v_k := v_k + 1;
  end loop;
end $$;

-- ── internal: member payload ────────────────────────────────────────────────
create or replace function public.avhi_member_json(m public.classroom_members, p_open_session_started_at timestamptz)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', m.id,
    'student_id', m.student_id,
    'display_name', m.display_name,
    'class_label', m.class_label,
    'avatar', m.avatar,
    'seat_number', m.seat_number,
    'is_bot', m.is_bot,
    'joined_at', m.joined_at,
    'last_seen_at', m.last_seen_at,
    'open_session_started_at', p_open_session_started_at
  );
$$;

-- ── internal: close a session, write per-period focus segments ─────────────
create or replace function public.avhi_close_session(
  p_room public.classrooms,
  p_session public.study_sessions,
  p_end timestamptz
) returns public.study_sessions
language plpgsql security definer set search_path = public as $$
declare
  v_end timestamptz;
  v_seg record;
  v_cursor timestamptz;
  v_piece_end timestamptz;
  v_period int;
  v_eligible int;
  v_updated public.study_sessions;
begin
  -- disconnect policy: abandoned sessions are capped at 6 hours
  v_end := least(p_end, p_session.started_at + interval '6 hours');

  select coalesce(extract(epoch from sum(seg_end - seg_start)), 0)::int into v_eligible
  from public.avhi_focus_segments(
    p_session.started_at, v_end, p_room.cycle_anchor_at, p_room.focus_duration_seconds, p_room.break_duration_seconds
  ) as t(seg_start, seg_end);

  update public.study_sessions s
     set ended_at = v_end,
         status = 'closed',
         eligible_focus_seconds = v_eligible
   where s.id = p_session.id and s.ended_at is null
  returning * into v_updated;

  if not found then
    return p_session; -- already closed: idempotent no-op
  end if;

  -- pre-split segments at 48h leaderboard period boundaries (anchor = created_at)
  for v_seg in
    select * from public.avhi_focus_segments(
      p_session.started_at, v_end, p_room.cycle_anchor_at, p_room.focus_duration_seconds, p_room.break_duration_seconds
    )
  loop
    v_cursor := v_seg.seg_start;
    while v_cursor < v_seg.seg_end loop
      v_period := greatest(0, floor(extract(epoch from (v_cursor - p_room.created_at)) / 172800));
      v_piece_end := least(v_seg.seg_end, p_room.created_at + ((v_period + 1) * interval '48 hours'));
      insert into public.study_session_segments
        (session_id, classroom_id, student_id, period_index, segment_type, started_at, ended_at)
      values
        (p_session.id, p_room.id, p_session.student_id, v_period, 'focus', v_cursor, v_piece_end);
      v_cursor := v_piece_end;
    end loop;
  end loop;

  return v_updated;
end $$;

-- ── internal: sweep expired sessions in a room ──────────────────────────────
create or replace function public.avhi_sweep_room(p_classroom_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_room public.classrooms;
  v_open record;
begin
  select * into v_room from public.classrooms where id = p_classroom_id;
  if not found then return; end if;
  for v_open in
    select * from public.study_sessions
    where classroom_id = p_classroom_id
      and ended_at is null
      and started_at < now() - interval '6 hours'
  loop
    perform public.avhi_close_session(v_room, v_open, now());
  end loop;
end $$;

-- ── create classroom (code generation, own row only) ────────────────────────
create or replace function public.avhi_create_classroom(p_name text)
returns public.classrooms
language plpgsql security definer set search_path = public as $$
declare
  v_room public.classrooms;
  v_code text;
  v_attempts int := 0;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  p_name := btrim(p_name);
  if char_length(p_name) < 2 or char_length(p_name) > 40 then
    raise exception 'VALIDATION: classroom name must be 2–40 characters';
  end if;
  loop
    select string_agg(substr('23456789ABCDEFGHJKMNPQRSTUVWXYZ', 1 + floor(random() * 31)::int, 1), '')
      into v_code
      from generate_series(1, 6);
    begin
      insert into public.classrooms (name, join_code)
      values (p_name, v_code)
      returning * into v_room;
      exit;
    exception when unique_violation then
      v_attempts := v_attempts + 1;
      if v_attempts > 20 then raise; end if;
    end;
  end loop;
  return v_room;
end $$;

-- ── join classroom (ATOMIC seat assignment + capacity, race-proof) ─────────
create or replace function public.avhi_join_classroom(
  p_code text,
  p_display_name text,
  p_class_label text,
  p_avatar jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_room public.classrooms;
  v_member public.classroom_members;
  v_count int;
  v_seat int;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  p_display_name := btrim(p_display_name);
  p_class_label := btrim(p_class_label);
  if char_length(p_display_name) < 1 or char_length(p_display_name) > 24 then
    raise exception 'VALIDATION: display name must be 1–24 characters';
  end if;
  if char_length(p_class_label) < 1 or char_length(p_class_label) > 16 then
    raise exception 'VALIDATION: class must be 1–16 characters';
  end if;

  select * into v_room
    from public.classrooms
   where join_code = upper(btrim(p_code));
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if not v_room.is_active then raise exception 'ROOM_INACTIVE'; end if;

  -- serialise concurrent joins for this classroom for the whole transaction
  perform pg_advisory_xact_lock(hashtext(v_room.id::text));

  -- idempotent re-join: same student keeps the same seat
  select * into v_member
    from public.classroom_members
   where classroom_id = v_room.id and student_id = auth.uid() and membership_status = 'active';
  if found then
    update public.classroom_members
       set display_name = p_display_name,
           class_label = p_class_label,
           avatar = coalesce(nullif(p_avatar, '{}'::jsonb), avatar),
           last_seen_at = now()
     where id = v_member.id
    returning * into v_member;
    return jsonb_build_object('classroom', to_jsonb(v_room), 'member', public.avhi_member_json(v_member, null));
  end if;

  -- capacity enforced HERE, under the lock — the 11th join cannot slip through
  select count(*) into v_count
    from public.classroom_members
   where classroom_id = v_room.id and membership_status = 'active';
  if v_count >= v_room.capacity then
    raise exception 'ROOM_FULL';
  end if;

  -- lowest free seat wins
  select min(s.n) into v_seat
    from generate_series(1, 10) as s(n)
   where not exists (
     select 1 from public.classroom_members m
      where m.classroom_id = v_room.id and m.membership_status = 'active' and m.seat_number = s.n
   );

  -- returning student reuses their old row (history preserved)
  update public.classroom_members
     set membership_status = 'active',
         seat_number = v_seat,
         display_name = p_display_name,
         class_label = p_class_label,
         avatar = coalesce(nullif(p_avatar, '{}'::jsonb), avatar),
         is_bot = false,
         joined_at = now(),
         last_seen_at = now(),
         left_at = null
   where classroom_id = v_room.id and student_id = auth.uid() and membership_status = 'left'
  returning * into v_member;

  if not found then
    insert into public.classroom_members
      (classroom_id, student_id, display_name, class_label, avatar, seat_number)
    values
      (v_room.id, auth.uid(), p_display_name, p_class_label, coalesce(p_avatar, '{}'::jsonb), v_seat)
    returning * into v_member;
  end if;

  return jsonb_build_object('classroom', to_jsonb(v_room), 'member', public.avhi_member_json(v_member, null));
end $$;

-- ── leave classroom (session closes + scores, seat frees, clock untouched) ──
create or replace function public.avhi_leave_classroom(p_classroom_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_room public.classrooms;
  v_member public.classroom_members;
  v_open public.study_sessions;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  select * into v_room from public.classrooms where id = p_classroom_id;
  if not found or not v_room.is_active then raise exception 'ROOM_NOT_FOUND'; end if;
  select * into v_member
    from public.classroom_members
   where classroom_id = v_room.id and student_id = auth.uid() and membership_status = 'active';
  if not found then raise exception 'NOT_A_MEMBER'; end if;

  select * into v_open
    from public.study_sessions
   where classroom_id = v_room.id and student_id = auth.uid() and ended_at is null;
  if found then
    perform public.avhi_close_session(v_room, v_open, now());
  end if;

  update public.classroom_members
     set membership_status = 'left', left_at = now()
   where id = v_member.id;
end $$;

-- ── start studying (idempotent; one open session per student) ───────────────
create or replace function public.avhi_start_study(p_classroom_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_member public.classroom_members;
  v_open public.study_sessions;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  perform public.avhi_sweep_room(p_classroom_id);
  select * into v_member
    from public.classroom_members
   where classroom_id = p_classroom_id and student_id = auth.uid() and membership_status = 'active';
  if not found then raise exception 'NOT_A_MEMBER'; end if;

  select * into v_open
    from public.study_sessions
   where student_id = auth.uid() and ended_at is null; -- unique index guarantees ≤ 1
  if found then
    update public.classroom_members set last_seen_at = now() where id = v_member.id;
    return public.avhi_member_json(v_member, v_open.started_at);
  end if;

  insert into public.study_sessions (classroom_id, student_id)
  values (p_classroom_id, auth.uid())
  returning * into v_open;

  update public.classroom_members set last_seen_at = now() where id = v_member.id;
  return public.avhi_member_json(v_member, v_open.started_at);
end $$;

-- ── stop studying (idempotent; scores only focus-phase server time) ─────────
create or replace function public.avhi_stop_study(p_classroom_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_member public.classroom_members;
  v_room public.classrooms;
  v_open public.study_sessions;
  v_closed public.study_sessions;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  select * into v_member
    from public.classroom_members
   where classroom_id = p_classroom_id and student_id = auth.uid() and membership_status = 'active';
  if not found then raise exception 'NOT_A_MEMBER'; end if;

  select * into v_open
    from public.study_sessions
   where student_id = auth.uid() and ended_at is null;
  if not found then
    return null; -- nothing to stop — idempotent
  end if;

  select * into v_room from public.classrooms where id = v_open.classroom_id;
  v_closed := public.avhi_close_session(v_room, v_open, now());
  update public.classroom_members set last_seen_at = now() where id = v_member.id;
  return to_jsonb(v_closed);
end $$;

-- ── room snapshot (members + open-session starts in one round trip) ─────────
create or replace function public.avhi_room_state(p_classroom_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_room public.classrooms;
  v_members jsonb;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  if not public.avhi_is_member(p_classroom_id) then raise exception 'NOT_A_MEMBER'; end if;
  perform public.avhi_sweep_room(p_classroom_id);
  select * into v_room from public.classrooms where id = p_classroom_id;
  if not found or not v_room.is_active then raise exception 'ROOM_NOT_FOUND'; end if;

  update public.classroom_members
     set last_seen_at = now()
   where classroom_id = p_classroom_id and student_id = auth.uid() and membership_status = 'active';

  select coalesce(jsonb_agg(public.avhi_member_json(m, s.started_at) order by m.seat_number), '[]'::jsonb)
    into v_members
    from public.classroom_members m
    left join public.study_sessions s
      on s.classroom_id = m.classroom_id and s.student_id = m.student_id and s.ended_at is null
   where m.classroom_id = p_classroom_id and m.membership_status = 'active';

  return jsonb_build_object('classroom', to_jsonb(v_room), 'members', v_members);
end $$;

-- ── presence heartbeat (updates ONLY the caller's own row) ─────────────────
create or replace function public.avhi_heartbeat(p_classroom_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  update public.classroom_members
     set last_seen_at = now()
   where classroom_id = p_classroom_id and student_id = auth.uid() and membership_status = 'active';
end $$;

-- ── profile update (own membership only) ────────────────────────────────────
create or replace function public.avhi_update_profile(
  p_classroom_id uuid,
  p_display_name text,
  p_class_label text,
  p_avatar jsonb default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  p_display_name := btrim(p_display_name);
  p_class_label := btrim(p_class_label);
  if char_length(p_display_name) < 1 or char_length(p_display_name) > 24 then
    raise exception 'VALIDATION: display name must be 1–24 characters';
  end if;
  if char_length(p_class_label) < 1 or char_length(p_class_label) > 16 then
    raise exception 'VALIDATION: class must be 1–16 characters';
  end if;
  update public.classroom_members
     set display_name = p_display_name,
         class_label = p_class_label,
         avatar = coalesce(p_avatar, avatar),
         last_seen_at = now()
   where classroom_id = p_classroom_id and student_id = auth.uid() and membership_status = 'active';
  if not found then raise exception 'NOT_A_MEMBER'; end if;
end $$;

-- ── leaderboard (derived from validated segments; ties share a rank) ────────
create or replace function public.avhi_leaderboard(p_classroom_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_room public.classrooms;
  v_period_index int;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_rows jsonb;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  if not public.avhi_is_member(p_classroom_id) then raise exception 'NOT_A_MEMBER'; end if;
  perform public.avhi_sweep_room(p_classroom_id);
  select * into v_room from public.classrooms where id = p_classroom_id;

  v_period_index := greatest(0, floor(extract(epoch from (now() - v_room.created_at)) / 172800));
  v_period_start := v_room.created_at + (v_period_index * interval '48 hours');
  v_period_end := v_period_start + interval '48 hours';

  with totals as (
    select s.student_id, sum(extract(epoch from (s.ended_at - s.started_at)))::bigint as seconds
      from public.study_session_segments s
     where s.classroom_id = p_classroom_id
       and s.period_index = v_period_index
       and s.segment_type = 'focus'
     group by s.student_id
  ),
  base as (
    select m.student_id, m.display_name, m.class_label, m.avatar,
           coalesce(t.seconds, 0)::bigint as seconds
      from public.classroom_members m
      left join totals t on t.student_id = m.student_id
     where m.classroom_id = p_classroom_id and m.membership_status = 'active'
  ),
  ranked as (
    select student_id, display_name, class_label, avatar, seconds,
           rank() over (order by seconds desc) as rank
      from base
  )
  select coalesce(jsonb_agg(r order by r.rank, r.display_name), '[]'::jsonb)
    into v_rows
    from ranked r;

  return jsonb_build_object(
    'period_index', v_period_index,
    'period_start_at', v_period_start,
    'period_end_at', v_period_end,
    'rows', v_rows
  );
end $$;

-- ── optional scheduled cleanup (call from pg_cron or an edge cron) ─────────
create or replace function public.avhi_close_stale_sessions()
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_session public.study_sessions;
  v_room public.classrooms;
  v_count int := 0;
begin
  for v_session in
    select * from public.study_sessions
    where ended_at is null and started_at < now() - interval '6 hours'
  loop
    select * into v_room from public.classrooms where id = v_session.classroom_id;
    if found then
      perform public.avhi_close_session(v_room, v_session, now());
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end $$;

-- ── privileges ───────────────────────────────────────────────────────────────
-- internal helpers: never callable from the API surface
revoke execute on function public.avhi_member_json(public.classroom_members, timestamptz) from public, anon, authenticated;
revoke execute on function public.avhi_close_session(public.classrooms, public.study_sessions, timestamptz) from public, anon, authenticated;
revoke execute on function public.avhi_focus_segments(timestamptz, timestamptz, timestamptz, int, int) from public, anon, authenticated;
revoke execute on function public.avhi_close_stale_sessions() from public, anon, authenticated;

-- legit client operations: signed-in (even anonymously) users only
grant execute on function public.server_now() to authenticated;
grant execute on function public.avhi_is_member(uuid) to authenticated;
grant execute on function public.avhi_sweep_room(uuid) to authenticated;
grant execute on function public.avhi_create_classroom(text) to authenticated;
grant execute on function public.avhi_join_classroom(text, text, text, jsonb) to authenticated;
grant execute on function public.avhi_leave_classroom(uuid) to authenticated;
grant execute on function public.avhi_start_study(uuid) to authenticated;
grant execute on function public.avhi_stop_study(uuid) to authenticated;
grant execute on function public.avhi_room_state(uuid) to authenticated;
grant execute on function public.avhi_heartbeat(uuid) to authenticated;
grant execute on function public.avhi_update_profile(uuid, text, text, jsonb) to authenticated;
grant execute on function public.avhi_leaderboard(uuid) to authenticated;
