// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DndSheet } from './dnd-sheet';
import { createDndSheet, dndId } from '@/lib/dnd';
import { emptyCharacterDetails, rarities } from '@/lib/character-details';
import { sheetSchema } from '@/lib/sheets';
import type { Sheet } from '@/lib/types';
import { applySrdBuilder } from '@/lib/srd-engine';
import { classBuilder, fighterBuilder } from '@/lib/srd-test-fixtures';
import { blankFeat } from '@/lib/srd-state';
import { srdEntry } from '@/lib/srd-catalog';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let container: HTMLDivElement;
async function fixture(initial = createDndSheet(), editable = true) {
  let current = initial;
  const onRoll = vi.fn();
  function Harness() {
    const [sheet, setSheet] = useState(initial);
    return createElement(DndSheet, {
      name: 'Hero',
      onNameChange: () => {},
      sheet,
      editable,
      rollable: editable,
      dirty: false,
      onRoll,
      update: (edit: (copy: Sheet) => void) => {
        const copy = structuredClone(sheet);
        edit(copy);
        current = copy;
        setSheet(copy);
      },
    });
  }
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(Harness)));
  return { current: () => current, onRoll };
}
const button = (text: string) =>
  [...container.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === text)!;
const panel = () => container.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])')!;
async function click(text: string) {
  await act(async () => button(text).click());
}
async function value(label: string, value: string) {
  const element = container.querySelector<HTMLInputElement | HTMLSelectElement>(
    `[aria-label="${label}"]`,
  )!;
  await act(async () => {
    const prototype =
      element.tagName === 'SELECT'
        ? HTMLSelectElement.prototype
        : element.tagName === 'TEXTAREA'
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(
      new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }),
    );
  });
}
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  document.body.replaceChildren();
});

