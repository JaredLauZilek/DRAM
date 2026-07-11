import { useEffect, useState, useCallback, useRef } from "react";
import { supabase, refreshNow } from "./lib/supabase";

const VERDICT_META = {
  HOLD:    { color: "var(--green)", label: "Hold" },
  WATCH:   { color: "var(--gold)",  label: "Watch" },
  ENTRY:   { color: "var(--cyan)",  label: "Entry level hit" },
  CAUTION: { color: "var(--red)",   label: "Caution" },
};

// Display names under each ticker. DRAM is Roundhill's US-listed memory ETF,
// so it should resolve on Finnhub despite the "not an equity" caveat.
const NAMES = {
  MU:   "Micron Technology",
  SNDK: "SanDisk",
  WDC:  "Western Digital",
  DRAM: "Roundhill Memory ETF",
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
        ? <Desk snap={snap} meta={meta} log={log} cats={cats} cfg={cfg} />
        : <Settings cfg={cfg} log={log} cats={cats} reload={loadAll} intel={snap?.intel} />}

      <p className="disclaimer">Not investment advice. A monitoring tool that tracks rules you define — it does not predict prices. Memory names carry 2×+ beta; daily moves are noise. Verify data before acting.</p>
    </div>
  );
}

/* ---------------- signal read (display-only, derived from the log) ----------------
   Mirrors the edge function's contract-trigger dimension but adds finer cycle
   positioning for the meter. The VERDICT still comes only from the edge function;
   this drives display, like TriggerBanner already did.                          */
function cycleRead(dirs, latestNote = "") {
  const last = dirs[0] ?? "up";
  const prev = dirs[1] ?? "up";
  if (last === "down" && prev === "down")
    return { pos: 88, name: "Downturn confirmed", cls: "tb-fired",
      note: "Two straight down prints — the classic tell for a cycle turn. Bear thesis validated." };
  if (last === "down")
    return { pos: 66, name: "Cooling — watch", cls: "tb-watch",
      note: "First down print. One more consecutive decline fires the trigger." };
  if (last === "flat")
    return { pos: 48, name: "Deceleration", cls: "tb-watch",
      note: "Prices flattening — momentum fading but not yet negative." };
  if (/decel/i.test(latestNote || ""))
    return { pos: 30, name: "Rising, decelerating", cls: "tb-safe",
      note: "Prices still up but the pace is slowing — mid-cycle, no turn yet." };
  return { pos: 15, name: "Rising", cls: "tb-safe",
    note: "Contract prices climbing — no cooling signal." };
}

