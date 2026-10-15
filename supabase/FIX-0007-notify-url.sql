-- ═══════════════════════════════════════════════════════════════════════════
-- REPAIR: updates only avhi_notify_student with the REAL project ref + secret
-- (migration 0007's placeholders were left un-substituted). Run whole file.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.avhi_notify_student(
  p_student_id uuid,
  p_kind text,
  p_classroom_id uuid,
  p_from_name text,
  p_text text default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url := 'https://opwiziyjutvjiyajbkjo.functions.supabase.co/focus-notify',
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
      'x-avhi-webhook-secret', '6e7a225c01c29230db362df5d144b2c2d4b5b3778f56baef6c0e872197324041'
    )
  );
end $$;

revoke execute on function public.avhi_notify_student(uuid, text, uuid, text, text) from public, anon, authenticated;
