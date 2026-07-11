# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Memory Cycle Signal** — a single-user daily monitoring cockpit for the memory-stock cycle (MU, SNDK, WDC, DRAM). A React SPA reads one pre-computed verdict per day from Supabase; a Deno edge function computes that verdict once a day from Finnhub quotes + hand-logged DDR5 contract prices. The product philosophy governs the code: **it defaults to Hold and only escalates.** Most days it should tell the user to do nothing.

## Commands

```bash
npm install            # deps
npm run dev            # Vite dev server on :5173 (reads .env)
npm run build          # production build to dist/
npm run preview        # serve the built bundle
```

There is **no test suite, linter, or CI** configured. `npm run build` (Vite + esbuild) is the only automated correctness gate — treat a clean build as the bar before shipping frontend changes.

Supabase changes are applied to the live project, not just to files. Two ways:
- **Supabase CLI** (see README): `supabase db push`, `supabase functions deploy daily-signal`, `supabase secrets set FINNHUB_API_KEY=…`
- **Supabase MCP tools** (in-session): `apply_migration`, `deploy_edge_function`, `execute_sql`. Editing the `.sql`/`.ts` files alone changes nothing deployed.

## Architecture — the big picture

Data flows in one direction, and the two writers own disjoint fields (they share the `app_config` row but never set the same columns):

```
Finnhub /quote ─┐
                ▼
        daily-signal (edge fn, Deno, SERVICE ROLE)
   reads app_config + catalysts + contract_log
   computes ONE verdict ──> writes snapshots (one row/day)
                            + auto-tracks app_config.peaks (Yahoo 52-wk high)
                                   │
                                   ▼
        React app (anon key) reads snapshots[latest]  ──> Desk tab
        React app (anon key) writes app_config / contract_log / catalysts ──> Settings tab
```

- **`src/App.jsx`** is the entire UI (Desk + Settings tabs, all subcomponents in one file). `loadAll()` fetches the 4 tables in parallel on mount; every mutation calls `reload()`. The **Desk renders even without a snapshot** — only the verdict card and price cards need `snap`; the cycle meter, contract log, catalysts, and journal are driven by `log`/`cats`/`cfg` and show regardless (important while no Finnhub key is set). The Desk is otherwise read-only *except* the **decision journal**, which autosaves to `app_config.journal` — a deliberate exception to the Desk-reads / Settings-writes split, because the journal is used at the desk.
- **`src/lib/supabase.js`** owns the client and `refreshNow()` (POSTs to the edge function to trigger an on-demand recompute).
- **`supabase/functions/daily-signal/index.ts`** is the *only* place verdict logic lives. The frontend never computes the verdict — it only maps `verdict → color/label` (`VERDICT_META`) and derives *display-only* reads from the contract log: `cycleRead()` (feeds the cycle-position meter **and** the `TriggerBanner`). These mirror the edge function's contract-trigger dimension but never set the verdict.
- **`supabase/migrations/`** holds the canonical schema. `0001_init.sql` = tables + seed + RLS; `0002_journal_and_notes.sql` = additive columns (`app_config.journal`, `catalysts.note`); `0003_daily_cron.sql` = `pg_cron`/`pg_net` + the daily job; `0004_snapshot_intel.sql` = `snapshots.intel` (auto-crawled DDR5 news read). Treat these as the source of truth for DB shape; **migrations must be applied to the live project** (MCP `apply_migration`, `supabase db push`, or SQL editor) — editing the file alone does nothing.

**The verdict is a monotonic escalation**, computed in the edge function: `HOLD(0) < WATCH(1) < ENTRY(2) < CAUTION(3)`. Each rule calls `escalate(to)` which only ever raises the level, never lowers it. To add a new signal, push a `reason` and call `escalate(...)` — do not reassign `verdict` directly. Priority is by design: CAUTION (bear trigger) outranks everything.

**The core signal is manual.** The one input that actually decides the cycle — DDR5 contract-price direction — is logged by hand in `contract_log` (Settings → "Log a print"). The bear trigger fires when the **last two** prints are both `down`. Everything else (prices, drawdowns, catalyst proximity, staleness) automates *around* that.

## Infrastructure

