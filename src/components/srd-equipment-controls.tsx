'use client';
import { useState } from 'react';
import type { Sheet } from '@/lib/types';
import type { SrdBuilderState } from '@/lib/srd-state';
import { builderScores } from '@/lib/srd-state';
import { abilityNames, instruments } from '@/lib/srd-rules';
import {
  acModes,
  armorProfile,
  conjuredPactItem,
  defaultEquipment,
  deriveEquipment,
  equipmentShop,
  isLegacyStartingBundle,
  isShield,
  pactConjuredId,
  shopByKey,
  startingBudget,
  startingInventory,
  weaponProfile,
  type SrdEquipment,
} from '@/lib/srd-equipment';

export function draftEquipmentItems(sheet: Sheet, state: SrdBuilderState) {
  const existing = sheet.character?.items ?? [];
  const ids = new Set(existing.map((item) => item.id));
  let items =
    sheet.character?.builder && !state.equipment.expandLegacyBundles
      ? [...existing]
      : [...existing, ...startingInventory(state).filter((item) => !ids.has(item.id))];
  const pact = conjuredPactItem(state);
  if (pact) items = [...items.filter((item) => item.id !== pactConjuredId), pact];
  else items = items.map((item) => (item.id === pactConjuredId ? { ...item, quantity: 0 } : item));
  return items;
}
const money = (copper: number) =>
  `${Math.floor(copper / 100)} GP ${Math.floor((copper % 100) / 10)} SP ${copper % 10} CP`;
