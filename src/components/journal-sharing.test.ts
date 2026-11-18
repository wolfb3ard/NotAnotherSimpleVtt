// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { JournalSharing } from './journal-sharing';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it('names the pending visibility change and submits the selected audience', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const action = vi.fn<(form: FormData) => Promise<{ success: string }>>();
  action.mockResolvedValue({ success: 'Entry updated.' });
  try {
    await act(async () =>
      root.render(
        createElement(JournalSharing, {
          entry: 'entry',
          current: 'party',
          members: [{ user_id: 'player', display_name: 'Rowan' }],
          action,
        }),
      ),
    );
    const select = container.querySelector('select')!;
    const button = container.querySelector('button')!;
    expect(button.disabled).toBe(true);
    async function selectAudience(value: string) {
      await act(async () => {
        select.value = value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }
    await selectAudience('private');
    expect(button.textContent).toBe('Make GM-only');
    await selectAudience('player');
    expect(button.textContent).toBe('Share with Rowan');
    await act(async () => button.click());
    expect([...action.mock.calls[0][0].entries()]).toEqual([
      ['entry', 'entry'],
      ['audience', 'player'],
    ]);
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Entry updated.');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
