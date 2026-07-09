import { useEffect, useState, useCallback } from "react";
import { supabase, refreshNow } from "./lib/supabase";

const VERDICT_META = {
  HOLD:    { color: "var(--green)", label: "Hold" },
  WATCH:   { color: "var(--gold)",  label: "Watch" },
  ENTRY:   { color: "var(--cyan)",  label: "Entry level hit" },
  CAUTION: { color: "var(--red)",   label: "Caution" },
};

export default function App() {
  const [snap, setSnap] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [log, setLog] = useState([]);
  const [cats, setCats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("desk"); // desk | settings

  const loadAll = useCallback(async () => {
    const [{ data: s }, { data: c }, { data: l }, { data: k }] = await Promise.all([
      supabase.from("snapshots").select("*").order("snapshot_date", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("app_config").select("*").eq("id", 1).maybeSingle(),
      supabase.from("contract_log").select("*").order("logged_at", { ascending: false }),
      supabase.from("catalysts").select("*").order("event_date", { ascending: true, nullsFirst: false }),
    ]);
    setSnap(s); setCfg(c); setLog(l ?? []); setCats(k ?? []); setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  async function doRefresh() {
    setBusy(true);
    try { await refreshNow(); await loadAll(); }
    finally { setBusy(false); }
  }

  if (loading) return <div className="wrap"><p className="muted">Loading signal desk…</p></div>;

  const meta = snap ? VERDICT_META[snap.verdict] ?? VERDICT_META.HOLD : VERDICT_META.HOLD;

  return (
    <div className="wrap">
      <header>
        <div className="eyebrow">Standalone signal desk</div>
        <h1>Memory Cycle Signal</h1>
        <p className="thesis">One verdict a day. The system defaults to <b>Hold</b> — it only escalates when a level you pre-set is crossed or the DDR5 contract trigger fires.</p>
        <div className="tabs">
          <button className={tab==="desk"?"tab on":"tab"} onClick={()=>setTab("desk")}>Desk</button>
          <button className={tab==="settings"?"tab on":"tab"} onClick={()=>setTab("settings")}>Settings</button>
          <button className="btn ghost" onClick={doRefresh} disabled={busy}>{busy?"Refreshing…":"Refresh now"}</button>
        </div>
      </header>

      {tab === "desk"
        ? <Desk snap={snap} meta={meta} log={log} cats={cats} />
        : <Settings cfg={cfg} log={log} cats={cats} reload={loadAll} />}

      <p className="disclaimer">Not investment advice. A monitoring tool that tracks rules you define — it does not predict prices. Memory names carry 2×+ beta; daily moves are noise. Verify data before acting.</p>
    </div>
  );
}

/* ---------------- DESK ---------------- */
function Desk({ snap, meta, log, cats }) {
  if (!snap) return <Empty />;
  const prices = snap.prices || {};
  const dirs = log.map(l => l.direction);
  return (
    <>
      <div className="verdict" style={{ borderColor: meta.color }}>
        <div className="verdict-top">
          <span className="verdict-dot" style={{ background: meta.color, boxShadow: `0 0 12px ${meta.color}` }} />
          <span className="verdict-label" style={{ color: meta.color }}>{meta.label}</span>
          <span className="verdict-date">{snap.snapshot_date}</span>
        </div>
        <p className="verdict-headline">{snap.headline}</p>
        {snap.reasons?.length > 0 && (
          <ul className="reasons">
            {snap.reasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        )}
      </div>

      <Section num="01" title="Prices & drawdown from peak">
        <div className="cards">
          {Object.entries(prices).map(([t, d]) => <PriceCard key={t} t={t} d={d} />)}
        </div>
      </Section>

      <Section num="02" title="DDR5 contract trigger">
        <div className="panel">
          <TriggerBanner dirs={dirs} />
          {log.map(l => (
            <div className="logrow" key={l.id}>
              <span className="mono">{l.period}</span>
              <span className={"pill dir-" + l.direction}>{l.direction}</span>
              {l.note && <span className="lognote">{l.note}</span>}
            </div>
          ))}
          <p className="muted small">Add prints in Settings. Trigger = two consecutive Down readings.</p>
        </div>
      </Section>

      <Section num="03" title="Catalysts">
        <div className="panel">
          {cats.filter(c=>!c.done).length === 0 && <p className="muted small">Nothing pending.</p>}
          {cats.filter(c=>!c.done).map(c => (
            <div className="catrow" key={c.id}>
              <span className="cat-date">{c.event_date || "TBC"}</span>
              <div><div className="cat-label">{c.label}</div>{c.detail && <div className="muted small">{c.detail}</div>}</div>
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}

function PriceCard({ t, d }) {
  if (d.error) return <div className="card"><div className="mono b">{t}</div><div className="muted small">unavailable</div></div>;
  const dd = d.drawdown ?? 0;
  const col = dd >= 40 ? "var(--red)" : dd >= 25 ? "var(--amber)" : dd >= 12 ? "var(--gold)" : "var(--green)";
  const dayCol = d.dayChangePct >= 0 ? "var(--green)" : "var(--red)";
  return (
    <div className="card">
      <div className="card-top">
        <span className="mono b">{t}</span>
        <span className="mono" style={{ color: col }}>−{dd.toFixed(0)}%</span>
      </div>
      <div className="price mono">${Number(d.price).toLocaleString()}</div>
      <div className="mono small" style={{ color: dayCol }}>
        {d.dayChangePct >= 0 ? "▲" : "▼"} {Math.abs(d.dayChangePct).toFixed(2)}% today
      </div>
      <div className="bar"><div className="bar-zone" /><div className="bar-fill" style={{ width: Math.min(100, dd) + "%", background: col }} /></div>
      <div className="mono tiny muted">peak ${Number(d.peak).toLocaleString()} · −40/−60% avg zone</div>
    </div>
  );
}

function TriggerBanner({ dirs }) {
  const fired = dirs[0] === "down" && dirs[1] === "down";
  const one = dirs[0] === "down";
  const flat = dirs[0] === "flat";
  let cls = "tb-safe", txt = "Safe · no bear trigger — contract prices firm";
  if (fired) { cls = "tb-fired"; txt = "TRIGGER FIRED · two consecutive declines"; }
  else if (one) { cls = "tb-watch"; txt = "Watch · one Down print — one more confirms"; }
  else if (flat) { cls = "tb-watch"; txt = "Watch · pricing flattening"; }
  return <div className={"trigger " + cls}>{txt}</div>;
}

/* ---------------- SETTINGS ---------------- */
function Settings({ cfg, log, cats, reload }) {
  const [peaks, setPeaks] = useState(cfg?.peaks || {});
  const [entry, setEntry] = useState(cfg?.entry_levels || {});
  const [watch, setWatch] = useState(cfg?.watch_levels || {});
  const [saving, setSaving] = useState(false);
  const tickers = cfg?.tickers || ["MU", "SNDK", "WDC", "DRAM"];

  const [period, setPeriod] = useState("");
  const [dir, setDir] = useState("up");
  const [note, setNote] = useState("");

  async function saveLevels() {
    setSaving(true);
    await supabase.from("app_config").update({
      peaks: numObj(peaks), entry_levels: numObj(entry), watch_levels: numObj(watch), updated_at: new Date(),
    }).eq("id", 1);
    setSaving(false); reload();
  }
  async function addPrint() {
    if (!period.trim()) return;
    await supabase.from("contract_log").insert({ period: period.trim(), direction: dir, note: note.trim() || null });
    setPeriod(""); setNote(""); reload();
  }
  async function delPrint(id) { await supabase.from("contract_log").delete().eq("id", id); reload(); }
  async function toggleCat(c) { await supabase.from("catalysts").update({ done: !c.done }).eq("id", c.id); reload(); }

  return (
    <>
      <Section num="A" title="Your levels (pre-commit sober, once)">
        <div className="panel">
          <p className="muted small" style={{marginBottom:12}}>Entry = the price you'd consider a decision point. Watch = getting close. The daily verdict fires off these.</p>
          <div className="levelgrid head"><span>Ticker</span><span>Peak $</span><span>Entry ≤ $</span><span>Watch ≤ $</span></div>
          {tickers.map(t => (
            <div className="levelgrid" key={t}>
              <span className="mono b">{t}</span>
              <input className="mono" value={peaks[t] ?? ""} onChange={e=>setPeaks({...peaks,[t]:e.target.value})} />
              <input className="mono" value={entry[t] ?? ""} onChange={e=>setEntry({...entry,[t]:e.target.value})} />
              <input className="mono" value={watch[t] ?? ""} onChange={e=>setWatch({...watch,[t]:e.target.value})} />
            </div>
          ))}
          <button className="btn gold" onClick={saveLevels} disabled={saving}>{saving?"Saving…":"Save levels"}</button>
        </div>
      </Section>

      <Section num="B" title="Log a contract-price print">
        <div className="panel">
          <div className="addgrid">
            <input placeholder="Period (Aug 2026)" value={period} onChange={e=>setPeriod(e.target.value)} />
            <select value={dir} onChange={e=>setDir(e.target.value)}>
              <option value="up">Up</option><option value="flat">Flat</option><option value="down">Down</option>
            </select>
            <input placeholder="Note (+5% QoQ, decelerating)" value={note} onChange={e=>setNote(e.target.value)} />
            <button className="btn gold" onClick={addPrint}>Log</button>
          </div>
          {log.map(l => (
            <div className="logrow" key={l.id}>
              <span className="mono">{l.period}</span>
              <span className={"pill dir-" + l.direction}>{l.direction}</span>
              <button className="x" onClick={()=>delPrint(l.id)}>×</button>
            </div>
          ))}
        </div>
      </Section>

      <Section num="C" title="Catalysts">
        <div className="panel">
          {cats.map(c => (
            <label className="catrow click" key={c.id}>
              <input type="checkbox" checked={c.done} onChange={()=>toggleCat(c)} />
              <span className="cat-date">{c.event_date || "TBC"}</span>
              <span className={c.done ? "struck" : ""}>{c.label}</span>
            </label>
          ))}
        </div>
      </Section>
    </>
  );
}

/* ---------------- shared ---------------- */
function Section({ num, title, children }) {
  return (
    <section>
      <div className="sec-head"><span className="sec-num">{num}</span><span className="sec-title">{title}</span><span className="sec-line" /></div>
      {children}
    </section>
  );
}
function Empty() {
  return <div className="panel"><p className="muted">No snapshot yet. Hit “Refresh now” to run the edge function, or wait for the daily cron.</p></div>;
}
function numObj(o) {
  const out = {};
  for (const k in o) { const n = parseFloat(o[k]); if (!isNaN(n)) out[k] = n; }
  return out;
}
