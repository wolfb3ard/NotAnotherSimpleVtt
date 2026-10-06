import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/supabase/server';
import { authCallbackPath, authNextCookie, safeAuthNext } from '@/lib/auth-redirect';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const store = await cookies();
  // Support in-flight older links while new flows use an exact callback URL.
  const safeNext = safeAuthNext(url.searchParams.get('next') ?? store.get(authNextCookie)?.value);
  store.set(authNextCookie, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: url.protocol === 'https:',
    path: authCallbackPath,
    maxAge: 0,
  });
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
