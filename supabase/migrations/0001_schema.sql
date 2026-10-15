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
