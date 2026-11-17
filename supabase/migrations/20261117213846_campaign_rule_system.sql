alter table public.games add column rule_system text not null default 'dnd-2024-srd-5.2.1'
  check (rule_system in ('dnd-2024-srd-5.2.1'));
