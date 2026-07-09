// ============================================================
//  daily-signal — Supabase Edge Function (Deno)
//  Pulls Finnhub quotes, reads your config + contract log,
//  computes ONE verdict, and writes a daily snapshot row.
//  The app reads that row. Cron runs this once a day; you can
//  also trigger it on demand via the "Refresh now" button.
//
//  Deploy:  supabase functions deploy daily-signal
//  Secret:  supabase secrets set FINNHUB_API_KEY=xxxx
//  (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are auto-injected.)
//
//  Verdict priority (highest wins):
//    CAUTION  — two consecutive DOWN contract prints (bear trigger)
//    ENTRY    — a stock reached the entry price you pre-set
//    WATCH    — a stock reached your watch price, a catalyst is
//               within 3 days, or the contract log has gone stale
//    HOLD     — nothing changed
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FINNHUB = "https://finnhub.io/api/v1";
const DAY_MS = 86_400_000;

const HEADLINES: Record<string, string> = {
  HOLD:    "Hold — no signal change. Sit on your hands.",
  WATCH:   "Watch — a level you set is close, or an event is near.",
  ENTRY:   "Entry level hit — a stock reached your pre-set buy zone. Check the thesis, then decide.",
  CAUTION: "Caution — DDR5 contract prices turned. The bear trigger fired; reassess before adding.",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status, headers: { "Content-Type": "application/json" },
  });
}
const daysBetween = (a: number, b: number) => Math.floor((a - b) / DAY_MS);

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const key = Deno.env.get("FINNHUB_API_KEY");
  if (!key) return json({ error: "FINNHUB_API_KEY not set" }, 500);

  // 1) Config -----------------------------------------------------
  const { data: cfg, error: cErr } = await supabase
    .from("app_config").select("*").eq("id", 1).maybeSingle();
  if (cErr || !cfg) return json({ error: cErr?.message ?? "no app_config row" }, 500);

  const tickers: string[] = cfg.tickers ?? ["MU", "SNDK", "WDC", "DRAM"];
  const peaks = cfg.peaks ?? {};
  const entryLevels = cfg.entry_levels ?? {};
  const watchLevels = cfg.watch_levels ?? {};

  const reasons: string[] = [];
  let verdict = "HOLD";
  const rank: Record<string, number> = { HOLD: 0, WATCH: 1, ENTRY: 2, CAUTION: 3 };
  const escalate = (to: string) => { if (rank[to] > rank[verdict]) verdict = to; };

  // 2) Quotes -> prices jsonb + level checks ----------------------
  const prices: Record<string, any> = {};
  for (const t of tickers) {
    try {
      const q = await fetch(`${FINNHUB}/quote?symbol=${t}&token=${key}`).then((r) => r.json());
      if (!q || typeof q.c !== "number" || q.c === 0) { prices[t] = { error: true }; continue; }
      const peak = Number(peaks[t]) || 0;
      const drawdown = peak > 0 ? ((peak - q.c) / peak) * 100 : 0;
      prices[t] = { price: q.c, peak, drawdown, prevClose: q.pc, dayChangePct: q.dp ?? 0 };

      const entry = Number(entryLevels[t]) || 0;
      const watch = Number(watchLevels[t]) || 0;
      if (entry && q.c <= entry) {
        reasons.push(`${t} at $${q.c} — at/below your entry level $${entry}.`);
        escalate("ENTRY");
      } else if (watch && q.c <= watch) {
        reasons.push(`${t} at $${q.c} — nearing your watch level $${watch}.`);
        escalate("WATCH");
      }
    } catch (_) { prices[t] = { error: true }; }
  }

  // 3) Catalysts within 3 days ------------------------------------
  const now = Date.now();
  const { data: cats } = await supabase
    .from("catalysts").select("*").eq("done", false).not("event_date", "is", null);
  for (const c of cats ?? []) {
    const d = daysBetween(new Date(c.event_date).getTime(), now);
    if (d >= 0 && d <= 3) {
      reasons.push(`${c.label} in ${d === 0 ? "today" : d + " day(s)"} (${c.event_date}).`);
      escalate("WATCH");
    }
  }

  // 4) Contract log: staleness + the bear trigger -----------------
  const { data: log } = await supabase
    .from("contract_log").select("direction, logged_at")
    .order("logged_at", { ascending: false }).limit(2);
  if (log?.length) {
    const stale = daysBetween(now, new Date(log[0].logged_at).getTime());
    if (stale > (cfg.stale_days ?? 40)) {
      reasons.push(`No contract-price print logged in ${stale} days — check TrendForce.`);
      escalate("WATCH");
    }
  }
  if (log?.length === 2 && log[0].direction === "down" && log[1].direction === "down") {
    reasons.push("DDR5 contract prices: two consecutive DOWN prints — bear trigger fired.");
    escalate("CAUTION");
  }

  // 5) Write the daily snapshot -----------------------------------
  const today = new Date().toISOString().slice(0, 10);
  const headline = HEADLINES[verdict];
  const { error: wErr } = await supabase.from("snapshots").upsert({
    snapshot_date: today, prices, verdict, headline, reasons,
  }, { onConflict: "snapshot_date" });
  if (wErr) return json({ error: wErr.message }, 500);

  return json({ date: today, verdict, headline, reasons, prices });
});
