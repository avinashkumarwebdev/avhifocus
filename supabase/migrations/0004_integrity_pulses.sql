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