- **Supabase project:** `DRAM`, ref `vjqbircarzxcxrdzlyxj`, region `ap-northeast-2` (Seoul). Live and connected as of this writing.
- **Tables** (all in `public`): `app_config` (hard single row, `id=1`; includes `journal`), `contract_log`, `catalysts` (includes user-editable `note`, distinct from the pre-written `detail`), `snapshots` (one row per `snapshot_date`). The `journal` and `note` columns are added by migration `0002` — **if it hasn't been applied, journal/note saves fail** (the UI surfaces "apply the 0002 migration") while everything else works.
- **Edge function:** `daily-signal`, deployed with `verify_jwt: true`.
- **Secrets:** `FINNHUB_API_KEY` (edge secret — **set and working**; all four tickers resolve on the Finnhub free tier). `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are auto-injected into the function.
- **Frontend env** (`.env`, gitignored): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. Vite **inlines these at build time** — rebuild after any `.env` change.
- **Cron:** **live.** `pg_cron` + `pg_net` are enabled and job `daily-memory-signal` runs `0 23 * * *` (23:00 UTC = 07:00 MYT), POSTing the anon JWT to the function via `net.http_post`. Deployed by migration `0003_daily_cron.sql`. The "Refresh now" button still works on-demand. Inspect runs via `cron.job` / `cron.job_run_details`; pg_net responses land in `net._http_response`.

## Security model (read before touching auth or RLS)

This is a **personal single-user app** with deliberately permissive RLS: the anon role can read everything and write `app_config` / `contract_log` / `catalysts`. That is only safe because the deployed URL is kept private. Before exposing this app publicly, switch to Supabase Auth and scope policies to a uid — do not just ship the permissive policies.

- The **anon key is public by design** (it ships in the frontend bundle). RLS is the only guard.
- **`snapshots` has no anon write policy** — it is written exclusively by the edge function via the service-role key (which bypasses RLS). Do not add an anon insert policy; the frontend must never write snapshots.
- **Never** put the service-role key in a `VITE_*` var or anywhere the frontend can reach it.

## Gotchas future devs will hit

- **Missing `.env` fails silently, not loudly.** `supabase.js` falls back to a placeholder URL so the app still mounts (shows the empty state) instead of white-screening on the `createClient` throw. Upside: no blank page. Downside: a misconfigured env looks like "no data" rather than an error — check the console warning and that the bundle embeds the real project URL.
- **verify_jwt + key type.** The function requires a valid JWT. The frontend's `refreshNow()` sends the **legacy anon JWT** as `Bearer`, which passes. The modern publishable key (`sb_publishable_…`) is **not a JWT** and will fail function auth — if you migrate the client to it, either keep the anon JWT for `refreshNow()` or redeploy the function with `verify_jwt: false` + custom auth.
- **Finnhub free-tier coverage.** `/quote` returns `{c:0}` for symbols it doesn't cover; the code renders those as "unavailable". `SNDK` and especially `DRAM` (not a US-listed equity) may not resolve. Verify tickers against the active Finnhub plan; edit the list in Settings.
- **`daysBetween(a, b) = floor((a-b)/DAY_MS)` — argument order carries the sign.** Staleness uses `(now, logged_at)` (positive = days old); catalyst proximity uses `(event_date, now)` (0–3 = upcoming). Get the order wrong and the rule silently never fires.
- **`snapshots` upserts on `snapshot_date`** — re-running the function the same day overwrites that day's row (idempotent, intended).
- **`app_config` is a hard single row** (`check (id = 1)`). Always `update … eq('id', 1)`; never insert new config rows.
- **Peaks are auto-tracked, not user-set.** Finnhub's free tier has **no** historical/52-week high (`/quote` gives only current + day high/low; `/stock/metric` and `/stock/candle` are premium), so the peak comes from **Yahoo Finance** (`query1.finance.yahoo.com/v8/finance/chart/{sym}` → `meta.fiftyTwoWeekHigh`, free, no key). The function keeps it as a **monotonic high-water mark**: `peak = max(storedPeak, yahoo52wHigh, currentPrice)` — corrects the value, never drops below an older cycle top, ratchets on new highs. Yahoo's prices match the Finnhub feed exactly (verified), so mixing them is safe; if Yahoo fails for a ticker it falls back to the stored peak. Settings shows peak **read-only** and never writes that column (only `entry_levels` / `watch_levels` are user-owned) — so no lost-update race.
- **`contract_log.direction` is a DB enum** (`'up' | 'flat' | 'down'`, CHECK constraint). New values need a migration, not just frontend changes.
- **StrictMode double-runs effects in dev**, so `loadAll()` fires twice on mount locally — harmless, but don't chase it as a bug.
- **DDR5 news crawl uses Bing News RSS, not Google.** Google News RSS returns **503** to the Supabase edge IP; Bing (`bing.com/news/search?...&format=rss`) works. `fetchDdr5Intel()` is best-effort — on any failure it stores `{}` and the UI hides the panel. Direction inference is naive substring keyword scoring, tuned to avoid collisions (e.g. `incr[ease]`, `a[gain]st`); it's advisory, not authoritative. Reachability differs by host **and** by runtime — always probe from an edge function (not local curl), like `market-probe` did. Yahoo/Finnhub work from the edge; some hosts 429/503 the datacenter IP.
- **Keep files UTF-8.** The original sources arrived with mojibake (garbled em-dashes/arrows); the app uses real Unicode (`—`, `→`, `▲▼`, `×`, `≤`, `−`). Watch for stray non-ASCII sneaking into places like CSS hex values.

## Design principles (preserve these when changing behavior)

1. **Default to Hold; escalate only.** Any new feature should keep quiet days quiet. Don't add noise that fires on normal volatility.
2. **Pre-committed levels beat in-the-moment judgment.** Entry/watch levels are set sober in Settings so the daily verdict fires off them mechanically. Don't add flows that invite ad-hoc, emotional overrides.
3. **One verdict, one source of truth.** Verdict computation stays in the edge function. The frontend displays; it does not decide.
4. **Manual contract log is sacred.** It's the single highest-signal input. Don't bury it or try to auto-scrape it away — the hand-logging is intentional friction. The **auto market-read** (crawled DDR5/DRAM news in Desk §03 + a logging *suggestion* in Settings) is **advisory only**: it never sets the verdict and never writes `contract_log`. Keep it that way — it assists logging, it doesn't replace it.
5. **It monitors, it does not predict.** Framing in copy and UI should never imply price forecasting.
