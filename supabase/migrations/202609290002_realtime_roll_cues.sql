-- Only sanitized cues (never the rolls table) are sent directly to clients.
alter publication supabase_realtime add table public.roll_cues;
