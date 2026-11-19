// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SheetWindow } from './sheet-window';
import { ActorCard } from './actor-card';
import { createDndSheet, dndId } from '@/lib/dnd';
import { sheetSchema } from '@/lib/sheets';
import type { Actor, Snapshot } from '@/lib/types';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let container: HTMLDivElement;
function fixture(gm = false) {
  const actor: Actor = {
    id: 'actor',
    game_id: 'game',
    owner_id: 'owner',
    name: 'Aria',
    kind: 'character',
    sheet: createDndSheet(),
    revision: 0,
  };
  const snapshot: Snapshot = {
    userId: gm ? 'gm' : 'owner',
    role: gm ? 'gm' : 'player',
    game: {
      id: 'game',
      name: 'Game',
      gm_id: 'gm',
      active_scene_id: null,
      dice: [4, 6, 8, 10, 12, 20],
    },
    actors: [actor],
    grants: [],
    tokens: [],
    scenes: [],
    templates: [],
    rolls: [],
    rollCues: [],
    diceStyles: [],
    members: [
      { user_id: 'gm', role: 'gm', display_name: 'GM' },
      { user_id: 'owner', role: 'player', display_name: 'Owner' },
      { user_id: 'viewer', role: 'player', display_name: 'Viewer' },
    ],
  };
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  const run = vi.fn<Parameters<typeof SheetWindow>[0]['run']>(async () => ({}));
  const onRoll = vi.fn();
  const onClose = vi.fn();
  const render = async (initialBuilderOpen = false) => {
    await act(async () =>
      root.render(
        createElement(SheetWindow, { actor, snapshot, run, onRoll, onClose, initialBuilderOpen }),
      ),
    );
  };
  return { actor, snapshot, run, onRoll, onClose, render };
}
function button(label: string) {
  return container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
}
async function click(element: HTMLElement) {
  await act(async () => element.click());
}
async function select(label: string, value: string) {
  const element = container.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
  await act(async () => {
    element.value = value;
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
async function typeName(value: string) {
  const edit = [...container.querySelectorAll('button')].find(
    (b) => b.textContent === 'Edit character',
  );
  if (edit) await click(edit);
  await typeField('Name', value);
}
async function typeField(label: string, value: string) {
  const element = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `input[aria-label="${label}"], textarea[aria-label="${label}"]`,
  )!;
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function textButton(label: string) {
  return [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent === label,
  )!;
}
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('character sheet window', () => {
  it('offers a recovery download instead of saving a sheet that failed its upgrade', async () => {
    const { actor, render, run } = fixture();
    actor.sheetUpgradeIssue = 'Level must be 1–20.';
    await render();
    expect(container.querySelector('[role="alert"]')!.textContent).toContain(
      actor.sheetUpgradeIssue,
    );
    expect(textButton('Download original sheet')).toBeDefined();
    expect(textButton('Save sheet')).toBeUndefined();
    expect(run).not.toHaveBeenCalled();
  });
  it('saves edits to a legacy character, including custom fields and abilities', async () => {
    const { actor, render, run } = fixture();
    actor.revision = 7;
    const section = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      title: 'Campaign notes',
      fields: [
        {
          id: '550e8400-e29b-41d4-a716-446655440001',
          label: 'Faction',
          kind: 'text' as const,
          value: 'Scouts',
        },
      ],
      abilities: [
        {
          id: '550e8400-e29b-41d4-a716-446655440002',
          name: 'Scout signal',
          description: 'Signal the scouts',
          expression: '1d20',
        },
      ],
    };
    actor.sheet.sections.push(section);
    await render();
    await typeName('Aria the scout');
    await typeField('Class / subclass', 'Ranger');
    await click(textButton('Biography'));
    await typeField('Family & history', 'Grew up among scouts.');

    await click(container.querySelector('.sheet-tools > summary')!);
    await click(textButton('Customize sheet'));
    await typeField('Faction', 'Rangers');
    await typeField('Scout signal expression', '1d20 + 2');
    await click(textButton('Save sheet'));

    const expected = structuredClone(actor.sheet);
    expected.sections[0].fields.find((f) => f.id === dndId('class'))!.value = 'Ranger';
    const custom = expected.sections.at(-1)!;
    custom.fields[0].value = 'Rangers';
    custom.abilities[0].expression = '1d20 + 2';
    expected.character = {
      spells: [],
      items: [],
      features: [],
      biography: { physical: '', personality: '', history: 'Grew up among scouts.' },
    };
    expect(run).toHaveBeenCalledExactlyOnceWith('actor_save', {
      id: actor.id,
      revision: 7,
      name: 'Aria the scout',
      sheet: expected,
    });
    expect(sheetSchema.safeParse(expected).success).toBe(true);
    expect(container.querySelector('.sheet-save-status')!.textContent).toBe('All changes saved');
    expect(section.fields[0].value).toBe('Scouts');
    await click(textButton('Back to character sheet'));
    expect(container.querySelector('.dnd-identity h2')!.textContent).toBe('Aria the scout');
  });
  it('keeps the creation builder accessible when a new sheet opens', async () => {
    const previous = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true,
      value: vi.fn(),
    });
    const { render } = fixture();
    try {
      await render(true);
      expect(container.querySelector<HTMLDetailsElement>('.sheet-tools')!.open).toBe(true);
      expect(container.textContent).toContain('Apply');
    } finally {
      if (previous) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', previous);
      else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
    }
  });
  it('shows revision conflicts even with settings collapsed', async () => {
    const { actor, render } = fixture();
    await render();
    await typeName('Unsaved name');
    actor.revision++;
    await render();
    const notice = container.querySelector('[role="alert"]')!;
    expect(notice.textContent).toContain('Reload sheet');
    expect(notice.closest('details')).toBeNull();
    expect(button('Roll Strength check').disabled).toBe(true);
  });
  it('keeps the sheet free of the removed play resources section', async () => {
    const { render, run } = fixture();
    await render();
    expect(container.querySelector('[aria-label="Play resources"]')).toBeNull();
    expect(container.querySelector('[aria-label="Quick resources"]')).toBeNull();
    expect(container.querySelector('input[aria-label="Quick Hit Points"]')).toBeNull();
    expect(container.querySelector('.sheet-save-status')!.textContent).toBe('All changes saved');
    expect(button('Roll Strength check').disabled).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });
  it('guards closing a sheet with a failed or unconfirmed resource update', async () => {
    const { actor, render, onClose } = fixture();
    const slot = actor.sheet.sections
      .flatMap((s) => s.fields)
      .find((f) => f.id === dndId('slot:0'))!;
    slot.max = 1;
    slot.value = 1;
    await render();
    await click(
      [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
        (b) => b.textContent === 'Spell',
      )!,
    );
    await click(
      [...container.querySelectorAll('button')].find((b) => b.textContent === 'Use level 1 slot')!,
    );
    expect(container.textContent).toContain('Resources: Failed');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await click(button('Close character sheet'));
    expect(confirm).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    await click(button('Close character sheet'));
    expect(onClose).toHaveBeenCalledOnce();
  });
  it('opens play-first with collapsed tools, readable identity and one set of quick checks', async () => {
    const { render } = fixture();
    await render();
    expect(container.querySelector<HTMLDetailsElement>('.sheet-tools')!.open).toBe(false);
    expect(container.querySelector('.dnd-identity h2')!.textContent).toBe('Aria');
    expect(container.querySelector('.dnd-identity .token-portrait')).not.toBeNull();
    expect(container.querySelector('input[aria-label="Name"]')).toBeNull();
    expect(container.querySelectorAll('[aria-label="Roll Strength check"]')).toHaveLength(1);
    expect(container.querySelector('.attack-configuration')).toBeNull();
    expect(container.querySelector('.sheet-save-status')!.textContent).toBe('All changes saved');
  });
  it('shows resource summaries during play and exposes configuration only when editing', async () => {
    const { actor, render } = fixture();
    actor.sheet.sections
      .flatMap((section) => section.fields)
      .find((field) => field.id === dndId('level'))!.value = 5;
    await render();
    expect(container.querySelector('output[aria-label="Hit Points"]')!.textContent).toBe('10');
    expect(container.querySelector('input[aria-label="Hit Points maximum"]')).toBeNull();
    const edit = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Edit character',
    )!;
    await click(edit);
    expect(container.querySelector('input[aria-label="Hit Points maximum"]')).not.toBeNull();
    expect(container.querySelector('input[aria-label="Name"]')).not.toBeNull();
    const proficiency = container.querySelector<HTMLInputElement>(
      'input[aria-label="Proficiency bonus"]',
    )!;
    expect(proficiency.disabled).toBe(true);
    expect(proficiency.value).toBe('3');
    expect(container.querySelector<HTMLDetailsElement>('.attack-configuration')!.open).toBe(true);
    await typeName('Renamed');
    await click(
      [...container.querySelectorAll('button')].find((b) => b.textContent === 'Done editing')!,
    );
    expect(container.querySelector('.dnd-identity h2')!.textContent).toBe('Renamed');
    expect(container.querySelector('.sheet-save-status')!.textContent).toBe('Unsaved changes');
    expect(button('Roll Strength check').disabled).toBe(true);
  });
  it('hides unequipped attacks during play but exposes their configuration in edit mode', async () => {
    const { actor, render } = fixture();
    actor.sheet.sections
      .flatMap((section) => section.fields)
      .find((field) => field.id === dndId('weapon-name:1'))!.value = 'Unequipped';
    await render();
    expect(container.querySelectorAll('.dnd-attack')).toHaveLength(2);
    await click(
      [...container.querySelectorAll('button')].find((b) => b.textContent === 'Edit character')!,
    );
    expect(container.querySelectorAll('.dnd-attack')).toHaveLength(3);
  });
  it('keeps a compact card; opens on one click or keyboard activation', async () => {
    const { actor } = fixture();
    const open = vi.fn();
    await act(async () =>
      root.render(createElement(ActorCard, { actor, ownerName: 'Owner', onOpen: open })),
    );
    const card = button('Open Aria character sheet');
    await click(card);
    expect(open).toHaveBeenCalledTimes(1);
    for (const key of ['Enter', ' '])
      await act(async () => {
        card.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      });
    expect(open).toHaveBeenCalledTimes(3);
    expect(container.querySelector('input')).toBeNull();
  });
  it('opens a named non-modal sheet, supports maximize/restore, keyboard movement, and Escape', async () => {
    const { render, onClose } = fixture();
    await render();
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-modal')).toBe('false');
    expect(document.activeElement).toBe(dialog);
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent).toBe(
      'Aria',
    );
    await act(async () => {
      container
        .querySelector('[aria-label="Move character sheet window"]')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(dialog.style.left).toBe('44px');
    await click(button('Maximize sheet window'));
    expect(dialog.classList.contains('is-maximized')).toBe(true);
    await click(button('Restore sheet window'));
    expect(dialog.classList.contains('is-maximized')).toBe(false);
    await act(async () => {
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it('confirms dirty close, blocks unsaved rolls, and retains edits when discard is cancelled', async () => {
    const { render, onClose } = fixture();
    await render();
    await typeName('Changed hero');
    expect(button('Roll Strength check').disabled).toBe(true);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await click(button('Close character sheet'));
    expect(confirm).toHaveBeenCalledWith('Discard unsaved character sheet changes?');
    expect(onClose).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Name"]')!.value).toBe(
      'Changed hero',
    );
    confirm.mockReturnValue(true);
    await click(button('Close character sheet'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it('rolls with advantage without closing the sheet', async () => {
    const { render, onRoll, onClose } = fixture();
    await render();
    await select('Sheet roll mode', 'advantage');
    await click(button('Roll Strength check'));
    expect(onRoll).toHaveBeenCalledWith(
      'actor',
      `2d20kh1 + @{${dndId('check:0')}}`,
      'Strength check',
    );
    expect(onClose).not.toHaveBeenCalled();
  });
  it('allows the GM to set view-only access and transfer ownership with a revision', async () => {
    const { render, run } = fixture(true);
    await render();
    await select('Viewer sheet access', 'view');
    expect(run).toHaveBeenCalledWith('grant', {
      actor_id: 'actor',
      user_id: 'viewer',
      access: 'view',
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await select('Sheet owner', 'viewer');
    expect(run).toHaveBeenCalledWith('actor_owner', {
      actor_id: 'actor',
      owner_id: 'viewer',
      revision: 0,
    });
  });
  it('makes a viewer read-only and omits GM access controls', async () => {
    const { render, snapshot, onRoll } = fixture();
    snapshot.userId = 'viewer';
    snapshot.grants = [{ actor_id: 'actor', user_id: 'viewer', can_edit: false }];
    await render();
    expect(container.querySelector('output[aria-label="Strength"]')).not.toBeNull();
    expect(
      [...container.querySelectorAll('button')].some((b) => b.textContent === 'Edit character'),
    ).toBe(false);
    expect(button('Roll Strength check').disabled).toBe(true);
    await click(button('Roll Strength check'));
    expect(onRoll).not.toHaveBeenCalled();
    expect(container.querySelector('[aria-label="Sheet owner"]')).toBeNull();
    await click(container.querySelector('.sheet-tools > summary')!);
    await click(textButton('Customize sheet'));
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Name"]')!.disabled).toBe(
      true,
    );
    expect(textButton('Save sheet')).toBeUndefined();
  });
  it('confirms deletion and submits the saved revision only for the owner', async () => {
    const { render, run } = fixture();
    await render();
    const remove = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Delete character',
    )!;
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await click(remove);
    expect(run).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    await click(remove);
    expect(run).toHaveBeenCalledExactlyOnceWith('actor_delete', { id: 'actor', revision: 0 });
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('cannot be undone'));
  });
  it('does not show deletion to a sheet editor or token controller', async () => {
    const { render, snapshot } = fixture();
    snapshot.userId = 'viewer';
    snapshot.grants = [{ actor_id: 'actor', user_id: 'viewer', can_edit: true }];
    await render();
    expect(container.textContent).toContain('Can edit');
    expect(container.textContent).not.toContain('Delete character');
  });
});
