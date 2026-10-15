-- ═══════════════════════════════════════════════════════════════════════════
-- AVHIFocus · FRESH-START SETUP (run ONCE in SQL Editor)
--
-- This project already contains leftovers from a previous attempt. This file
-- first REMOVES anything named avhi_* / AVHIFocus tables, then installs the
-- complete final schema. Safe to run on a messy project — but it ERASES any
-- existing AVHIFocus rows inside THIS project only (other projects untouched).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1 · drop every AVHIFocus function (any version, any signature) ──────────
do $$
declare r record;
begin
  for r in
    select p.proname, pg_catalog.oidvectortypes(p.proargtypes) as args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and (p.proname like 'avhi\_%' escape '\' or p.proname = 'server_now')
  loop
    execute format('drop function public.%I(%s) cascade', r.proname, r.args);
  end loop;
end $$;

-- ── 2 · drop AVHIFocus tables (children first) ──────────────────────────────
drop table if exists public.session_pulses cascade;
drop table if exists public.study_session_segments cascade;
drop table if exists public.study_sessions cascade;
drop table if exists public.classroom_members cascade;
drop table if exists public.classrooms cascade;
drop table if exists public.leaderboard_periods cascade;
drop table if exists public.leaderboard_scores cascade;
drop table if exists public.push_subscriptions cascade;
drop table if exists public.notification_preferences cascade;

-- ── 3 · install the complete final schema ────────────────────────────────────
-- ════════════════════════════════════════════════════════════════════
-- AVHIFocus · COMPLETE DATABASE SETUP (one-shot paste for SQL Editor) --
-- Run this file ONCE in: Dashboard → SQL Editor → New query → Run     --
-- Run ONCE (combines migrations 0001 → 0004). If it succeeds, do NOT     --
-- re-run it — re-running an applied schema raises harmless errors.        --
-- ════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- AVHIFocus · Migration 0001 — schema
-- Every table here is protected by RLS (0003). Privileged operations happen
-- only through SECURITY DEFINER functions (0002) that validate the caller.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto; -- gen_random_uuid

-- ── classrooms ──────────────────────────────────────────────────────────────
create table public.classrooms (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null check (char_length(name) between 2 and 40),
  join_code              text not null unique check (join_code ~ '^[2-9A-HJKMNP-Z]{6}$'),
  capacity               smallint not null default 10 check (capacity between 1 and 10),
  -- The shared clock: derived, never decremented, never reset by clients.
  cycle_anchor_at        timestamptz not null default now(),
  focus_duration_seconds integer not null default 3000 check (focus_duration_seconds > 0),
  break_duration_seconds integer not null default 600  check (break_duration_seconds > 0),
  is_active              boolean not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- ── classroom_members ───────────────────────────────────────────────────────
create table public.classroom_members (
  id                uuid primary key default gen_random_uuid(),
  classroom_id      uuid not null references public.classrooms(id) on delete cascade,
  student_id        uuid not null, -- auth.users.id (anonymous sign-in)
  display_name      text not null check (char_length(display_name) between 1 and 24),
  class_label       text not null check (char_length(class_label) between 1 and 16),
  avatar            jsonb not null default '{}'::jsonb,
  seat_number       smallint not null check (seat_number between 1 and 10),
  membership_status text not null default 'active' check (membership_status in ('active','left')),
  is_bot            boolean not null default false,
  joined_at         timestamptz not null default now(),
  last_seen_at      timestamptz not null default now(),
  left_at           timestamptz
);
-- one active membership per student per classroom
create unique index classroom_members_one_active
  on public.classroom_members (classroom_id, student_id) where membership_status = 'active';
-- one student per seat at a time (stable assignment; freed seats are reusable)
create unique index classroom_members_one_seat
  on public.classroom_members (classroom_id, seat_number) where membership_status = 'active';
create index classroom_members_room on public.classroom_members (classroom_id) where membership_status = 'active';

-- ── study_sessions ──────────────────────────────────────────────────────────
create table public.study_sessions (
  id                     uuid primary key default gen_random_uuid(),
  classroom_id           uuid not null references public.classrooms(id) on delete cascade,
  student_id             uuid not null,
  started_at             timestamptz not null default now(),
  ended_at               timestamptz,
  status                 text not null default 'studying' check (status in ('studying','closed')),
  eligible_focus_seconds integer check (eligible_focus_seconds is null or eligible_focus_seconds >= 0),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at)
);
-- at most one open session per student (global; idempotent start flow)
create unique index study_sessions_one_open on public.study_sessions (student_id) where ended_at is null;
create index study_sessions_room on public.study_sessions (classroom_id);

-- ── study_session_segments ──────────────────────────────────────────────────
-- Focus-phase slices of closed sessions, pre-split at 48h period boundaries.
-- Leaderboards aggregate these — never client-submitted durations.
create table public.study_session_segments (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references public.study_sessions(id) on delete cascade,
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  student_id   uuid not null,
  period_index integer not null check (period_index >= 0),
  segment_type text not null default 'focus' check (segment_type in ('focus','break','pause')),
  started_at   timestamptz not null,
  ended_at     timestamptz not null,
  check (ended_at > started_at)
);
create index segments_scoring on public.study_session_segments (classroom_id, period_index) where segment_type = 'focus';

-- ── leaderboard_periods ─────────────────────────────────────────────────────
-- Materialised per-classroom period windows (created lazily for history/views;
-- current period is always derivable from classrooms.created_at).
create table public.leaderboard_periods (
  id              uuid primary key default gen_random_uuid(),
  classroom_id    uuid not null references public.classrooms(id) on delete cascade,
  period_index    integer not null check (period_index >= 0),
  period_start_at timestamptz not null,
  period_end_at   timestamptz not null,
  created_at      timestamptz not null default now(),
  unique (classroom_id, period_index)
);

-- ── leaderboard_scores ──────────────────────────────────────────────────────
-- Optional rollup cache for past periods. Written only by server-side code.
create table public.leaderboard_scores (
  id            uuid primary key default gen_random_uuid(),
  period_id     uuid not null references public.leaderboard_periods(id) on delete cascade,
  student_id    uuid not null,
  display_name  text not null,
  class_label   text not null,
  focus_seconds integer not null default 0 check (focus_seconds >= 0),
  updated_at    timestamptz not null default now(),
  unique (period_id, student_id)
);

-- ── push_subscriptions ──────────────────────────────────────────────────────
create table public.push_subscriptions (
  id                    uuid primary key default gen_random_uuid(),
  student_id            uuid not null,
  endpoint              text not null unique,
  public_key            text not null,
  auth_secret           text not null,
  notifications_enabled boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index push_subscriptions_student on public.push_subscriptions (student_id);

-- ── notification_preferences ────────────────────────────────────────────────
create table public.notification_preferences (
  student_id                    uuid primary key,
  focus_start_notifications     boolean not null default true,
  phase_transition_notifications boolean not null default true,
  quiet_hours_enabled           boolean not null default true,
  updated_at                    timestamptz not null default now()
);

-- ── updated_at triggers ─────────────────────────────────────────────────────
create or replace function public.avhi_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger t_classrooms_touch before update on public.classrooms
  for each row execute function public.avhi_touch_updated_at();
create trigger t_sessions_touch before update on public.study_sessions
  for each row execute function public.avhi_touch_updated_at();
create trigger t_scores_touch before update on public.leaderboard_scores
  for each row execute function public.avhi_touch_updated_at();

-- ── realtime publication (state changes only — never per-second ticks) ──────
alter publication supabase_realtime add table public.classroom_members;
alter publication supabase_realtime add table public.study_sessions;

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

-- ═══════════════════════════════════════════════════════════════════════════
-- AVHIFocus · Migration 0004 — integrity engine (anti-cheat).
--
-- Model: a session earns focus time only inside its CURRENT accrual window.
-- A missed presence pulse, a 2-hour cap, a self-pause, or an ignored nudge
-- HALTS the window: earned seconds are banked as segments and the window
-- collapses. Resume opens a new window — the gap can never count.
-- Daily accrual is clamped per UTC day; nudges are rate-limited server-side.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.classrooms
  add column if not exists integrity_mode text not null default 'relaxed'
    check (integrity_mode in ('relaxed','balanced','strict'));

alter table public.study_sessions
  add column if not exists orig_started_at timestamptz,
  add column if not exists pulse_due_at timestamptz,
  add column if not exists cap_until timestamptz,
  add column if not exists pulse_paused boolean not null default false;

update public.study_sessions set orig_started_at = started_at where orig_started_at is null;
alter table public.study_sessions alter column orig_started_at set not null;

-- pulse history (ack timeline + nudge rate limiting). Owner-readable only.
create table if not exists public.session_pulses (
  id                    uuid primary key default gen_random_uuid(),
  session_id            uuid not null references public.study_sessions(id) on delete cascade,
  classroom_id          uuid not null references public.classrooms(id) on delete cascade,
  student_id            uuid not null,             -- recipient of the pulse
  kind                  text not null default 'scheduled' check (kind in ('scheduled','nudge')),
  due_at                timestamptz not null,
  acked_at              timestamptz,
  created_by_student_id uuid,                      -- set for nudges only
  created_at            timestamptz not null default now()
);
create index if not exists pulses_session on public.session_pulses (session_id);
create index if not exists pulses_nudge_limit on public.session_pulses (classroom_id, kind, created_by_student_id, student_id, due_at);

alter table public.session_pulses enable row level security;
create policy pulses_owner_read on public.session_pulses
  for select to authenticated using (student_id = auth.uid());
grant select on public.session_pulses to authenticated;

-- helpers mirroring the TS constants
create or replace function public.avhi_pulse_interval()
returns interval language sql volatile as $$
  select (600 + floor(random() * 481)) * interval '1 second';
$$;

-- ── bank the current accrual window as segments; returns seconds banked ────
create or replace function public.avhi_bank_window(
  p_room public.classrooms,
  p_session_id uuid,
  p_student_id uuid,
  p_start timestamptz,
  p_end timestamptz
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_seg record;
  v_cursor timestamptz;
  v_piece_end timestamptz;
  v_period int;
  v_eligible int := 0;
begin
  if p_end <= p_start then return 0; end if;

  select coalesce(extract(epoch from sum(seg_end - seg_start)), 0)::int into v_eligible
  from public.avhi_focus_segments(p_start, p_end, p_room.cycle_anchor_at, p_room.focus_duration_seconds, p_room.break_duration_seconds)
    as t(seg_start, seg_end);

  for v_seg in
    select * from public.avhi_focus_segments(p_start, p_end, p_room.cycle_anchor_at, p_room.focus_duration_seconds, p_room.break_duration_seconds)
  loop
    v_cursor := v_seg.seg_start;
    while v_cursor < v_seg.seg_end loop
      v_period := greatest(0, floor(extract(epoch from (v_cursor - p_room.created_at)) / 172800));
      v_piece_end := least(v_seg.seg_end, p_room.created_at + ((v_period + 1) * interval '48 hours'));
      insert into public.study_session_segments
        (session_id, classroom_id, student_id, period_index, segment_type, started_at, ended_at)
      values
        (p_session_id, p_room.id, p_student_id, v_period, 'focus', v_cursor, v_piece_end);
      v_cursor := v_piece_end;
    end loop;
  end loop;

  return v_eligible;
end $$;

-- ── halt: freeze accrual, bank the current window, mark paused ─────────────
create or replace function public.avhi_halt_session(
  p_room public.classrooms,
  p_session public.study_sessions,
  p_cap timestamptz
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_cap timestamptz;
  v_banked int;
begin
  if p_session.ended_at is not null or p_session.pulse_paused then return; end if;
  v_cap := greatest(p_cap, p_session.started_at);
  v_banked := public.avhi_bank_window(p_room, p_session.id, p_session.student_id, p_session.started_at, v_cap);
  update public.study_sessions
     set eligible_focus_seconds = coalesce(eligible_focus_seconds, 0) + v_banked,
         started_at = v_cap,
         pulse_paused = true,
         pulse_due_at = null
   where id = p_session.id;
end $$;

-- ── close (stop/leave): bank remaining window, end session (REPLACES 0002) ─
drop function if exists public.avhi_close_session(public.classrooms, public.study_sessions, timestamptz);
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
  v_end := least(p_end, p_session.orig_started_at + interval '6 hours');

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

-- ── sweep: overdue pulses, session caps, abandoned sessions (REPLACES 0002) ─
drop function if exists public.avhi_sweep_room(uuid);
create or replace function public.avhi_sweep_room(p_classroom_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_room public.classrooms;
  v_s record;
begin
  select * into v_room from public.classrooms where id = p_classroom_id;
  if not found then return; end if;
  for v_s in
    select * from public.study_sessions
    where classroom_id = p_classroom_id and ended_at is null
  loop
    if now() - v_s.orig_started_at > interval '6 hours' then
      perform public.avhi_close_session(v_room, v_s, now());
    elsif v_s.pulse_paused then
      continue;
    elsif v_s.pulse_due_at is not null and now() > v_s.pulse_due_at + interval '2 minutes' then
      perform public.avhi_halt_session(v_room, v_s, v_s.pulse_due_at + interval '2 minutes');
    elsif v_s.cap_until is not null and now() > v_s.cap_until then
      perform public.avhi_halt_session(v_room, v_s, v_s.cap_until);
    end if;
  end loop;
end $$;

-- ── start studying: schedules integrity per room mode (REPLACES 0002) ──────
drop function if exists public.avhi_start_study(uuid);
create or replace function public.avhi_start_study(p_classroom_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_member public.classroom_members;
  v_room public.classrooms;
  v_open public.study_sessions;
  v_due timestamptz;
  v_cap timestamptz;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  perform public.avhi_sweep_room(p_classroom_id);
  select * into v_member
    from public.classroom_members
   where classroom_id = p_classroom_id and student_id = auth.uid() and membership_status = 'active';
  if not found then raise exception 'NOT_A_MEMBER'; end if;
  select * into v_room from public.classrooms where id = p_classroom_id;

  select * into v_open from public.study_sessions where student_id = auth.uid() and ended_at is null;
  if found then
    update public.classroom_members set last_seen_at = now() where id = v_member.id;
    return public.avhi_member_json(v_member, v_open);
  end if;

  if v_room.integrity_mode <> 'relaxed' then
    v_due := now() + public.avhi_pulse_interval();
    v_cap := now() + interval '2 hours';
  end if;

  insert into public.study_sessions
    (classroom_id, student_id, started_at, orig_started_at, pulse_due_at, cap_until)
  values
    (p_classroom_id, auth.uid(), now(), now(), v_due, v_cap)
  returning * into v_open;

  if v_due is not null then
    insert into public.session_pulses (session_id, classroom_id, student_id, kind, due_at)
    values (v_open.id, p_classroom_id, auth.uid(), 'scheduled', v_due);
  end if;

  update public.classroom_members set last_seen_at = now() where id = v_member.id;
  return public.avhi_member_json(v_member, v_open);
end $$;

-- ── acknowledge the pending pulse; schedule the next randomized one ────────
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
  if now() > v_s.pulse_due_at + interval '2 minutes' then
    perform public.avhi_halt_session(v_room, v_s, v_s.pulse_due_at + interval '2 minutes');
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

-- ── resume a paused session (new accrual window; the gap never counts) ─────
create or replace function public.avhi_resume_session(p_classroom_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_room public.classrooms;
  v_s public.study_sessions;
  v_due timestamptz;
  v_cap timestamptz;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  if not public.avhi_is_member(p_classroom_id) then raise exception 'NOT_A_MEMBER'; end if;
  perform public.avhi_sweep_room(p_classroom_id);
  select * into v_room from public.classrooms where id = p_classroom_id;
  select * into v_s
    from public.study_sessions
   where classroom_id = p_classroom_id and student_id = auth.uid() and ended_at is null;

  if not found or not v_s.pulse_paused then return null; end if;

  if v_room.integrity_mode <> 'relaxed' then
    v_due := now() + public.avhi_pulse_interval();
    v_cap := now() + interval '2 hours';
  end if;

  update public.study_sessions
     set started_at = now(), pulse_paused = false, pulse_due_at = v_due, cap_until = v_cap
   where id = v_s.id;

  if v_due is not null then
    insert into public.session_pulses (session_id, classroom_id, student_id, kind, due_at)
    values (v_s.id, p_classroom_id, auth.uid(), 'scheduled', v_due);
  end if;
  return jsonb_build_object('resumed_at', now());
end $$;

-- ── self-pause (strict-mode idle/tab-hidden signals; also a manual pause) ──
create or replace function public.avhi_self_pause(p_classroom_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_room public.classrooms;
  v_s public.study_sessions;
begin
  if auth.uid() is null then return; end if;
  if not public.avhi_is_member(p_classroom_id) then return; end if;
  perform public.avhi_sweep_room(p_classroom_id);
  select * into v_room from public.classrooms where id = p_classroom_id;
  select * into v_s
    from public.study_sessions
   where classroom_id = p_classroom_id and student_id = auth.uid() and ended_at is null;
  if found and not v_s.pulse_paused then
    perform public.avhi_halt_session(v_room, v_s, now());
  end if;
end $$;

-- ── nudge a classmate: immediate short pulse on THEIR session, rate-limited ─
create or replace function public.avhi_nudge(p_classroom_id uuid, p_target_student_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_room public.classrooms;
  v_s public.study_sessions;
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

  -- rate limit: one nudge per (sender → target) per 10 minutes
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
  return jsonb_build_object('nudged', found and v_room.integrity_mode <> 'relaxed');
end $$;

-- ── change room integrity mode (new rules apply from now, never retro) ─────
create or replace function public.avhi_set_integrity(p_classroom_id uuid, p_mode text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_due timestamptz;
  v_cap timestamptz;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  if not public.avhi_is_member(p_classroom_id) then raise exception 'NOT_A_MEMBER'; end if;
  if p_mode not in ('relaxed','balanced','strict') then raise exception 'VALIDATION: mode'; end if;

  update public.classrooms set integrity_mode = p_mode where id = p_classroom_id;

  if p_mode <> 'relaxed' then
    v_due := now() + public.avhi_pulse_interval();
    v_cap := now() + interval '2 hours';
    update public.study_sessions
       set pulse_due_at = coalesce(pulse_due_at, v_due),
           cap_until = coalesce(cap_until, v_cap)
     where classroom_id = p_classroom_id and ended_at is null and not pulse_paused;
  end if;
end $$;

-- ── member payload: add pulse fields (signature change) ────────────────────
drop function if exists public.avhi_member_json(public.classroom_members, timestamptz);
create or replace function public.avhi_member_json(m public.classroom_members, s public.study_sessions)
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
    'open_session_started_at', case when s.id is null then null else s.orig_started_at end,
    'pulse_paused', coalesce(s.pulse_paused, false),
    'pulse_due_at', case when s.id is not null and m.student_id = auth.uid() then s.pulse_due_at else null end
  );
$$;

-- ── room state + join / start / stop: adopt new member payload ─────────────
drop function if exists public.avhi_join_classroom(text, text, text, jsonb);
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

  select * into v_room from public.classrooms where join_code = upper(btrim(p_code));
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if not v_room.is_active then raise exception 'ROOM_INACTIVE'; end if;

  perform pg_advisory_xact_lock(hashtext(v_room.id::text));

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

  select count(*) into v_count
    from public.classroom_members
   where classroom_id = v_room.id and membership_status = 'active';
  if v_count >= v_room.capacity then raise exception 'ROOM_FULL'; end if;

  select min(s.n) into v_seat
    from generate_series(1, 10) as s(n)
   where not exists (
     select 1 from public.classroom_members m
      where m.classroom_id = v_room.id and m.membership_status = 'active' and m.seat_number = s.n
   );

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

drop function if exists public.avhi_room_state(uuid);
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

  select coalesce(jsonb_agg(public.avhi_member_json(m, s) order by m.seat_number), '[]'::jsonb)
    into v_members
    from public.classroom_members m
    left join public.study_sessions s
      on s.classroom_id = m.classroom_id and s.student_id = m.student_id and s.ended_at is null
   where m.classroom_id = p_classroom_id and m.membership_status = 'active';

  return jsonb_build_object('classroom', to_jsonb(v_room), 'members', v_members);
end $$;

-- ── leaderboard: daily cap + integrity mode (REPLACES 0002) ────────────────
drop function if exists public.avhi_leaderboard(uuid);
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

  -- per-UTC-day subtotals clamped at the 10h anti-farming cap
  with daily as (
    select s.student_id,
           floor(extract(epoch from s.started_at) / 86400) as day_idx,
           sum(extract(epoch from (s.ended_at - s.started_at))) as secs
      from public.study_session_segments s
     where s.classroom_id = p_classroom_id
       and s.period_index = v_period_index
       and s.segment_type = 'focus'
     group by s.student_id, floor(extract(epoch from s.started_at) / 86400)
  ),
  totals as (
    select student_id, sum(least(secs, 36000))::bigint as seconds
      from daily group by student_id
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
    'integrity_mode', v_room.integrity_mode,
    'rows', v_rows
  );
end $$;

-- ── privileges (re-assert after DROP/CREATE — drops reset grants) ──────────
-- internal helpers: never exposed
revoke execute on function public.avhi_pulse_interval() from public, anon, authenticated;
revoke execute on function public.avhi_bank_window(public.classrooms, uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.avhi_halt_session(public.classrooms, public.study_sessions, timestamptz) from public, anon, authenticated;
revoke execute on function public.avhi_member_json(public.classroom_members, public.study_sessions) from public, anon, authenticated;
revoke execute on function public.avhi_close_session(public.classrooms, public.study_sessions, timestamptz) from public, anon, authenticated;

-- client-callable RPCs: authenticated principals only (recreated above)
revoke execute on function public.avhi_sweep_room(uuid) from public, anon;
revoke execute on function public.avhi_join_classroom(text, text, text, jsonb) from public, anon;
revoke execute on function public.avhi_start_study(uuid) from public, anon;
revoke execute on function public.avhi_room_state(uuid) from public, anon;
revoke execute on function public.avhi_leaderboard(uuid) from public, anon;

grant execute on function public.avhi_sweep_room(uuid) to authenticated;
grant execute on function public.avhi_join_classroom(text, text, text, jsonb) to authenticated;
grant execute on function public.avhi_start_study(uuid) to authenticated;
grant execute on function public.avhi_room_state(uuid) to authenticated;
grant execute on function public.avhi_leaderboard(uuid) to authenticated;

grant execute on function public.avhi_ack_pulse(uuid) to authenticated;
grant execute on function public.avhi_resume_session(uuid) to authenticated;
grant execute on function public.avhi_self_pause(uuid) to authenticated;
grant execute on function public.avhi_nudge(uuid, uuid) to authenticated;
grant execute on function public.avhi_set_integrity(uuid, text) to authenticated;
