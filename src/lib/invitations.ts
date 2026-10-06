function siteOrigin(value: string) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Configure NEXT_PUBLIC_SITE_URL with a valid public app URL.');
  return url;
}

function local(url: URL) {
  return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}

export function invitationUrl(token: string, requestOrigin: string) {
  const current = siteOrigin(requestOrigin);
  // Local database invitation tokens must not be sent to the production app.
  if (local(current)) return new URL(`/invite/${token}`, current.origin).href;

  const configured = process.env.NEXT_PUBLIC_SITE_URL
    ? siteOrigin(process.env.NEXT_PUBLIC_SITE_URL)
    : undefined;
  const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  let origin: string;
  if (
    process.env.VERCEL_ENV === 'production' &&
    productionHost &&
    (!configured || local(configured) || configured.hostname.endsWith('.vercel.app'))
  ) {
    // The project's production domain is public; team/deployment aliases may be protected.
    origin = siteOrigin(`https://${productionHost}`).origin;
  } else if (configured && !local(configured)) {
    origin = configured.origin;
  } else if (current.hostname.endsWith('.vercel.app')) {
    throw new Error(
      'Configure NEXT_PUBLIC_SITE_URL with your public app domain before sharing invitations.',
    );
  } else {
    origin = current.origin;
  }
  return new URL(`/invite/${token}`, origin).href;
}
