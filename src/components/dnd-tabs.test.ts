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
import { castChoices } from '@/lib/play-assistance';
import type { QuickUpdate } from '@/lib/resources';
import { classBuilder, fighterBuilder } from '@/lib/srd-test-fixtures';
import { blankFeat } from '@/lib/srd-state';
import { srdEntry, srdExcerpt } from '@/lib/srd-catalog';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let container: HTMLDivElement;
async function fixture(
  initial = createDndSheet(),
  editable = true,
  quickUpdate?: QuickUpdate,
  onEquip?: (id: string) => void,
) {
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
      quickUpdate,
      onEquip,
      onUseItem: onEquip ? () => {} : undefined,
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
  it('opens and focuses the Inventory tab with its existing equipment controls', async () => {
    const sheet = applySrdBuilder(createDndSheet(), fighterBuilder());
    const onEquip = vi.fn();
    await fixture(sheet, true, undefined, onEquip);
    await click('Manage equipped items');
    expect(document.activeElement?.textContent).toBe('Inventory');
    const unequipArmor = [...panel().querySelectorAll('button')].find(
      (element) => element.textContent === 'Unequip Chain Mail',
    );
    expect(unequipArmor?.disabled).toBe(false);
    await act(async () => unequipArmor!.click());
    expect(onEquip).toHaveBeenCalledWith(
      sheet.character!.items.find((item) => item.name === 'Chain Mail')!.id,
    );
  });
  it('spends the chosen tracked slot from the active Actions tab', async () => {
    const sheet = applySrdBuilder(createDndSheet(), classBuilder('Wizard'));
    const spell = sheet.character!.spells.find(
      (s) =>
        s.level > 0 &&
        s.prepared &&
        castChoices(sheet, s).some((c) => c.changes.length && c.available),
    )!;
    const choice = castChoices(sheet, spell).find((c) => c.changes.length && c.available)!;
    const quickUpdate = vi.fn();
    await fixture(sheet, true, quickUpdate);
    expect(panel().textContent).toContain(spell.name);
    await click(`Cast ${spell.name} · ${choice.label}`);
    expect(quickUpdate).toHaveBeenCalledExactlyOnceWith(choice.changes);
  });
  it('casts a cantrip from Actions without touching spell slots', async () => {
    const sheet = createDndSheet();
    sheet.character = emptyCharacterDetails();
    sheet.character.spells.push({
      id: crypto.randomUUID(),
      name: 'Light',
      actionType: 'Action',
      description: 'An object emits light.',
      level: 0,
      prepared: false,
    });
    const { current } = await fixture(sheet);
    expect(panel().textContent).toContain('An object emits light.');
    await click('Cast Light · No slot');
    expect(container.textContent).toContain('Light: no slot spent');
    expect(current()).toBe(sheet);
  });
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
    const actions = panel().querySelector('[aria-label="Fire Bolt actions"]')!;
    expect([...actions.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      'Cast Fire Bolt · No slot',
      'Roll Fire Bolt (Human · Magic Initiate)',
    ]);
    const description = actions.closest('article')!.querySelector('.dnd-description')!;
    expect(description.querySelector('em')?.textContent).toMatch(/^SRD 5\.2\.1, PDF p\./);
    expect(description.textContent).not.toContain('\n');
    expect(description.textContent).not.toContain('Components:');
    expect(description.querySelector('strong')?.textContent).toBe('Cantrip Upgrade.');
    await click('Roll Fire Bolt (Human · Magic Initiate)');
    expect(onRoll).toHaveBeenCalledExactlyOnceWith(
      `2d20kh1 + @{${dndId('srd-resource:casting:feat:human:attack')}}`,
      'Spell attack with Fire Bolt (Human · Magic Initiate)',
    );
    expect(panel().textContent).toContain('Human · Magic Initiate · Save DC 10');
  });
  it('separates wrapped SRD spell facts from the description in play mode', async () => {
    const sheet = createDndSheet();
    sheet.character = emptyCharacterDetails();
    const entry = srdEntry('spell', 'Arcane Lock')!;
    sheet.character.spells.push({
      id: crypto.randomUUID(),
      name: entry.name,
      level: 2,
      prepared: true,
      actionType: 'Action',
      description: entry.text,
    });
    await fixture(sheet);
    await click('Spell');
    expect([...panel().querySelectorAll('dt')].map((element) => element.textContent)).toEqual([
      'Casting Time',
      'Range',
      'Components',
      'Duration',
    ]);
    expect([...panel().querySelectorAll('dd')].map((element) => element.textContent)).toEqual([
      'Action',
      'Touch',
      'V, S, M (gold dust worth 25+ GP, which the spell consumes)',
      'Until dispelled',
    ]);
    expect(panel().querySelector('.dnd-description')?.textContent).toMatch(/^You touch a closed/);
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
    await click('Edit character');
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
    const combat = container.querySelector('[aria-label="Combat essentials"]')!;
    expect(combat.closest('[role="tabpanel"]')).toBeNull();
    expect(combat.querySelector('[aria-label="Hit Points"]')).not.toBeNull();
    await click('Abilities');
    expect(panel().textContent).toContain('Ability scores');
    expect(panel().querySelector('[aria-label="Roll Strength check"]')).not.toBeNull();
    expect(panel().querySelector('[aria-label="Roll Strength save"]')).not.toBeNull();
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
    await click('Edit character');
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
    await click('Edit character');
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
    await click('Edit character');
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
    await click('Edit character');
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
    expect(button('Add feature')).toBeUndefined();
    await click('Edit character');
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

  it('uses the same readable SRD class feature card in Actions and Features & Traits', async () => {
    await fixture(applySrdBuilder(createDndSheet(), fighterBuilder()));
    function secondWind() {
      return [...panel().querySelectorAll('article')].find(
        (article) => article.querySelector('h4')?.textContent === 'Second Wind',
      )!;
    }
    const card = secondWind();
    expect(card.querySelector('.dnd-rules-meta')?.textContent).toContain('Class feature');
    const paragraphs = [...card.querySelectorAll('.dnd-description p')];
    expect(paragraphs).toHaveLength(4);
    expect(paragraphs[0].textContent).toContain('mental stamina');
    expect(paragraphs[1].textContent).toMatch(/^You can use this feature twice/);
    expect(paragraphs[3].querySelector('em')?.textContent).toMatch(/^SRD 5\.2\.1/);
    await click('Features & Traits');
    expect(secondWind().textContent).toBe(card.textContent);
    expect(panel().querySelector('[aria-label="Second Wind description"]')).toBeNull();
    await click('Edit character');
    expect(panel().querySelector('textarea[aria-label="Second Wind description"]')).not.toBeNull();
  });

  it('shows Wizard Spellcasting without flattened progression rows or truncated rules', async () => {
    const sheet = applySrdBuilder(createDndSheet(), classBuilder('Wizard'));
    const saved = sheet.character!.features.find((feature) => feature.name === 'Spellcasting')!;
    expect(saved.description).toContain('\nWizard Features\n');
    expect(saved.description).not.toContain('Spellcasting Focus.');
    const { current } = await fixture(sheet);
    await click('Features & Traits');
    const card = [...panel().querySelectorAll('article')].find(
      (article) => article.querySelector('h4')?.textContent === 'Spellcasting',
    )!;
    expect(card.querySelector('.dnd-description > p')?.textContent).not.toContain(
      'Signature Spells',
    );
    const progression = card.querySelector('table')!;
    expect(progression.caption?.textContent).toBe('Wizard Features');
    expect(progression.closest('details')?.open).toBe(false);
    expect(progression.tBodies[0].rows).toHaveLength(20);
    expect(
      [...progression.tBodies[0].rows[0].cells].slice(0, 6).map((cell) => cell.textContent),
    ).toEqual(['1', '+2', 'Spellcasting, Ritual Adept, Arcane Recovery', '3', '4', '2']);
    expect([...card.querySelectorAll('strong')].map((label) => label.textContent)).toEqual(
      expect.arrayContaining(['Cantrips.', 'Prepared Spells of Level 1+.', 'Spellcasting Focus.']),
    );
    const sidebar = card.querySelector('details')!;
    expect(sidebar.open).toBe(false);
    expect(sidebar.querySelector('summary')?.textContent).toBe(
      'Expanding and Replacing a Spellbook',
    );
    expect(sidebar.textContent).toContain('50 GP');
    expect(current()).toBe(sheet);
  });

  it('removes an embedded progression table without breaking the surrounding sentence', async () => {
    const sheet = applySrdBuilder(createDndSheet(), classBuilder('Druid'));
    await fixture(sheet);
    await click('Features & Traits');
    const card = [...panel().querySelectorAll('article')].find(
      (article) => article.querySelector('h4')?.textContent === 'Spellcasting',
    )!;
    expect(card.textContent).toContain('details how you use those rules with Druid spells');
    expect(card.querySelector('caption')?.textContent).toBe('Druid Features');
    expect(card.querySelector('tbody tr:last-child')?.textContent).toContain('Archdruid');
  });

  it('renders feature bullets without including the following paragraph in the list', async () => {
    await fixture(applySrdBuilder(createDndSheet(), classBuilder('Monk')));
    await click('Features & Traits');
    const card = [...panel().querySelectorAll('article')].find(
      (article) => article.querySelector('h4')?.textContent === 'Martial Arts',
    )!;
    const list = card.querySelector('ul')!;
    expect([...list.children].map((item) => item.textContent)).toEqual([
      'Simple Melee weapons',
      'Martial Melee weapons that have the Light property',
    ]);
    expect(list.nextElementSibling?.textContent).toMatch(/^You gain the following benefits/);
  });

  it('renders inline spell tables without swallowing the following rules', async () => {
    const sheet = createDndSheet();
    sheet.character = emptyCharacterDetails();
    sheet.character.spells.push({
      id: crypto.randomUUID(),
      name: 'Confusion',
      level: 4,
      prepared: true,
      actionType: 'Action',
      description: srdExcerpt(srdEntry('spell', 'Confusion')!),
    });
    await fixture(sheet);
    await click('Spell');
    const table = panel().querySelector('table')!;
    expect(table.caption?.textContent).toBe('Confusion Behavior');
    expect([...table.tBodies[0].rows].map((row) => row.cells[0].textContent)).toEqual([
      '1',
      '2–6',
      '7–8',
      '9–10',
    ]);
    expect(table.tBodies[0].rows[0].cells[1].textContent).toContain('its movement to move');
    expect(table.parentElement?.nextElementSibling?.textContent).toMatch(/^At the end/);
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
    await click('Edit character');
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
    await click('Edit character');
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
