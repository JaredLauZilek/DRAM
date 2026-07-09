import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anon) {
  console.warn("Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — see .env.example");
}

// Fall back to harmless placeholders so the app still mounts (and shows its
// empty state) before .env is configured, instead of throwing a blank screen.
// createClient() throws on an empty URL; a valid-looking dummy just makes the
// data calls fail quietly, which the UI already handles.
export const supabase = createClient(
  url || "https://placeholder.supabase.co",
  anon || "placeholder-anon-key",
);

// Optional: call the edge function on demand (the cron also runs it daily).
export async function refreshNow() {
  const res = await fetch(`${url}/functions/v1/daily-signal`, {
    method: "POST",
    headers: { Authorization: `Bearer ${anon}`, "Content-Type": "application/json" },
  });
  return res.json();
}
