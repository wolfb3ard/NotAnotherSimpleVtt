import { expect, it, vi } from 'vitest';
import { createDndSheet, dndId } from './dnd';
import { ResourceWriter } from './resource-writer';
import { previewResources } from './resources';

const hp = (value: number) => [{ id: dndId('hp'), value }];
const response = (value: number, revision: number) => ({
  sheet: JSON.stringify(previewResources(createDndSheet(), hp(value))),
  revision: String(revision),
});

it('serializes rapid edits with successive revisions and reconciles reconnect snapshots only when idle', async () => {
  let resolve!: (result: Record<string, string>) => void;
  const send = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    )
    .mockResolvedValueOnce(response(4, 2));
  const committed = vi.fn();
  const writer = new ResourceWriter('actor', createDndSheet(), 0, send, vi.fn(), committed);
  writer.enqueue(hp(8));
  writer.enqueue(hp(4));
  writer.sync(createDndSheet(), 99);
  expect(send).toHaveBeenCalledTimes(1);
  expect(writer.state.status).toBe('Saving');
  resolve(response(8, 1));
  await vi.waitFor(() => expect(writer.state.status).toBe('Saved'));
  expect(send.mock.calls.map(([p]) => p.revision)).toEqual([0, 1]);
  expect(committed).toHaveBeenLastCalledWith(JSON.parse(response(4, 2).sheet), 2);
  writer.sync(JSON.parse(response(6, 3).sheet), 3);
  expect(writer.state.sheet).toEqual(JSON.parse(response(6, 3).sheet));
  writer.sync(createDndSheet(), 1);
  expect(writer.state.sheet).toEqual(JSON.parse(response(6, 3).sheet));
});

it('rolls back on an unconfirmed write and retries the identical operation without double spending', async () => {
  const send = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(response(7, 1));
  const writer = new ResourceWriter('actor', createDndSheet(), 0, send, vi.fn(), vi.fn());
  writer.enqueue(hp(7));
  await vi.waitFor(() => expect(writer.state.status).toBe('Failed'));
  expect(writer.state.sheet).toEqual(createDndSheet());
  writer.sync(JSON.parse(response(7, 1).sheet), 1);
  expect(writer.state.status).toBe('Failed');
  writer.retry();
  await vi.waitFor(() => expect(writer.state.status).toBe('Saved'));
  expect(send.mock.calls[1][0]).toEqual(send.mock.calls[0][0]);
});

it('keeps revoked/stale writes failed, and explicitly discards queued intent on reload', async () => {
  const send = vi.fn().mockRejectedValue(new Error('Resource edit denied'));
  const writer = new ResourceWriter('actor', createDndSheet(), 0, send, vi.fn(), vi.fn());
  writer.enqueue(hp(5));
  await vi.waitFor(() => expect(writer.state.status).toBe('Failed'));
  writer.retry();
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  expect(writer.state.status).toBe('Failed');
  writer.discard(createDndSheet(), 3);
  expect(writer.state.status).toBe('Saved');
  send.mockResolvedValue(response(6, 4));
  writer.enqueue(hp(6));
  await vi.waitFor(() => expect(writer.state.status).toBe('Saved'));
  expect(send.mock.calls[2][0].revision).toBe(3);
  expect(send.mock.calls[2][0].operation_id).not.toBe(send.mock.calls[0][0].operation_id);
});

it('does not roll confirmed values backward when reloading an older snapshot', async () => {
  const send = vi.fn().mockResolvedValueOnce(response(8, 1)).mockResolvedValueOnce(undefined);
  const writer = new ResourceWriter('actor', createDndSheet(), 0, send, vi.fn(), vi.fn());
  writer.enqueue(hp(8));
  await vi.waitFor(() => expect(writer.state.status).toBe('Saved'));
  writer.enqueue(hp(4));
  await vi.waitFor(() => expect(writer.state.status).toBe('Failed'));
  writer.discard(createDndSheet(), 0);
  expect(writer.state.sheet).toEqual(JSON.parse(response(8, 1).sheet));
});
