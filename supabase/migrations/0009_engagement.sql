-- ═══════════════════════════════════════════════════════════════════════════
-- AVHIFocus · 0009 — engagement layer: daily goal, streaks, week stats,
--                    subject of the day
--
-- No placeholders in this file — safe to paste-and-run as-is.
-- Day boundaries use Asia/Kolkata (the product's classroom audience).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── subject of the day (written on the classroom blackboard) ───────────────
alter table public.classrooms add column if not exists subject text;

create or replace function public.avhi_set_subject(p_classroom_id uuid, p_subject text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  if not public.avhi_is_member(p_classroom_id) then raise exception 'NOT_A_MEMBER'; end if;
  p_subject := btrim(coalesce(p_subject, ''));
  if char_length(p_subject) > 40 then raise exception 'VALIDATION: subject must be ≤ 40 characters'; end if;
  update public.classrooms
     set subject = nullif(p_subject, '')
   where id = p_classroom_id;
end $$;

grant execute on function public.avhi_set_subject(uuid, text) to authenticated;

-- ── per-student settings (server-side daily goal) ──────────────────────────
create table if not exists public.student_settings (
  student_id         uuid primary key,
  daily_goal_minutes integer not null default 120 check (daily_goal_minutes between 15 and 720),
  updated_at         timestamptz not null default now()
);
alter table public.student_settings enable row level security; -- definer-only

create or replace function public.avhi_set_daily_goal(p_minutes integer)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  if p_minutes is null or p_minutes < 15 or p_minutes > 720 then
    raise exception 'VALIDATION: daily goal must be 15–720 minutes';
  end if;
  insert into public.student_settings (student_id, daily_goal_minutes)
  values (auth.uid(), p_minutes)
  on conflict (student_id) do update
     set daily_goal_minutes = excluded.daily_goal_minutes,
         updated_at = now();
end $$;

grant execute on function public.avhi_set_daily_goal(integer) to authenticated;

-- ── day helpers (Asia/Kolkata wall-clock days) ─────────────────────────────
create or replace function public.avhi_day_start_ist(p_day date)
returns timestamptz
language sql immutable as $$
  select (p_day::text || ' 00:00:00+05:30')::timestamptz
$$;

-- focus seconds overlapping one IST day, across ALL classrooms (all time)
create or replace function public.avhi_day_seconds(p_student uuid, p_day date)
returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(sum(
    greatest(0::numeric, extract(epoch from (
      least(s.ended_at, public.avhi_day_start_ist(p_day + 1))
      - greatest(s.started_at, public.avhi_day_start_ist(p_day))
    )))
  ), 0)::bigint
    from public.study_session_segments s
   where s.student_id = p_student
     and s.segment_type = 'focus'
     and s.ended_at > public.avhi_day_start_ist(p_day)
     and s.started_at < public.avhi_day_start_ist(p_day + 1)
$$;

-- streak: consecutive 15+ min days; today counts once it reaches 15 min,
-- otherwise the streak continues from yesterday until midnight
create or replace function public.avhi_streak_days(p_student uuid)
returns integer
language plpgsql stable security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_day date := v_today - 1;
  v_streak int := 0;
begin
  if public.avhi_day_seconds(p_student, v_today) >= 900 then
    v_streak := 1;
  end if;
  for i in 1..730 loop
    exit when public.avhi_day_seconds(p_student, v_day) < 900;
    v_streak := v_streak + 1;
    v_day := v_day - 1;
  end loop;
  return v_streak;
end $$;

create or replace function public.avhi_today_seconds(p_student uuid)
returns bigint
language sql stable security definer set search_path = public as $$
  select public.avhi_day_seconds(p_student, (now() at time zone 'Asia/Kolkata')::date)
$$;

-- ── my stats bundle (goal progress + streak + week + lifetime) ─────────────
create or replace function public.avhi_my_study_stats()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_week_start date := v_today - ((extract(isodow from v_today)::int) - 1); -- Monday
  v_goal int;
  v_week bigint;
  v_lifetime bigint;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;

  select coalesce((select daily_goal_minutes from public.student_settings
                    where student_id = auth.uid()), 120) into v_goal;

  select coalesce(sum(greatest(0::numeric, extract(epoch from (
      least(s.ended_at, now()) - greatest(s.started_at, public.avhi_day_start_ist(v_week_start)))))), 0)::bigint
    into v_week
    from public.study_session_segments s
   where s.student_id = auth.uid() and s.segment_type = 'focus'
     and s.ended_at > public.avhi_day_start_ist(v_week_start) and s.started_at < now();

  select coalesce(sum(extract(epoch from (s.ended_at - s.started_at))), 0)::bigint
    into v_lifetime
    from public.study_session_segments s
   where s.student_id = auth.uid() and s.segment_type = 'focus';

  return jsonb_build_object(
    'goal_minutes', v_goal,
    'today_seconds', public.avhi_today_seconds(auth.uid()),
    'streak_days', public.avhi_streak_days(auth.uid()),
    'week_seconds', v_week,
    'lifetime_seconds', v_lifetime
  );
end $$;

grant execute on function public.avhi_my_study_stats() to authenticated;

-- ── week stats per classroom member (for rank + recap) ─────────────────────
create or replace function public.avhi_week_stats(p_classroom_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_week_start date := v_today - ((extract(isodow from v_today)::int) - 1);
  v_rows jsonb;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  if not public.avhi_is_member(p_classroom_id) then raise exception 'NOT_A_MEMBER'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
             'student_id', m.student_id,
             'display_name', m.display_name,
             'seconds', coalesce(w.secs, 0)
           ) order by coalesce(w.secs, 0) desc, m.display_name), '[]'::jsonb)
    into v_rows
    from public.classroom_members m
    left join lateral (
      select sum(greatest(0::numeric, extract(epoch from (
        least(s.ended_at, now()) - greatest(s.started_at, public.avhi_day_start_ist(v_week_start)))))) as secs
        from public.study_session_segments s
       where s.classroom_id = p_classroom_id
         and s.student_id = m.student_id
         and s.segment_type = 'focus'
         and s.ended_at > public.avhi_day_start_ist(v_week_start) and s.started_at < now()
    ) w on true
   where m.classroom_id = p_classroom_id and m.membership_status = 'active' and not m.is_bot;

  return v_rows;
end $$;

grant execute on function public.avhi_week_stats(uuid) to authenticated;

-- ── member payload: streak + today's focus shown on every bench ────────────
drop function if exists public.avhi_member_json(public.classroom_members, public.study_sessions);
create or replace function public.avhi_member_json(m public.classroom_members, s public.study_sessions)
returns jsonb language sql stable security definer set search_path = public as $$
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
    'open_session_started_at', case when s.id is null then null else s.orig_started_at end,
    'pulse_paused', coalesce(s.pulse_paused, false),
    'pulse_due_at', case when s.id is not null and m.student_id = auth.uid() then s.pulse_due_at else null end,
    'streak_days', public.avhi_streak_days(m.student_id),
    'today_focus_seconds', public.avhi_today_seconds(m.student_id)
  );
$$;

-- ── hall peek: surface the subject on room cards ───────────────────────────
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
    'subject', v_room.subject,
    'members', v_members,
    'studying', v_studying,
    'cycle_anchor_at', v_room.cycle_anchor_at,
    'focus_duration_seconds', v_room.focus_duration_seconds,
    'break_duration_seconds', v_room.break_duration_seconds
  );
end $$;

grant execute on function public.avhi_hall_peek(text) to authenticated;
