import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next') ?? '/';
  const safeNext = /^\/invite\/[a-f0-9]{48}$/.test(next) ? next : '/';
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL && !process.env.NEXT_PUBLIC_SITE_URL.includes('localhost')
      ? process.env.NEXT_PUBLIC_SITE_URL
      : url.origin;
  if (code) {
    const db = await supabaseServer();
    const { error } = await db.auth.exchangeCodeForSession(code);
    if (!error)
      return NextResponse.redirect(
        new URL(safeNext, siteUrl),
      );
  }
  return NextResponse.redirect(
    new URL('/login?error=expired', siteUrl),
  );
}
