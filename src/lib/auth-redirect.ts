export const authNextCookie = 'vtt-auth-next';
export const authCallbackPath = '/auth/callback';

export function safeAuthNext(next: unknown) {
  return typeof next === 'string' && /^\/invite\/[a-f0-9]{48}$/.test(next) ? next : '/';
}
