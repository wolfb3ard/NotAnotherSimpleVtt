import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { expect, it, vi } from 'vitest';
import { GET } from './api/handouts/[id]/route';

const { lookup } = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: () => {
    const query = { eq: () => query, maybeSingle: lookup };
    return { from: () => ({ select: () => query }) };
  },
}));

it('rechecks the same handout URL after revocation and never caches the bytes', async () => {
  const id = randomUUID();
  const open = () =>
    GET(new Request(`https://table.test/api/handouts/${id}`), { params: Promise.resolve({ id }) });
  const image = await sharp({ create: { width: 1, height: 1, channels: 3, background: 'black' } })
    .png()
    .toBuffer();
  lookup
    .mockResolvedValueOnce({ data: { image: '\\x' + image.toString('hex') } })
    .mockResolvedValueOnce({ data: null });
  const response = await open();
  expect(response.status).toBe(200);
  expect(response.headers.get('Content-Type')).toBe('image/webp');
  expect(response.headers.get('Cache-Control')).toContain('no-store');
  const revoked = await open();
  expect(revoked.status).toBe(404);
  expect(await revoked.text()).toBe('');
});
