import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { srdCatalog, srdEntry, srdExcerpt, srdManifest, searchSrd } from './srd-catalog';
import srdPages from './srd-data/pages.json' with { type: 'json' };
import { classSpellLimits, featuresAt, progressions, srdClasses } from './srd-rules';

describe('traceable SRD PDF import', () => {
  it('retains every page, attribution, and a reproducible source fingerprint', () => {
    expect(srdPages).toHaveLength(364);
    expect(srdPages.map((page) => page.page)).toEqual(Array.from({ length: 364 }, (_, i) => i + 1));
    expect(srdPages.every((page) => page.text.length > 0)).toBe(true);
    expect(srdManifest.license).toBe('CC-BY-4.0');
    expect(srdManifest.attribution).toContain('Wizards of the Coast');
    expect(srdManifest.verification).toContain('not independent proof');
    const pdf = 'SRD_CC_v5.2.1.pdf';
    if (existsSync(pdf))
      expect(createHash('sha256').update(readFileSync(pdf)).digest('hex')).toBe(srdManifest.sha256);
  });
  it('checks independently enumerated player categories and catalog regression counts', () => {
    expect(new Set(srdCatalog.map((e) => e.id)).size).toBe(srdCatalog.length);
    for (const [category, count] of Object.entries(srdManifest.counts))
      expect(srdCatalog.filter((e) => e.category === category)).toHaveLength(count);
    expect(srdCatalog.filter((e) => e.category === 'class')).toHaveLength(12);
    expect(srdCatalog.filter((e) => e.category === 'subclass')).toHaveLength(12);
    expect(srdCatalog.filter((e) => e.category === 'species')).toHaveLength(9);
    expect(srdCatalog.filter((e) => e.category === 'background')).toHaveLength(4);
    expect(srdCatalog.filter((e) => e.category === 'feat')).toHaveLength(17);
    expect(
      srdCatalog.filter((e) => e.category === 'option' && e.className === 'Sorcerer'),
    ).toHaveLength(10);
    expect(
      srdCatalog.filter((e) => e.category === 'option' && e.className === 'Warlock'),
    ).toHaveLength(28);
    expect(srdCatalog.filter((e) => e.kind === 'weapon')).toHaveLength(38);
    expect(srdCatalog.filter((e) => e.kind === 'armor')).toHaveLength(13);
    expect(
      srdCatalog.every(
        (e) => e.page >= 1 && e.endPage <= 364 && e.endPage >= e.page && e.text.length > 0,
      ),
    ).toBe(true);
  });
  it('does not mistake embedded spell stat blocks for spells', () => {
    const spells = srdCatalog.filter((e) => e.category === 'spell');
    expect(spells).toHaveLength(338);
    expect(spells.every((spell) => spell.classes?.length && Number.isInteger(spell.level))).toBe(
      true,
    );
    expect(srdEntry('spell', 'Animated Object')).toBeUndefined();
    expect(srdEntry('spell', 'Animate Objects')?.text).toContain('Animated Object');
    expect(searchSrd('fireball', 'spell').some((spell) => spell.name === 'Fireball')).toBe(true);
  });
  it('indexes actual table equipment, not rule headings, with printed prices and purchase quantities', () => {
    const trinkets = srdCatalog.filter((entry) => entry.id.startsWith('equipment-trinket-'));
    expect(trinkets).toHaveLength(100);
    expect(trinkets.every((entry) => entry.addable && entry.costCopper === undefined)).toBe(true);
    expect(srdCatalog.find((entry) => entry.id === 'equipment-trinket-00')?.text).toContain(
      'ashes of a hero',
    );
    for (const name of ['Coins', 'Weapon Proficiency', 'Crew', 'Ending Attunement']) {
      const entry = srdCatalog.find((entry) => entry.name === name)!;
      expect(entry.category, name).toBe('rule');
      expect(entry.addable, name).toBe(false);
    }
    for (const name of [
      'Camel',
      'Elephant',
      'Horse, Draft',
      'Horse, Riding',
      'Mastiff',
      'Mule',
      'Pony',
      'Warhorse',
      'Airship',
      'Galley',
      'Keelboat',
      'Longship',
      'Rowboat',
      'Sailing Ship',
      'Warship',
      'Carriage',
      'Cart',
      'Chariot',
      'Sled',
      'Wagon',
      'Saddle (Exotic)',
      'Saddle (Military)',
      'Saddle (Riding)',
    ]) {
      const entry = srdEntry('equipment', name)!;
      expect(entry?.addable, name).toBe(true);
      expect(entry.costCopper, name).toBeGreaterThan(0);
    }
    expect(srdEntry('equipment', 'Horse, Riding')?.costCopper).toBe(7500);
    expect(srdEntry('equipment', 'Airship')?.costCopper).toBe(4000000);
    expect(srdEntry('equipment', 'Barding (Plate Armor)')?.costCopper).toBe(600000);
    expect(srdEntry('equipment', 'Needles')).toMatchObject({
      costCopper: 100,
      purchaseQuantity: 50,
      shopKey: 'variant:Needles',
    });
    expect(srdEntry('equipment', 'Arcane Focus (Crystal)')?.costCopper).toBe(1000);
  });
  it('offers source-specific magic variants with actual rarity rather than a generic Common fallback', () => {
    expect(srdEntry('magic-item', 'Armor, +1, +2, or +3')?.addable).toBe(false);
    expect(srdEntry('magic-item', 'Plate Armor +3')).toMatchObject({
      rarity: 'Legendary',
      inventoryName: 'Plate Armor +3',
      addable: true,
    });
    expect(srdEntry('magic-item', 'Longsword +1')?.rarity).toBe('Uncommon');
    expect(srdEntry('magic-item', 'Belt of Giant Strength (Storm)')?.rarity).toBe('Legendary');
    expect(srdEntry('magic-item', 'Potion of Supreme Healing')?.rarity).toBe('Very Rare');
    expect(srdEntry('magic-item', 'Ioun Stone (Absorption)')?.rarity).toBe('Very Rare');
    expect(srdEntry('magic-item', 'Spell Scroll (Level 9)')?.rarity).toBe('Legendary');
    expect(
      srdCatalog
        .filter((entry) => entry.category === 'magic-item' && entry.addable !== false)
        .every((entry) => !!entry.rarity && typeof entry.requiresAttunement === 'boolean'),
    ).toBe(true);
  });
  it('keeps long text losslessly in catalog with explicit bounded sheet references', () => {
    const longest = [...srdCatalog].sort((a, b) => b.text.length - a.text.length)[0];
    expect(longest.text.length).toBeGreaterThan(4000);
    expect(srdExcerpt(longest).length).toBeLessThanOrEqual(4000);
    expect(srdExcerpt(longest)).toContain(longest.id);
    expect(srdExcerpt(longest)).toContain('Full text in SRD catalog');
  });
  it('extracts every class level and finite spell counts directly from class tables', () => {
    for (const name of srdClasses) {
      expect(progressions[name].rows.map((row) => row.level)).toEqual(
        Array.from({ length: 20 }, (_, i) => i + 1),
      );
      for (let level = 1; level <= 20; level++) {
        for (const value of Object.values(classSpellLimits(name, level)))
          expect(Number.isFinite(value)).toBe(true);
      }
    }
    expect(classSpellLimits('Wizard', 20)).toEqual({
      cantrips: 5,
      prepared: 25,
      maxLevel: 9,
      spellbook: 53,
    });
    expect(classSpellLimits('Ranger', 20).prepared).toBe(15);
    expect(classSpellLimits('Bard', 11).prepared).toBe(16);
    expect(featuresAt('Fighter', 6).some((e) => e.name.endsWith('Ability Score Improvement'))).toBe(
      true,
    );
    expect(featuresAt('Rogue', 10).some((e) => e.name.endsWith('Ability Score Improvement'))).toBe(
      true,
    );
    expect(featuresAt('Barbarian', 17).some((e) => e.name.endsWith('Improved Brutal Strike'))).toBe(
      true,
    );
  });
});
