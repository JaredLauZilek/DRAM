-- ============================================================
--  0002 — Decision journal + per-catalyst outcome notes
--  Additive, safe to run on the live DB. No data loss.
--  Apply via: supabase db push, the SQL editor, or the
--  Supabase MCP `apply_migration` tool.
-- ============================================================

-- Freeform decision journal, lives on the single config row.
alter table app_config
  add column if not exists journal text not null default '';

-- Editable outcome/notes field per catalyst (distinct from the
-- pre-written `detail`, which describes the event).
alter table catalysts
  add column if not exists note text;
