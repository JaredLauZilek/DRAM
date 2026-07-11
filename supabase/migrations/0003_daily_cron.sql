-- ============================================================
--  0003 — Daily cron for the signal recompute
--  Requires pg_cron + pg_net (enabled below). Applied live on
--  the DRAM project. The Bearer token is the PUBLIC anon JWT
--  (safe to store here) — it only passes the function's
--  verify_jwt gate; the function itself writes via service role.
--
--  Fires 23:00 UTC = 07:00 MYT, after the US close.
--  Re-runnable: unschedules an existing job of the same name first.
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid) from cron.job where jobname = 'daily-memory-signal';

select cron.schedule(
  'daily-memory-signal',
  '0 23 * * *',
  $job$
  select net.http_post(
    url     := 'https://vjqbircarzxcxrdzlyxj.supabase.co/functions/v1/daily-signal',
    headers := '{"Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZqcWJpcmNhcnp4Y3hyZHpseXhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2MDQ3MjUsImV4cCI6MjA5OTE4MDcyNX0.TnxX82YmAlbXMvr3Ll4r4UB7d4rs3fcxrb-ozGB3KKE","Content-Type":"application/json"}'::jsonb
  );
  $job$
);
