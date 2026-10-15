-- ═══════════════════════════════════════════════════════════════════════════
-- AVHIFocus · Push notification trigger (pg_net version — database → Edge Fn)
--
-- Use when the dashboard "Database Webhooks" UI is unavailable. When a focus
-- session starts, the DB POSTs the session row to focus-notify, which fans
-- out Web Push (VAPID) + native FCM. REPLACE THE TWO ANGLE-BRACKET VALUES.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pg_net;

create or replace function public.avhi_notify_focus_start()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.ended_at is null then
    perform net.http_post(
      url := 'https://<YOUR-PROJECT-REF>.functions.supabase.co/focus-notify',
      body := jsonb_build_object('type', 'INSERT', 'table', 'study_sessions', 'schema', 'public', 'record', to_jsonb(new)),
      headers := jsonb_build_object('content-type', 'application/json', 'x-avhi-webhook-secret', '<SAME-AVHI_WEBHOOK_SECRET-AS-FUNCTION-SECRET>')
    );
  end if;
  return new;
end $$;

drop trigger if exists avhi_focus_start_notify on public.study_sessions;
create trigger avhi_focus_start_notify
  after insert on public.study_sessions
  for each row execute function public.avhi_notify_focus_start();

revoke execute on function public.avhi_notify_focus_start() from public, anon, authenticated;
