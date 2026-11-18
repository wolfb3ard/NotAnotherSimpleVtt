// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { Room } from './room';
import { createDndSheet, dndId } from '@/lib/dnd';
import type { Snapshot } from '@/lib/types';
import { monsterSourceId } from '@/lib/monster-sheet';

const { roll, mutate } = vi.hoisted(() => ({ roll: vi.fn(), mutate: vi.fn() }));
vi.mock('@/app/actions', () => ({ roll, mutate, uploadAsset: vi.fn() }));
vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('@/lib/supabase/browser', () => ({
  supabaseBrowser: () => ({
    channel: () => {
      const channel = { on: () => channel, subscribe: () => channel };
      return channel;
    },
    removeChannel: vi.fn(),
  }),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

it('defaults GM monster sheet rolls to private while keeping an explicit public override', async () => {
  const snapshot: Snapshot = {
    userId: 'gm',
    role: 'gm',
    game: { id: 'game', name: 'Game', gm_id: 'gm', active_scene_id: null, dice: [20] },
    actors: [
      {
        id: 'monster',
        game_id: 'game',
        owner_id: 'gm',
        name: 'Aboleth 1',
        kind: 'enemy',
        revision: 0,
        sheet: {
          version: 1,
          sections: [
            {
              id: 'source',
              title: 'Source',
              abilities: [],
              fields: [
                {
                  id: monsterSourceId,
                  label: 'SRD monster ID',
                  kind: 'text',
                  value: 'monster-aboleth',
                },
              ],
            },
          ],
        },
      },
    ],
    grants: [],
    tokens: [],
    members: [],
    scenes: [],
    templates: [],
    rolls: [],
    rollCues: [],
    diceStyles: [],
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => snapshot })),
  );
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(Room, { initial: snapshot })));
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('[aria-label="Open Aboleth 1 character sheet"]')!
      .click(),
  );
  const visibility = container.querySelector<HTMLSelectElement>(
    '[aria-label="Quick roll visibility"]',
  )!;
  expect(visibility.value).toBe('private');
  await act(async () => {
    visibility.value = 'public';
    visibility.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(visibility.value).toBe('public');
});

it('routes both full-scene fog controls through the shared reversible operation queue', async () => {
  const scene = {
    id: 'scene',
    game_id: 'game',
    name: 'Map',
    asset_id: 'asset',
    width: 200,
    height: 200,
    fog: [],
    revision: 0,
    units_per_pixel: 1,
    unit: 'ft',
  };
  const snapshot: Snapshot = {
    userId: 'gm',
    role: 'gm',
    game: { id: 'game', name: 'Game', gm_id: 'gm', active_scene_id: 'scene', dice: [20] },
    actors: [],
    grants: [],
    tokens: [],
    members: [],
    scenes: [scene],
    templates: [],
    rolls: [],
    rollCues: [],
    diceStyles: [],
  };
  mutate.mockResolvedValue({ data: { history: '[]' } });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => snapshot })),
  );
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(Room, { initial: snapshot })));
  const button = (name: string) =>
    [...container.querySelectorAll('button')].find((b) => b.textContent === name)!;
  await act(async () => button('Scenes').click());
  for (const name of ['Reveal entire scene', 'Conceal entire scene']) {
    await act(async () => button(name).click());
    expect(mutate).toHaveBeenLastCalledWith(
      'game',
      'tabletop_fog',
      expect.objectContaining({
        id: 'scene',
        scene_id: 'scene',
        revision: 0,
        operation_id: expect.any(String),
        fog: name.startsWith('Reveal')
          ? [{ x: 0, y: 0, width: 200, height: 200, reveal: true }]
          : [],
      }),
    );
  }
  expect(mutate.mock.calls.filter(([, command]) => command === 'scene_update')).toHaveLength(0);
});

