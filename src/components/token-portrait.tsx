import { tokenRings, type TokenRing } from '@/lib/token-appearance';

export function TokenPortrait({
  name,
  assetId,
  ring = 'gold',
  preview,
}: {
  name: string;
  assetId?: string | null;
  ring?: TokenRing;
  preview?: string;
}) {
  const src = preview ?? (assetId ? `/api/images/${assetId}` : undefined);
  return (
    <span className="token-portrait" style={{ borderColor: tokenRings[ring].color }}>
      {src ? (
        // Private, authenticated images are deliberately not sent through the image optimizer.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={`${name} token portrait`} />
      ) : (
        name.slice(0, 2).toUpperCase()
      )}
    </span>
  );
}
