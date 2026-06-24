alter table design_assets
  add column if not exists files jsonb not null default '[]'::jsonb;