it.each(['public', 'private'] as const)(
  'submits %s sheet rolls immediately, ignores manual modifiers, prevents concurrent requests and keeps the sheet open',
  async (visibility) => {
    const snapshot: Snapshot = {
      userId: 'owner',
      role: 'player',
      game: { id: 'game', name: 'Game', gm_id: 'gm', active_scene_id: null, dice: [20] },
      actors: [
        {
          id: 'actor',
          game_id: 'game',
          owner_id: 'owner',
          name: 'Hero',
          kind: 'character',
          sheet: createDndSheet(),
          revision: 0,
        },
      ],
      grants: [],
      tokens: [],
      members: [],
      scenes: [],
      templates: [],
      rolls: [],
      rollCues: [],
      diceStyles: [],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => snapshot })),
    );
    const container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(createElement(Room, { initial: snapshot })));
    const diceTab = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Dice',
    )!;
    await act(async () => diceTab.click());
    const modifier = [...container.querySelectorAll('label')]
      .find((label) => label.textContent?.trim() === 'Extra modifier')!
      .querySelector('input')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        modifier,
        '99',
      );
      modifier.dispatchEvent(new Event('input', { bubbles: true }));
      const select = [...container.querySelectorAll('select')].find((s) =>
        s.parentElement?.textContent?.includes('Visibility'),
      )!;
      select.value = visibility;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="My character"]')!.click(),
    );
    const quickVisibility = container.querySelector<HTMLSelectElement>(
      '[aria-label="Quick roll visibility"]',
    )!;
    expect(quickVisibility.value).toBe(visibility);
    await act(async () => {
      quickVisibility.value = visibility === 'public' ? 'private' : 'public';
      quickVisibility.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => {
      quickVisibility.value = visibility;
      quickVisibility.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const diceVisibility = [...container.querySelectorAll('select')].find((select) =>
      select.parentElement?.textContent?.includes('Visibility'),
    )!;
    expect(diceVisibility.value).toBe(visibility);
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="My character"]')!.click(),
    );
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    let finish!: (result: { error: string }) => void;
    roll.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const attack = container.querySelector<HTMLButtonElement>('[aria-label="Roll Attack roll"]')!;
    await act(async () => {
      attack.click();
      attack.click();
    });
    expect(roll).toHaveBeenCalledTimes(1);
    expect(roll).toHaveBeenCalledWith('game', {
      id: expect.any(String),
      actor_id: 'actor',
      expression: `1d20 + @{${dndId('weapon-total:0')}}`,
      roll_type: 'Attack roll with Longsword',
      visibility,
    });
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => finish({ error: 'Roll rejected' }));
    expect(container.querySelector('[role="dialog"]')!.textContent).toContain('Roll rejected');
  },
);

it('guards shortcut sheet switches and removes shortcuts when refreshed ownership/access changes', async () => {
  let snapshot: Snapshot = {
    userId: 'owner',
    role: 'player',
    game: { id: 'game', name: 'Game', gm_id: 'gm', active_scene_id: null, dice: [20] },
    actors: ['Aria', 'Bryn'].map((name) => ({
      id: name,
      name,
      game_id: 'game',
      owner_id: 'owner',
      kind: 'character',
      revision: 0,
      sheet: createDndSheet(),
    })),
    grants: [],
    tokens: [],
    members: [],
    scenes: [],
    templates: [],
    rolls: [],
    rollCues: [],
    diceStyles: [],
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => snapshot })),
  );
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(Room, { initial: snapshot })));
  const choose = async (value: string) => {
    const select = container.querySelector<HTMLSelectElement>('[aria-label="My character"]')!;
    await act(async () => {
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
  };
  await choose('Aria');
  await act(async () =>
    [...container.querySelectorAll('button')]
      .find((b) => b.textContent === 'Edit character')!
      .click(),
  );
  const name = container.querySelector<HTMLInputElement>('input[aria-label="Name"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      name,
      'Draft Aria',
    );
    name.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  await choose('Bryn');
  expect(confirm).toHaveBeenCalledWith(
    'Discard unsaved character sheet changes and open another sheet?',
  );
  expect(container.querySelector('.sheet-window-header h2')!.textContent).toBe('Aria');
  expect(container.querySelector<HTMLInputElement>('input[aria-label="Name"]')!.value).toBe(
    'Draft Aria',
  );
  confirm.mockReturnValue(true);
  await choose('Bryn');
  expect(container.querySelector('.sheet-window-header h2')!.textContent).toBe('Bryn');
  snapshot = { ...snapshot, actors: [{ ...snapshot.actors[0], owner_id: 'other' }] };
  await act(async () => window.dispatchEvent(new Event('online')));
  expect(container.querySelector('.sheet-window')).toBeNull();
  expect(container.querySelector('[aria-label="My character"]')).toBeNull();
  expect(container.querySelector('.room-shortcuts')!.textContent).toContain(
    'Create a character in Party or ask the GM to assign one.',
  );
});

