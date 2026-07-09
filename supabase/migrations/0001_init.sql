-- ============================================================
--  Memory Cycle Signal — schema
--  Run in the Supabase SQL editor, or via `supabase db push`.
-- ============================================================

-- Single-row config: peaks + your pre-committed price levels.
create table if not exists app_config (
  id            int primary key default 1,
  tickers       text[]  not null default array['MU','SNDK','WDC','DRAM'],
  peaks         jsonb   not null default '{}'::jsonb,  -- {"MU":1214,...} cycle peak per ticker
  entry_levels  jsonb   not null default '{}'::jsonb,  -- price <= this = "entry decision point"
  watch_levels  jsonb   not null default '{}'::jsonb,  -- price <= this = "watch"
  stale_days    int     not null default 40,           -- warn if no contract print in N days
  updated_at    timestamptz default now(),
  constraint single_row check (id = 1)
);

-- Manual monthly/quarterly DDR5 contract-price direction log.
create table if not exists contract_log (
  id         uuid primary key default gen_random_uuid(),
  period     text not null,                              -- "Aug 2026"
  direction  text not null check (direction in ('up','flat','down')),
  note       text,
  logged_at  timestamptz default now()
);

-- Catalyst calendar.
create table if not exists catalysts (
  id          uuid primary key default gen_random_uuid(),
  event_date  date,
  label       text not null,
  detail      text,
  done        boolean default false
);

-- One row per day, written by the edge function. This is what the app reads.
create table if not exists snapshots (
  id             uuid primary key default gen_random_uuid(),
  snapshot_date  date not null default current_date,
  prices         jsonb not null,          -- {"MU":{"price":917,"peak":1214,"drawdown":24.5,"prevClose":..},..}
  verdict        text not null,           -- HOLD | WATCH | ENTRY | CAUTION
  headline       text not null default '',
  reasons        text[] not null default '{}',
  created_at     timestamptz default now(),
  unique (snapshot_date)
);

create index if not exists snapshots_date_idx on snapshots (snapshot_date desc);

-- ------------------------------------------------------------
--  Seed (edit freely later in the app's Settings panel)
-- ------------------------------------------------------------
insert into app_config (id, peaks, entry_levels, watch_levels)
values (
  1,
  '{"MU":1214,"SNDK":2340,"WDC":660,"DRAM":70}'::jsonb,
  '{"MU":760,"SNDK":1400,"WDC":460,"DRAM":49}'::jsonb,   -- example: ~-37% zones. SET YOUR OWN.
  '{"MU":870,"SNDK":1550,"WDC":520,"DRAM":56}'::jsonb
)
on conflict (id) do nothing;

insert into contract_log (period, direction, note) values
  ('Q3 2026','up','+13-20% QoQ — still up but decelerating vs Q2'),
  ('Q2 2026','up','~+60% QoQ — blistering'),
  ('Q1 2026','up','+55-60% QoQ — cycle-record surge');

insert into catalysts (event_date, label, detail) values
  ('2026-07-10','SK Hynix Nasdaq listing','Selloff may be positioning around this pricing. Watch basket volatility.'),
  (null,'SanDisk & Western Digital fiscal Q4 earnings','Next NAND/storage demand read. Set exact dates from IR.'),
  (null,'TrendForce / DRAMeXchange contract print','The core signal — log into contract_log. Recurs monthly.'),
  (null,'Micron fiscal Q4 earnings','Watch for any walk-back of 2027 order-book / margin guidance.');

-- ------------------------------------------------------------
--  Row Level Security
--  This is a PERSONAL, single-user app. Two choices:
--
--  (A) Quick / personal (below): allow the anon key to read+write.
--      Fine if you keep the deployed URL private. Anyone with the
--      URL + anon key could read/write, so DO NOT post it publicly.
--
--  (B) Proper: enable Supabase Auth, restrict policies to your uid.
--      Recommended if the app is ever reachable publicly.
-- ------------------------------------------------------------
alter table app_config   enable row level security;
alter table contract_log enable row level security;
alter table catalysts    enable row level security;
alter table snapshots    enable row level security;

-- (A) permissive personal-use policies
create policy "anon read config"    on app_config   for select using (true);
create policy "anon write config"   on app_config   for update using (true) with check (true);
create policy "anon rw contract"    on contract_log for all using (true) with check (true);
create policy "anon rw catalysts"   on catalysts    for all using (true) with check (true);
create policy "anon read snapshots" on snapshots    for select using (true);
-- snapshots are written by the edge function using the SERVICE ROLE key,
-- which bypasses RLS, so no insert policy for anon is needed here.

-- ============================================================
--  DAILY CRON  (run AFTER deploying the edge function)
--  Requires pg_cron + pg_net (enable under Database > Extensions).
--  Replace <PROJECT_REF> and <ANON_OR_SERVICE_KEY>.
-- ============================================================
-- select cron.schedule(
--   'daily-memory-signal',
--   '0 23 * * *',                      -- 23:00 UTC = 07:00 MYT next morning
--   $$
--   select net.http_post(
--     url     := 'https://<PROJECT_REF>.functions.supabase.co/daily-signal',
--     headers := '{"Authorization":"Bearer <ANON_OR_SERVICE_KEY>","Content-Type":"application/json"}'::jsonb
--   );
--   $$
-- );