/* ---------------- DESK ---------------- */
function Desk({ snap, meta, log, cats, cfg }) {
  const prices = snap?.prices || {};
  const dirs = log.map(l => l.direction);
  const read = cycleRead(dirs, log[0]?.note);
  const pending = cats.filter(c => !c.done);

  return (
    <>
      {snap ? (
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
      ) : (
        <div className="verdict" style={{ borderColor: "var(--line2)" }}>
          <div className="verdict-top">
            <span className="verdict-dot" style={{ background: "var(--muted2)" }} />
            <span className="verdict-label" style={{ color: "var(--muted)" }}>No snapshot yet</span>
          </div>
          <p className="verdict-headline">No price verdict yet — set the Finnhub key, then hit “Refresh now”. Everything below is driven by your log and works without it.</p>
        </div>
      )}

      <Section num="01" title="Cycle position">
        <CycleMeter read={read} />
      </Section>

      <Section num="02" title="Prices & drawdown from peak">
        {snap
          ? <div className="cards">{Object.entries(prices).map(([t, d]) => <PriceCard key={t} t={t} d={d} />)}</div>
          : <p className="muted small">Prices load once the daily snapshot runs (needs the Finnhub key).</p>}
      </Section>

      <Section num="03" title="DDR5 contract trigger">
        <div className="panel">
          <TriggerBanner read={read} />
          <MarketRead intel={snap?.intel} />
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

      <Section num="04" title="Catalysts">
        <div className="panel">
          {pending.length === 0 && <p className="muted small">Nothing pending.</p>}
          {pending.map(c => (
            <div className="catrow" key={c.id}>
              <span className="cat-date">{c.event_date || "TBC"}</span>
              <div>
                <div className="cat-label">{c.label}</div>
                {c.detail && <div className="muted small">{c.detail}</div>}
                {c.note && <div className="cat-note-display">{c.note}</div>}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section num="05" title="Decision journal">
        <Journal initial={cfg?.journal} />
      </Section>
    </>
  );
}

function CycleMeter({ read }) {
  const col = read.cls === "tb-fired" ? "var(--red)" : read.cls === "tb-watch" ? "var(--amber)" : "var(--green)";
  return (
    <div className="meter-card">
      <div className="state-read">
        <div>
          <div className="state-label">Current read</div>
          <div className="state-name" style={{ color: col }}>{read.name}</div>
        </div>
        <div className="state-note">{read.note}</div>
      </div>
      <div className="track"><div className="marker" style={{ left: read.pos + "%" }} /></div>
      <div className="zonelabels"><span>Rising</span><span>Decelerating</span><span>Cooling</span><span>Downturn</span></div>
    </div>
  );
}

function PriceCard({ t, d }) {
  const name = NAMES[t];
  if (d.error) return (
    <div className="card">
      <div className="mono b">{t}</div>
      {name && <div className="card-name">{name}</div>}
      <div className="muted small">unavailable</div>
    </div>
  );
  const dd = d.drawdown ?? 0;
  const col = dd >= 40 ? "var(--red)" : dd >= 25 ? "var(--amber)" : dd >= 12 ? "var(--gold)" : "var(--green)";
  const dayCol = d.dayChangePct >= 0 ? "var(--green)" : "var(--red)";
  return (
    <div className="card">
      <div className="card-top">
        <span className="mono b">{t}</span>
        <span className="mono" style={{ color: col }}>−{dd.toFixed(0)}%</span>
      </div>
      {name && <div className="card-name">{name}</div>}
      <div className="price mono">${Number(d.price).toLocaleString()}</div>
      <div className="mono small" style={{ color: dayCol }}>
        {d.dayChangePct >= 0 ? "▲" : "▼"} {Math.abs(d.dayChangePct).toFixed(2)}% today
      </div>
      <div className="bar"><div className="bar-zone" /><div className="bar-fill" style={{ width: Math.min(100, dd) + "%", background: col }} /></div>
      <div className="mono tiny muted">peak ${Number(d.peak).toLocaleString()} · −40/−60% avg zone</div>
    </div>
  );
}

function TriggerBanner({ read }) {
  const txt = {
    "tb-fired": "TRIGGER FIRED · two consecutive declines",
    "tb-watch": "Watch · momentum fading — one more Down print confirms the trigger",
    "tb-safe":  "Safe · no bear trigger — contract prices firm",
  }[read.cls];
  return <div className={"trigger " + read.cls}>{txt}</div>;
}

// "Fri, 10 Jul 2026 06:31:21 GMT" -> "10 Jul"
function fmtNewsDate(d) {
  if (!d) return "";
  const m = d.replace(/^\w+,\s*/, "").match(/^(\d{1,2}\s+\w{3})/);
  return m ? m[1] : d.slice(0, 11);
}

// Auto-crawled DDR5/DRAM news read (advisory — does NOT set the verdict/trigger).
function MarketRead({ intel }) {
  if (!intel || !intel.headlines || intel.headlines.length === 0) return null;
  const meta = {
    up:    { color: "var(--green)", label: "Prices rising" },
    down:  { color: "var(--red)",   label: "Prices softening" },
    flat:  { color: "var(--gold)",  label: "Flat" },
    mixed: { color: "var(--gold)",  label: "Mixed signals" },
  }[intel.read] || { color: "var(--muted)", label: intel.read };
  const v = intel.votes || {};
  return (
    <div className="marketread">
      <div className="mr-head">
        <span className="mr-tag">Auto market read</span>
        <span className="mr-verdict" style={{ color: meta.color }}>{meta.label}</span>
        <span className="muted tiny mr-votes">{v.up || 0} ▲ · {v.down || 0} ▼ · {v.flat || 0} –</span>
      </div>
      <div className="mr-list">
        {intel.headlines.map((h, i) => (
          <a className="mr-item" key={i} href={h.url} target="_blank" rel="noreferrer noopener">
            <span className={"pill dir-" + h.dir}>{h.dir}</span>
            <span className="mr-title">{h.title}</span>
            <span className="mr-date">{fmtNewsDate(h.date)}</span>
          </a>
        ))}
      </div>
      <p className="muted tiny mr-foot">Auto-crawled from news ({intel.source}) — a market read, not the contract print itself. Log the actual TrendForce/DRAMeXchange direction below; your manual log is the trigger.</p>
    </div>
  );
}

/* Debounced autosave to the single config row. */
function Journal({ initial }) {
  const [val, setVal] = useState(initial || "");
  const [status, setStatus] = useState("idle");
  const timer = useRef();

  function onChange(e) {
    const v = e.target.value;
    setVal(v);
    setStatus("saving");
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const { error } = await supabase.from("app_config")
        .update({ journal: v, updated_at: new Date() }).eq("id", 1);
      setStatus(error ? "error" : "saved");
    }, 600);
  }

  return (
    <div className="panel">
      <textarea
        className="journal"
        value={val}
        onChange={onChange}
        placeholder="Your thesis, entry rules, and what would change your mind. e.g. 'Scale in 1/3 now, 1/3 if MU holds $900, hold the last third until a contract-price print confirms direction.'"
      />
      <div className="journal-status muted tiny">
        {status === "saving" ? "Saving…"
          : status === "saved" ? "Saved to Supabase"
          : status === "error" ? "Save failed — apply the 0002 migration (adds app_config.journal)"
          : "Autosaves to Supabase"}
      </div>
    </div>
  );
}

/* ---------------- SETTINGS ---------------- */
function Settings({ cfg, log, cats, reload, intel }) {
  const suggested = intel && ["up", "down", "flat"].includes(intel.read) ? intel.read : null;
  const peaks = cfg?.peaks || {}; // auto-tracked by the edge function; read-only here
  const [entry, setEntry] = useState(cfg?.entry_levels || {});
  const [watch, setWatch] = useState(cfg?.watch_levels || {});
  const [saving, setSaving] = useState(false);
  const tickers = cfg?.tickers || ["MU", "SNDK", "WDC", "DRAM"];

  const [period, setPeriod] = useState("");
  const [dir, setDir] = useState(suggested || "up");
  const [note, setNote] = useState("");

  async function saveLevels() {
    setSaving(true);
    await supabase.from("app_config").update({
      entry_levels: numObj(entry), watch_levels: numObj(watch), updated_at: new Date(),
    }).eq("id", 1);
    setSaving(false); reload();
  }
  async function addPrint() {
    if (!period.trim()) return;
    await supabase.from("contract_log").insert({ period: period.trim(), direction: dir, note: note.trim() || null });
    setPeriod(""); setNote(""); reload();
  }
  async function delPrint(id) { await supabase.from("contract_log").delete().eq("id", id); reload(); }

  return (
    <>
      <Section num="A" title="Your levels (pre-commit sober, once)">
        <div className="panel">
          <p className="muted small" style={{marginBottom:12}}>Entry = the price you'd consider a decision point. Watch = getting close. The daily verdict fires off these. <b>Peak</b> is auto-tracked — the 52-week high (via Yahoo), ratcheted up on new highs. You don't set it.</p>
          <div className="levelgrid head"><span>Ticker</span><span>Peak $ · auto</span><span>Entry ≤ $</span><span>Watch ≤ $</span></div>
          {tickers.map(t => (
            <div className="levelgrid" key={t}>
              <span className="mono b">{t}</span>
              <span className="mono peak-ro">{peaks[t] != null && peaks[t] !== "" ? "$" + Number(peaks[t]).toLocaleString() : "—"}</span>
              <input className="mono" value={entry[t] ?? ""} onChange={e=>setEntry({...entry,[t]:e.target.value})} />
              <input className="mono" value={watch[t] ?? ""} onChange={e=>setWatch({...watch,[t]:e.target.value})} />
            </div>
          ))}
          <button className="btn gold" onClick={saveLevels} disabled={saving}>{saving?"Saving…":"Save levels"}</button>
        </div>
      </Section>

      <Section num="B" title="Log a contract-price print">
        <div className="panel">
          {suggested && (
            <p className="muted small" style={{marginBottom:10}}>
              News auto-read suggests <b className={"pill dir-" + suggested} style={{padding:"2px 8px"}}>{suggested}</b> — a hint from headlines, not the print. Confirm against TrendForce/DRAMeXchange before logging.
            </p>
          )}
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
          {cats.map(c => <CatSettingRow key={c.id} c={c} reload={reload} />)}
        </div>
      </Section>
    </>
  );
}

/* One catalyst in Settings: toggle done + editable outcome note (debounced). */
function CatSettingRow({ c, reload }) {
  const [note, setNote] = useState(c.note || "");
  const [status, setStatus] = useState("idle");
  const timer = useRef();

  async function toggle() {
    await supabase.from("catalysts").update({ done: !c.done }).eq("id", c.id);
    reload();
  }
  function onNote(e) {
    const v = e.target.value;
    setNote(v);
    setStatus("saving");
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const { error } = await supabase.from("catalysts").update({ note: v || null }).eq("id", c.id);
      setStatus(error ? "error" : "saved");
    }, 600);
  }

  return (
    <div className="catedit">
      <label className="catrow click">
        <input type="checkbox" checked={c.done} onChange={toggle} />
        <span className="cat-date">{c.event_date || "TBC"}</span>
        <span className={c.done ? "struck" : ""}>{c.label}</span>
      </label>
      <textarea className="cat-note-in" value={note} onChange={onNote} placeholder="Outcome / notes…" />
      {status !== "idle" && (
        <div className="muted tiny">
          {status === "saving" ? "Saving…"
            : status === "saved" ? "Saved"
            : "Save failed — apply the 0002 migration (adds catalysts.note)"}
        </div>
      )}
    </div>
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
function numObj(o) {
  const out = {};
  for (const k in o) { const n = parseFloat(o[k]); if (!isNaN(n)) out[k] = n; }
  return out;
}
