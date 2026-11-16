export const tokenRings = {
  gold: { name: 'Gold', color: '#dcc39a' },
  silver: { name: 'Silver', color: '#bcc9d6' },
  emerald: { name: 'Emerald', color: '#62c798' },
  sapphire: { name: 'Sapphire', color: '#72a9ef' },
  ruby: { name: 'Ruby', color: '#e47985' },
  amethyst: { name: 'Amethyst', color: '#bc91e8' },
} as const;
export type TokenRing = keyof typeof tokenRings;

// Center-crop rather than stretching rectangular portraits.
export function portraitCrop(width: number, height: number) {
  const size = Math.min(width, height);
  return { x: (width - size) / 2, y: (height - size) / 2, width: size, height: size };
}