export function SrdEquipmentControls({
  sheet,
  state,
  onChange,
}: {
  sheet: Sheet;
  state: SrdBuilderState;
  onChange: (gear: SrdEquipment) => void;
}) {
  const [search, setSearch] = useState(''),
    [offer, setOffer] = useState('');
  const gear = state.equipment ?? defaultEquipment(),
    inventory = draftEquipmentItems(sheet, state);
  const originLocked = !!sheet.character?.builder,
    budget = startingBudget(state);
  const loadout = deriveEquipment(state, inventory, builderScores(state));
  const patch = (value: Partial<SrdEquipment>) => onChange({ ...gear, ...value });
  const positive = inventory.filter((item) => item.quantity > 0);
  const legacy = sheet.character?.items.some(isLegacyStartingBundle);
  return (
    <section className="stack" aria-label="Starting equipment and loadout">
      <h3>Equipment, currency & ready attacks</h3>
      <p>
        Starting packages expand into individual items; repeated items combine into counted stacks.
        Packs are containers, not extra grants. Later Apply never refills spent currency,
        ammunition, or consumables.
      </p>
      {!originLocked && (
        <label className="row">
          <input
            type="checkbox"
            checked={gear.grantStarting !== false}
            onChange={(e) =>
              patch(
                e.target.checked
                  ? { grantStarting: true }
                  : {
                      grantStarting: false,
                      purchases: [],
                      acMode: 'manual',
                      weaponIds: ['', '', ''],
                    },
              )
            }
          />
          New character: grant the selected starting equipment/currency. Uncheck when adopting an
          existing manual character to grant nothing and initially preserve its AC/Speed/attack
          slots.
        </label>
      )}
      <fieldset disabled={(originLocked && !legacy) || gear.grantStarting === false}>
        <legend>Starting choices & purchases · SRD pp.28–83, 89–100</legend>
        {state.levels[0].className === 'Bard' && state.classEquipment === 'A' && (
          <label>
            Bard starting Musical Instrument
            <select value={gear.instrument} onChange={(e) => patch({ instrument: e.target.value })}>
              <option value="">Choose…</option>
              {instruments.map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
          </label>
        )}
        {['Cleric', 'Paladin'].includes(state.levels[0].className) &&
          state.classEquipment === 'A' && (
            <label>
              Class Holy Symbol form
              <select
                value={gear.classSymbol}
                onChange={(e) =>
                  patch({ classSymbol: e.target.value as SrdEquipment['classSymbol'] })
                }
              >
                {['Amulet', 'Emblem', 'Reliquary'].map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </label>
          )}
        {state.background === 'Acolyte' && state.backgroundEquipment === 'A' && (
          <label>
            Background Holy Symbol form
            <select
              value={gear.backgroundSymbol}
              onChange={(e) =>
                patch({ backgroundSymbol: e.target.value as SrdEquipment['backgroundSymbol'] })
              }
            >
              {['Amulet', 'Emblem', 'Reliquary'].map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
          </label>
        )}
        {state.levels[0].className === 'Monk' && state.classEquipment === 'A' && (
          <p>
            Monk starting tool/instrument is exactly the proficiency choice in Monk level 1:{' '}
            {state.levels[0].choices['monk-tool']?.[0] ?? 'choose that required class option below'}
            .
          </p>
        )}
        <p>
          Granted: {money(budget.grantedCopper)} · Purchases: {money(budget.spentCopper)} ·
          Remaining: {budget.remainingCopper < 0 ? 'OVER BUDGET' : money(budget.remainingCopper)}.
        </p>
        <label>
          Find priced starting equipment
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <label>
          Purchase offer
          <select value={offer} onChange={(e) => setOffer(e.target.value)}>
            <option value="">Choose…</option>
            {equipmentShop
              .filter((entry) => entry.name.toLowerCase().includes(search.toLowerCase()))
              .map((entry) => (
                <option key={entry.key} value={entry.key}>
                  {entry.name}
                  {entry.quantity > 1 ? ` ×${entry.quantity}` : ''} · {money(entry.copper)} · p.
                  {entry.page}
                </option>
              ))}
          </select>
        </label>
        <button
          type="button"
          disabled={!offer}
          onClick={() => {
            const existing = gear.purchases.find((buy) => buy.key === offer);
            patch({
              purchases: existing
                ? gear.purchases.map((buy) =>
                    buy.key === offer ? { ...buy, quantity: buy.quantity + 1 } : buy,
                  )
                : [...gear.purchases, { key: offer, quantity: 1 }],
            });
          }}
        >
          Add purchase to draft
        </button>
        {gear.purchases.map((buy) => (
          <div className="row" key={buy.key}>
            <span>{shopByKey.get(buy.key)?.name ?? buy.key}</span>
            <label>
              Purchase lots
              <input
                type="number"
                min={1}
                max={30000}
                value={buy.quantity}
                onChange={(e) =>
                  patch({
                    purchases: gear.purchases.map((row) =>
                      row.key === buy.key ? { ...row, quantity: Number(e.target.value) } : row,
                    ),
                  })
                }
              />
            </label>
            <button
              type="button"
              onClick={() =>
                patch({ purchases: gear.purchases.filter((row) => row.key !== buy.key) })
              }
            >
              Remove purchase
            </button>
          </div>
        ))}
        <small>
          Prices are from printed SRD rows or explicitly priced variants. Variable-price magic
          items, Spell Scroll creation, and unindexed mount/vehicle table variants are not purchase
          offers; no claim of shop/catalog completeness is made.
        </small>
      </fieldset>
      {legacy && (
        <label className="row">
          <input
            type="checkbox"
            checked={gear.expandLegacyBundles}
            onChange={(e) => patch({ expandLegacyBundles: e.target.checked })}
          />
          One-time legacy bundle expansion: grant the original full items/currency and set the old
          bundle records’ quantities to zero. Use ONLY if those bundles are untouched; existing
          manual item entries remain.
        </label>
      )}
      <details open={!originLocked}>
        <summary>Inventory preview · {inventory.length} entries</summary>
        <ul>
          {inventory.map((item) => (
            <li key={item.id}>
              {item.quantity} × {item.name}
            </li>
          ))}
        </ul>
      </details>
      <div className="row">
        <label>
          Worn armor
          <select value={gear.armorId} onChange={(e) => patch({ armorId: e.target.value })}>
            <option value="auto">Auto · available starting armor only</option>
            <option value="">Unequipped</option>
            {positive
              .filter((item) => armorProfile(item.name))
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} ×{item.quantity}
                </option>
              ))}
          </select>
        </label>
        <label>
          Wielded Shield
          <select value={gear.shieldId} onChange={(e) => patch({ shieldId: e.target.value })}>
            <option value="auto">Auto · available starting Shield only</option>
            <option value="">Unequipped</option>
            {positive
              .filter((item) => isShield(item.name))
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} ×{item.quantity}
                </option>
              ))}
          </select>
        </label>
        <label>
          AC / Speed application
          <select
            value={gear.acMode}
            onChange={(e) => patch({ acMode: e.target.value as SrdEquipment['acMode'] })}
          >
            {acModes.map((mode) => (
              <option key={mode} value={mode}>
                {mode === 'auto'
                  ? 'Best eligible formula; apply armor and Speed'
                  : mode === 'manual'
                    ? 'Manual AC / Speed · preserve existing fields'
                    : mode}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p>
        Armor training: {loadout.training.join(', ') || 'none'}.{' '}
        {loadout.ac === undefined
          ? 'Existing AC / Speed preserved.'
          : `${loadout.formula}: AC ${loadout.ac}; Speed ${loadout.speed} ft.`}
      </p>
      {loadout.warnings.map((warning) => (
        <p className="notice" key={warning}>
          {warning}
        </p>
      ))}
      <p>
        Only one base AC formula applies. The Shield contributes only with training; Monk
        defense/movement require no armor or Shield. Strength shortfalls reduce heavy-armor Speed by
        10 feet. Magic armor/shields named “Plate Armor +1” / “Shield +1” are recognized; other
        homebrew forms require Manual AC / Speed rather than guessing.
      </p>
      <p>
        Initial automated Apply replaces the template’s AC/Speed and selected ready slots; choose
        Manual for existing homebrew fields. Later Apply preserves manual AC/Speed offsets, attack
        bonuses, item annotations and consumed quantities.
      </p>
      <h4>Replace the sheet’s three ready-attack slots</h4>
      <p>
        Auto readies the explicitly active Pact weapon first, then available starting weapons—not
        arbitrary manual inventory. An unused Auto slot is cleared to “Unequipped”, not a free
        proficient Longsword. “Manual” preserves that entire slot. Finesse and eligible Monk weapons
        may use Strength or Dexterity.
      </p>
      {gear.weaponIds.map((id, index) => (
        <fieldset key={index}>
          <legend>Attack slot {index + 1}</legend>
          <label>
            Ready weapon
            <select
              value={id}
              onChange={(e) =>
                patch({
                  weaponIds: gear.weaponIds.map((value, i) =>
                    i === index ? e.target.value : value,
                  ),
                })
              }
            >
              <option value="auto">Auto · starting weapon {index + 1}</option>
              <option value="">Manual · preserve this slot</option>
              {positive
                .filter((item) => weaponProfile(item.name))
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} ×{item.quantity}
                  </option>
                ))}
            </select>
          </label>
          {id !== '' && (
            <>
              <label>
                Attack ability
                <select
                  value={gear.weaponAbilities[index]}
                  onChange={(e) =>
                    patch({
                      weaponAbilities: gear.weaponAbilities.map((value, i) =>
                        i === index ? (Number(e.target.value) as -1 | 0 | 1) : value,
                      ),
                    })
                  }
                >
                  <option value={-1}>Auto · best legal ability</option>
                  <option value={0}>Strength (melee or Finesse)</option>
                  <option value={1}>Dexterity (ranged, Finesse, or eligible Monk weapon)</option>
                </select>
              </label>
              <label className="row">
                <input
                  type="checkbox"
                  checked={gear.twoHanded[index]}
                  onChange={(e) =>
                    patch({
                      twoHanded: gear.twoHanded.map((value, i) =>
                        i === index ? e.target.checked : value,
                      ),
                    })
                  }
                />
                Use Versatile two-handed damage when available
              </label>
            </>
          )}
          <p>
            {loadout.weapons[index]
              ? `${loadout.weapons[index]!.item.name}: ${loadout.weapons[index]!.dice} ${loadout.weapons[index]!.damageType}; ${abilityNames[loadout.weapons[index]!.ability]}; ${loadout.weapons[index]!.proficient ? 'proficient' : 'NOT proficient'}`
              : id === ''
                ? 'Manual slot preserved.'
                : 'No equipped weapon; slot will be marked Unequipped.'}
          </p>
        </fieldset>
      ))}
      {loadout.errors.map((error) => (
        <p role="alert" key={error}>
          {error}
        </p>
      ))}
    </section>
  );
}

export function SrdEquipmentSummary({ sheet }: { sheet: Sheet }) {
  const state = sheet.character?.builder;
  if (!state) return null;
  const loadout = deriveEquipment(state, sheet.character?.items ?? [], builderScores(state));
  return (
    <details className="sheet-help">
      <summary>
        Equipped: {loadout.armor?.name ?? 'no armor'} · {loadout.shield?.name ?? 'no Shield'} ·{' '}
        {loadout.ac === undefined
          ? 'manual AC / Speed'
          : `equipment base AC ${loadout.ac}, Speed ${loadout.speed}`}
      </summary>
      <p>
        Use the builder’s loadout controls to equip/unequip or replace ready attacks. Existing sheet
        AC/Speed can include preserved manual adjustments.
      </p>
      {loadout.warnings.map((warning) => (
        <p className="notice" key={warning}>
          {warning}
        </p>
      ))}
      {loadout.errors.map((error) => (
        <p role="alert" key={error}>
          {error}
        </p>
      ))}
    </details>
  );
}