it('pops out, moves, maximizes and docks one shared dice panel without losing roll settings', async () => {
  const snapshot: Snapshot = {
    userId: 'owner',
    role: 'player',
    game: { id: 'game', name: 'Game', gm_id: 'gm', active_scene_id: null, dice: [6, 20] },
    actors: [],
    grants: [],
    tokens: [],
    members: [],
    scenes: [],
    templates: [],
    rollCues: [],
    diceStyles: [],
    rolls: [
      {
        id: 'historical',
        game_id: 'game',
        author_id: 'owner',
        author_name: 'Player',
        actor_id: null,
        actor_name: 'Deleted hero',
        roll_type: 'Athletics check',
        expression: '1d20',
        visibility: 'public',
        created_at: new Date().toISOString(),
        result: { total: 12, resolvedExpression: '1d20', dice: [], modifiers: {} },
      },
    ],
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => snapshot })),
  );
  roll.mockResolvedValue({ success: true });
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(Room, { initial: snapshot })));
  const click = async (label: string) =>
    act(async () => {
      [...container.querySelectorAll('button')]
        .find((b) => b.getAttribute('aria-label') === label || b.textContent === label)!
        .click();
    });
  await click('Dice');
  expect(container.querySelector('.roll-card')!.textContent).toContain('Deleted hero');
  expect(container.querySelector('.roll-card')!.textContent).toContain('Athletics check');
  const labelInput = (label: string) =>
    [...container.querySelectorAll('label')]
      .find((l) => l.firstChild?.textContent?.trim() === label)!
      .querySelector('input')!;
  await act(async () => {
    for (const [label, value] of [
      ['Expression', '2d6'],
      ['Roll type', 'Fire damage'],
    ]) {
      const input = labelInput(label);
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const visibility = [...container.querySelectorAll('select')].find((s) =>
      s.parentElement?.textContent?.includes('Visibility'),
    )!;
    visibility.value = 'private';
    visibility.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await click('Pop out roll window');
  const dialog = container.querySelector<HTMLElement>('.roll-window')!;
  expect(dialog.getAttribute('aria-modal')).toBe('false');
  expect(document.activeElement).toBe(dialog);
  await act(async () => {
    dialog
      .querySelector('[aria-label="Move roll window"]')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  });
  expect(dialog.style.left).toBe('60px');
  await click('Maximize roll window');
  expect(dialog.classList.contains('is-maximized')).toBe(true);
  await click('Restore roll window');
  expect(dialog.classList.contains('is-maximized')).toBe(false);
  await click('Party');
  expect(container.querySelectorAll('.roll-window')).toHaveLength(1);
  expect(labelInput('Expression').value).toBe('2d6');
  await click('◇ Roll dice');
  expect(roll).toHaveBeenCalledExactlyOnceWith('game', {
    id: expect.any(String),
    actor_id: null,
    expression: '2d6',
    visibility: 'private',
    roll_type: 'Fire damage',
  });
  await act(async () => {
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  expect(container.querySelector('.roll-window')).toBeNull();
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Pop out roll window');
  expect(labelInput('Expression').value).toBe('2d6');
  expect(labelInput('Roll type').value).toBe('Fire damage');
  expect(container.querySelectorAll('.roll-button')).toHaveLength(1);
});

it('restores a resized roll window after remount, isolates rooms and users, and resets the layout', async () => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
  });
  const snapshot: Snapshot = {
    rollCues: [],
    diceStyles: [],
    userId: 'owner',
    role: 'player',
    game: { id: 'game', name: 'Game', gm_id: 'gm', active_scene_id: null, dice: [20] },
    actors: [],
    grants: [],
    tokens: [],
    scenes: [],
    templates: [],
    rolls: [],
    members: [],
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => snapshot })),
  );
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  const render = (initial: Snapshot) =>
    act(async () => root.render(createElement(Room, { initial })));
  const click = async (label: string) =>
    act(async () =>
      [...container.querySelectorAll('button')]
        .find((b) => b.textContent === label || b.getAttribute('aria-label') === label)!
        .click(),
    );
  const dialog = () => container.querySelector<HTMLElement>('.roll-window');
  await render(snapshot);
  await click('Dice');
  await click('Pop out roll window');
  await act(async () =>
    dialog()!
      .querySelector('[aria-label="Resize roll window"]')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })),
  );
  const width = dialog()!.style.width;
  expect(width).toBe('460px');
  await render({ ...snapshot, userId: 'other' });
  expect(dialog()).toBeNull();
  await render({ ...snapshot, game: { ...snapshot.game, id: 'another' } });
  expect(dialog()).toBeNull();
  await render(snapshot);
  expect(dialog()?.style.width).toBe(width);
  await click('Settings');
  expect(container.querySelector('[aria-label="Window layout"]')?.textContent).toContain(
    'Reset window positions',
  );
  await click('Reset window positions');
  expect(dialog()).toBeNull();
  await click('Dice');
  await click('Pop out roll window');
  expect(dialog()?.style.width).toBe('440px');
});

