import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next') ?? '/';
  const safeNext = /^\/invite\/[a-f0-9]{48}$/.test(next) ? next : '/';
  const siteUrl = url.origin;
  const failureUrl = new URL('/login', siteUrl);
  const providerError = url.searchParams.has('error');
  failureUrl.searchParams.set('error', providerError ? 'oauth' : 'session');
  if (safeNext !== '/') failureUrl.searchParams.set('next', safeNext);
  if (code && !providerError) {
    try {
      const db = await supabaseServer();
      const { error } = await db.auth.exchangeCodeForSession(code);
      if (!error) return NextResponse.redirect(new URL(safeNext, siteUrl));
    } catch {
      // Do not expose provider errors, codes, or cookie details in the redirect.
    }
  }
  return NextResponse.redirect(failureUrl);
}
