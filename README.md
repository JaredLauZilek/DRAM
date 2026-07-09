# Memory Cycle Signal — standalone mini-app

A daily check-in cockpit for the memory-stock cycle. A Supabase cron job pulls
Finnhub prices once a day, reads the rules you set, computes ONE verdict, and a
small React app shows it. Design goal: the default state is **Hold** — it only
escalates when a price level you pre-set is crossed or the DDR5 contract trigger
fires. On most days it should tell you to do nothing, and that's the point.

**This is a monitoring tool, not a "trade today" oracle.** The one signal that
actually moves the cycle — DDR5 contract-price direction — is monthly and logged
by hand. Everything else is automated around it.

## The verdict (highest firing condition wins)

| State | Fires when | Colour |
|-------|-----------|--------|
| **CAUTION** | Last two DDR5 contract prints are both `down` (bear trigger) | red |
| **ENTRY** | A stock reached the entry price you pre-set (your buy zone) | cyan |
| **WATCH** | A stock neared your watch price, a catalyst is within 3 days, or the contract log went stale | gold |
| **HOLD** | Nothing changed | green |

## Files

```
index.html, vite.config.js, package.json
src/main.jsx                 -- entry
src/App.jsx                  -- the cockpit (Desk + Settings tabs)
src/index.css                -- styling (graphite + gold signal desk)
src/lib/supabase.js          -- client + on-demand refreshNow()
supabase/migrations/0001_init.sql        -- tables, seed, RLS, cron (canonical schema)
supabase/functions/daily-signal/index.ts -- the daily job
.env.example
```

## Setup (~15 min)

**1. Supabase project.** Create one at supabase.com. Note the Project URL, anon
key (Settings → API), and project ref.

**2. Database.** Open SQL Editor, paste `supabase/migrations/0001_init.sql`, run
it. Edit the seeded `peaks` / `entry_levels` / `watch_levels` — or set them later
in the app's Settings tab. Leave the cron block (bottom, commented) until step 4.

**3. Edge function.**
```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase secrets set FINNHUB_API_KEY=your_finnhub_key
supabase functions deploy daily-signal
```
Test once:
```bash
curl -X POST https://YOUR_PROJECT_REF.functions.supabase.co/daily-signal \
  -H "Authorization: Bearer YOUR_ANON_KEY"
```
You should get JSON back and a row in the `snapshots` table.

**4. Schedule.** Uncomment the cron block in the migration, fill in your project
ref + key, and run it. Fires daily 23:00 UTC = 07:00 Malaysia, after the US close.

**5. Frontend.**
```bash
npm install
cp .env.example .env      # fill in VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
npm run dev
```
The "Refresh now" button runs the edge function on demand so you don't have to
wait for the cron the first time.

## Daily loop

1. Open the app, read the one verdict line. **Hold** → close it. That's the tool working.
2. Once a month when TrendForce/DRAMeXchange publishes, log the contract-price
   direction (Up/Flat/Down) in Settings. The only manual input — and the one that
   actually decides the cycle.
3. Tune your entry/watch levels in Settings. Set them sober, in advance; the
   verdict fires off them so in-the-moment emotion doesn't get a vote.

## Optional: push alerts

Right now it's view-only. If you'd rather get pinged only when the verdict
*changes* (so you never open it otherwise), the edge function can send a
WhatsApp/email on state change — it compares today's verdict to yesterday's and
notifies on a diff. Ask and I'll add that block.

## Security

Single-user personal app. RLS is on with permissive anon policies (read all +
log prints + edit levels). Keep the deployed URL private, or add Supabase Auth
and scope policies to your uid before exposing it. The Finnhub key is a
server-side edge secret and never touches the frontend.

## Costs

Supabase + Finnhub free tiers cover this: one daily run is ~5 API calls, far
under Finnhub's 60/min free limit.