it('creates a system sheet without selecting a saved template or opening the builder by default', async () => {
  const template = {
    id: 'mine',
    game_id: 'game',
    creator_id: 'owner',
    name: 'Scout',
    sheet: createDndSheet(),
  };
  const snapshot: Snapshot = {
    userId: 'owner',
    role: 'player',
    game: { id: 'game', name: 'Game', gm_id: 'gm', active_scene_id: null, dice: [20] },
    actors: [],
    grants: [],
    tokens: [],
    scenes: [],
    templates: [template, { ...template, id: 'other', creator_id: 'gm' }],
    rolls: [],
    members: [],
    rollCues: [],
    diceStyles: [],
  };
  mutate.mockResolvedValue({ data: {} });
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(Room, { initial: snapshot })));
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Create character"]')!.click(),
  );
  const name = container.querySelector<HTMLInputElement>('input[name="name"]')!;
  const form = name.form!;
  expect(form.querySelector('[name="template"]')).toBeNull();
  expect(form.querySelector<HTMLInputElement>('[name="guided"]')?.checked).toBe(false);
  name.value = 'Aria';
  await act(async () => form.querySelector('button')!.click());
  expect(mutate).toHaveBeenCalledWith('game', 'actor_create', {
    name: 'Aria',
    kind: 'character',
    owner_id: 'owner',
    sheet: createDndSheet(),
  });
});

it('clears a deleted roll target and permits another manual roll without reloading', async () => {
  let snapshot: Snapshot = {
    userId: 'owner',
    role: 'player',
    game: { id: 'game', name: 'Game', gm_id: 'gm', active_scene_id: null, dice: [20] },
    actors: [
      {
        id: 'actor',
        game_id: 'game',
        owner_id: 'owner',
        name: 'Hero',
        kind: 'character',
        revision: 0,
        sheet: createDndSheet(),
      },
    ],
    grants: [],
    tokens: [],
    members: [],
    scenes: [],
    templates: [],
    rolls: [],
    rollCues: [],
    diceStyles: [],
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => snapshot })),
  );
  mutate.mockResolvedValue({ data: {} });
  roll.mockResolvedValue({ success: true });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(Room, { initial: snapshot })));
  const click = async (label: string) =>
    act(async () => {
      [...container.querySelectorAll('button')].find((b) => b.textContent === label)!.click();
    });
  await click('Dice');
  const target = [...container.querySelectorAll('select')].find((s) =>
    s.parentElement?.textContent?.includes('Roll for'),
  )!;
  await act(async () => {
    target.value = 'actor';
    target.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await click('Party');
  await act(async () =>
    container
      .querySelector('.actor-card')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true })),
  );
  snapshot = { ...snapshot, actors: [] };
  await click('Delete character');
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  await click('Dice');
  await click('◇ Roll dice');
  expect(roll).toHaveBeenCalledExactlyOnceWith(
    'game',
    expect.objectContaining({
      actor_id: null,
      expression: '1d20',
      roll_type: 'Manual roll',
    }),
  );
});

it('opens the builder only when requested on creation, not on later sheet opens', async () => {
  let snapshot: Snapshot = {
    userId: 'owner',
    role: 'player',
    game: { id: 'game', name: 'Game', gm_id: 'gm', active_scene_id: null, dice: [20] },
    actors: [],
    grants: [],
    tokens: [],
    members: [],
    scenes: [],
    templates: [],
    rolls: [],
    rollCues: [],
    diceStyles: [],
  };
  const oldShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
  try {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => snapshot })),
    );
    mutate.mockImplementation(async (_game, command, payload) => {
      expect(command).toBe('actor_create');
      snapshot = {
        ...snapshot,
        actors: [
          {
            id: 'new-hero',
            game_id: 'game',
            owner_id: 'owner',
            kind: 'character',
            name: payload.name,
            sheet: payload.sheet,
            revision: 0,
          },
        ],
      };
      return { data: { id: 'new-hero' } };
    });
    const container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(createElement(Room, { initial: snapshot })));
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Create character"]')!.click(),
    );
    container.querySelector<HTMLInputElement>('input[name="guided"]')!.checked = true;
    container.querySelector<HTMLInputElement>('input[name="name"]')!.value = 'New hero';
    await act(async () =>
      container
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    );
    expect(container.querySelector('dialog')?.open).toBe(true);
    expect(container.querySelector('dialog')?.textContent).toContain('Origin & ability generation');
    await act(async () =>
      [...container.querySelectorAll('button')]
        .find((b) => b.textContent === 'Cancel draft')!
        .click(),
    );
    expect(container.querySelector('dialog')).toBeNull();
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Close character sheet"]')!.click(),
    );
    await act(async () =>
      container
        .querySelector('.actor-card')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true })),
    );
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(container.querySelector('dialog')).toBeNull();
  } finally {
    if (oldShowModal) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', oldShowModal);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  }
});