describe('character tabs', () => {
  it('rolls a feat spell with its chosen casting source, advantage, and recorded purpose', async () => {
    const state = fighterBuilder();
    state.humanFeat = {
      ...blankFeat('feat-magic-initiate'),
      spellList: 'Wizard',
      spellAbility: 4,
      spells: ['Fire Bolt', 'Mage Hand', 'Shield'].map((name) => srdEntry('spell', name)!.id),
    };
    const sheet = applySrdBuilder(createDndSheet(), state);
    const { onRoll } = await fixture(sheet);
    await value('Sheet roll mode', 'advantage');
    await click('Spell');
    await click('Roll Fire Bolt (Human · Magic Initiate)');
    expect(onRoll).toHaveBeenCalledExactlyOnceWith(
      `2d20kh1 + @{${dndId('srd-resource:casting:feat:human:attack')}}`,
      'Spell attack with Fire Bolt (Human · Magic Initiate)',
    );
    expect(panel().textContent).toContain('Human · Magic Initiate · Save DC 10');
  });
  it('exposes builder resources and keeps grouped Hit Dice synchronized with the total', async () => {
    const { current } = await fixture(applySrdBuilder(createDndSheet(), fighterBuilder(2)));
    expect(container.textContent).toContain('Class resources, grouped Hit Dice');
    await value('Hit Dice d10', '1');
    const total = current()
      .sections.flatMap((section) => section.fields)
      .find((field) => field.id === dndId('hit-dice'))!;
    expect(total.value).toBe(1);
    expect(total.max).toBe(2);
    expect(sheetSchema.safeParse(current()).success).toBe(true);
  });
  it('allows the Thief level-13 fourth attunement without relaxing the default limit', async () => {
    const sheet = applySrdBuilder(createDndSheet(), classBuilder('Rogue', 13));
    sheet.character!.items = Array.from({ length: 5 }, (_, i) => ({
      id: crypto.randomUUID(),
      name: `Relic ${i + 1}`,
      description: '',
      rarity: 'Rare',
      quantity: 1,
      requiresAttunement: true,
      attuned: i < 3,
    }));
    const { current } = await fixture(sheet);
    await click('Inventory');
    const fourth = container.querySelector<HTMLInputElement>('[aria-label="Attune Relic 4"]')!;
    expect(fourth.disabled).toBe(false);
    await act(async () => fourth.click());
    expect(current().character!.items.filter((item) => item.attuned)).toHaveLength(4);
    expect(sheetSchema.safeParse(current()).success).toBe(true);
    expect(container.textContent).toContain('Attuned: 4 / 4');
    expect(
      container.querySelector<HTMLInputElement>('[aria-label="Attune Relic 5"]')!.disabled,
    ).toBe(true);
  });
  it('opens on Actions with combat essentials outside the Abilities panel', async () => {
    await fixture();
    expect(panel().textContent).toContain('Weapon & spell attacks');
    expect(panel().textContent).not.toContain('Ability scores');
    const quickChecks = container.querySelector('[aria-label="Quick ability checks"]')!;
    expect(quickChecks.querySelectorAll('button')).toHaveLength(6);
    expect(quickChecks.closest('[role="tabpanel"]')).toBeNull();
    const combat = container.querySelector('[aria-label="Combat essentials"]')!;
    expect(combat.closest('[role="tabpanel"]')).toBeNull();
    expect(combat.querySelector('[aria-label="Hit Points"]')).not.toBeNull();
    await click('Abilities');
    expect(panel().textContent).toContain('Ability scores');
    expect(panel().textContent).toContain('Saving throws');
    expect(panel().textContent).toContain('Skills');
    expect(panel().textContent).toContain('Additional roll bonuses');
    await click('Spell');
    expect(panel().textContent).toContain('Spellcasting');
    expect(combat.isConnected).toBe(true);
  });

  it('rolls attack, damage and critical damage directly; roll mode only modifies d20s', async () => {
    const { onRoll } = await fixture();
    await value('Sheet roll mode', 'disadvantage');
    for (const label of ['Attack roll', 'Damage', 'Critical damage']) {
      await act(async () =>
        container.querySelector<HTMLButtonElement>(`[aria-label="Roll ${label}"]`)!.click(),
      );
    }
    expect(onRoll).toHaveBeenNthCalledWith(
      1,
      `2d20kl1 + @{${dndId('weapon-total:0')}}`,
      'Attack roll with Longsword',
    );
    expect(onRoll).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('1d8'),
      'Damage with Longsword',
    );
    expect(onRoll).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('2d8'),
      'Critical damage with Longsword',
    );
    expect(button('Actions').getAttribute('aria-selected')).toBe('true');
  });

  it('switches panels with mouse and keyboard without losing edits', async () => {
    await fixture();
    expect(panel().textContent).toContain('Weapon & spell attacks');
    await click('Inventory');
    await click('Add item');
    await value('Item name', 'Rope');
    await act(async () =>
      button('Inventory').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'End', bubbles: true }),
      ),
    );
    expect(document.activeElement).toBe(button('Biography'));
    expect(panel().textContent).toContain('Biography & background');
    await click('Inventory');
    expect(panel().textContent).toContain('Rope');
  });

  it('adds, sorts, prepares and removes spells; Actions reflects prepared spells and cantrips', async () => {
    const { current } = await fixture();
    await click('Spell');
    await click('Add spell');
    await value('Spell name', 'Fireball');
    await value('Fireball level', '3');
    await click('Add spell');
    await value('Spell name', 'Light');
    const headings = [...panel().querySelectorAll('h3')].map((h) => h.textContent);
    expect(headings).toEqual([
      'Spellcasting',
      'Cantrips',
      ...Array.from({ length: 9 }, (_, i) => `Level ${i + 1}`),
    ]);
    await click('Actions');
    expect(panel().textContent).toContain('Light · Cantrip');
    expect(panel().textContent).not.toContain('Fireball');
    await click('Spell');
    await act(async () =>
      container.querySelector<HTMLInputElement>('[aria-label="Prepare Fireball"]')!.click(),
    );
    await value('Fireball casting time', 'Reaction');
    await click('Actions');
    expect(panel().textContent).toContain('Fireball · Level 3');
    expect(current().character!.spells.find((s) => s.name === 'Fireball')!.actionType).toBe(
      'Reaction',
    );
    await click('Spell');
    await click('Remove Fireball');
    expect(current().character!.spells.map((s) => s.name)).toEqual(['Light']);
  });

  it('uses and recovers spell slots and clamps remaining slots when maximum is reduced', async () => {
    const { current } = await fixture();
    await click('Edit sheet');
    await click('Spell');
    await value('Level 1 slots remaining maximum', '2');
    await click('Recover level 1 slot');
    await click('Recover level 1 slot');
    expect(button('Recover level 1 slot').disabled).toBe(true);
    await click('Use level 1 slot');
    await value('Level 1 slots remaining maximum', '0');
    const slot = current()
      .sections.flatMap((s) => s.fields)
      .find((f) => f.id === dndId('slot:0'))!;
    expect(slot.value).toBe(0);
    expect(button('Use level 1 slot').disabled).toBe(true);
    expect(sheetSchema.safeParse(current()).success).toBe(true);
  });

  it('manages item rarity, quantity, attunement and removal', async () => {
    const { current } = await fixture();
    await click('Inventory');
    await click('Add item');
    await value('Item name', 'Ring');
    for (const [index, rarity] of rarities.entries()) {
      await value('Ring rarity', rarity);
      expect(panel().querySelector(`.dnd-rarity-${index}`)?.textContent).toContain(rarity);
    }
    await value('Ring quantity', '2');
    await act(async () =>
      container.querySelector<HTMLInputElement>('[aria-label="Ring requires attunement"]')!.click(),
    );
    await act(async () =>
      container.querySelector<HTMLInputElement>('[aria-label="Attune Ring"]')!.click(),
    );
    expect(current().character!.items[0]).toMatchObject({ attuned: true, quantity: 2 });
    await act(async () =>
      container.querySelector<HTMLInputElement>('[aria-label="Ring requires attunement"]')!.click(),
    );
    expect(current().character!.items[0].attuned).toBe(false);
    await click('Remove Ring');
    expect(current().character!.items).toEqual([]);
  });

  it('shares feature uses between Features and Actions, retaining legacy notes', async () => {
    const initial = createDndSheet();
    initial.sections.flatMap((s) => s.fields).find((f) => f.id === dndId('features'))!.value =
      'Legacy feature';
    const { current } = await fixture(initial);
    await click('Features & Traits');
    expect(panel().textContent).toContain('Legacy feature');
    await click('Add feature');
    await value('Feature name', 'Second Wind');
    await value('Second Wind action type', 'Bonus action');
    await value('Second Wind maximum uses', '2');
    await click('Recover Second Wind');
    await click('Actions');
    await click('Use Second Wind');
    expect(current().character!.features[0].uses).toBe(0);
    expect(button('Use Second Wind').disabled).toBe(true);
    await click('Recover Second Wind');
    await click('Features & Traits');
    expect(panel().textContent).toContain('1 / 2 uses remaining');
    await click('Remove Second Wind');
    expect(current().character!.features).toEqual([]);
  });

  it('limits attunement to three items and permits ending attunement', async () => {
    const initial = createDndSheet();
    initial.character = emptyCharacterDetails();
    initial.character.items = Array.from({ length: 4 }, (_, i) => ({
      id: crypto.randomUUID(),
      name: `Ring ${i}`,
      description: '',
      rarity: 'Rare',
      quantity: 1,
      requiresAttunement: true,
      attuned: i < 3,
    }));
    const { current } = await fixture(initial);
    await click('Inventory');
    const fourth = () => container.querySelector<HTMLInputElement>('[aria-label="Attune Ring 3"]')!;
    expect(fourth().disabled).toBe(true);
    await act(async () =>
      container.querySelector<HTMLInputElement>('[aria-label="Attune Ring 0"]')!.click(),
    );
    expect(fourth().disabled).toBe(false);
    await act(async () => fourth().click());
    expect(current().character!.items.filter((i) => i.attuned)).toHaveLength(3);
    const invalid = structuredClone(current());
    invalid.character!.items[0].attuned = true;
    expect(sheetSchema.safeParse(invalid).success).toBe(false);
  });

  it('stores biography and background in the reusable sheet document', async () => {
    const { current } = await fixture();
    await click('Edit sheet');
    await click('Biography');
    await value('Background', 'Sage');
    await value('Physical description', 'Silver hair');
    await value('Personality & mental description', 'Curious');
    await value('Family & history', 'Raised by scholars');
    const saved = sheetSchema.parse(JSON.parse(JSON.stringify(current())));
    expect(saved.character!.biography).toEqual({
      physical: 'Silver hair',
      personality: 'Curious',
      history: 'Raised by scholars',
    });
    expect(
      saved.sections.flatMap((s) => s.fields).find((f) => f.id === dndId('background'))!.value,
    ).toBe('Sage');
  });

  it('keeps all data controls read-only for viewers', async () => {
    const sheet = createDndSheet();
    sheet.character = emptyCharacterDetails();
    sheet.character.features.push({
      id: crypto.randomUUID(),
      name: 'Wind',
      description: '',
      actionType: 'Bonus action',
      source: 'Class',
      uses: 1,
      maxUses: 2,
    });
    const { current } = await fixture(sheet, false);
    for (const tab of ['Spell', 'Inventory', 'Features & Traits', 'Biography', 'Actions']) {
      await click(tab);
      expect(
        [...panel().querySelectorAll<HTMLInputElement>('input,select,textarea')].every(
          (element) => element.disabled,
        ),
      ).toBe(true);
      expect(
        [...panel().querySelectorAll<HTMLButtonElement>('button')].every(
          (element) => element.disabled,
        ),
      ).toBe(true);
    }
    expect(current()).toEqual(sheet);
  });
});
