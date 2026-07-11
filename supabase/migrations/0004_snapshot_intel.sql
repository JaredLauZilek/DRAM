-- ============================================================
--  0004 — Auto-crawled DDR5 market intel on the daily snapshot
--  Additive. The edge function fills this from a news crawl
--  (Bing News RSS) each run; the app displays it. It is
--  advisory only — it never sets the verdict or the manual
--  contract_log trigger.
-- ============================================================

alter table snapshots
  add column if not exists intel jsonb not null default '{}'::jsonb;
