import 'server-only';
import { createClient } from '@supabase/supabase-js';

export function supabaseAdmin() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
    throw new Error('Server storage credentials are not configured.');
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );
}
