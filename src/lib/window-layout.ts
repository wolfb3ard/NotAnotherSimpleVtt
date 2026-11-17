import { z } from 'zod';

const geometry = z.object({
  left: z.number(),
  top: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  maximized: z.boolean(),
});
export type Geometry = z.infer<typeof geometry>;
export type WindowKind = 'sheet' | 'roll';
const layout = z.object({
  detached: z.boolean(),
  actor: z.string().optional(),
  sheet: geometry.optional(),
  roll: geometry.optional(),
});
export type WindowLayout = z.infer<typeof layout>;

export function loadLayout(key: string): WindowLayout {
  try {
    return layout.parse(JSON.parse(localStorage.getItem(key) ?? 'null'));
  } catch {
    return { detached: false };
  }
}

export function fitWindow(kind: WindowKind, vw: number, vh: number, saved?: Geometry): Geometry {
  const sheet = kind === 'sheet';
  const maxW = Math.max(1, vw - 16);
  const maxH = Math.max(1, vh - 16);
  const width = Math.min(
    maxW,
    Math.max(sheet ? 460 : 320, saved?.width ?? (sheet ? Math.min(1320, vw - 64) : 440)),
  );
  const height = Math.min(maxH, Math.max(220, saved?.height ?? Math.min(850, vh - 90)));
  return {
    width,
    height,
    left: Math.max(8, Math.min(saved?.left ?? (sheet ? 24 : 40), vw - width - 8)),
    top: Math.max(8, Math.min(saved?.top ?? (sheet ? 65 : 80), vh - height - 8)),
    maximized: saved?.maximized ?? false,
  };
}
