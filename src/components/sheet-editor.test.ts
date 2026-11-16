import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SheetEditor } from './sheet-editor';
import { createDndSheet, dndId } from '@/lib/dnd';
import type { Actor, Snapshot } from '@/lib/types';

function fixture() {
  const actor: Actor = {
    id: 'actor',
    game_id: 'game',
    owner_id: 'owner',
    name: 'Hero',
    kind: 'character',
    sheet: createDndSheet(),
    revision: 0,
  };
  const snapshot: Snapshot = {
    userId: 'owner',
    role: 'player',
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
    members: [],
    scenes: [],
    templates: [],
    rolls: [],
    rollCues: [],
    diceStyles: [],
  };
  const render = () =>
    renderToStaticMarkup(
      createElement(SheetEditor, {
        actor,
        snapshot,
        run: async () => ({}),
        onRoll: () => {},
      }),
    );
  return { actor, snapshot, render };
}

describe('SRD sheet controls', () => {
  it('renders calculated values, configured damage, advantage controls, and attribution', () => {
    const { actor, render } = fixture();
    const fields = actor.sheet.sections.flatMap((s) => s.fields);
    fields.find((f) => f.id === dndId('score:0'))!.value = 18;
    fields.find((f) => f.id === dndId('level'))!.value = 5;
    fields.find((f) => f.id === dndId('weapon-dice:0'))!.value = '2d6';
    const html = render();
    expect(html).toContain('1d20 + 7');
    expect(html).toContain('max(0, 2d6 + 4)');
    expect(html).toContain('max(0, 4d6 + 4)');
    expect(html).toContain('Advantage');
    expect(html).toContain('Disadvantage');
    expect(html).toContain('creativecommons.org/licenses/by/4.0/legalcode');
    expect(html).toContain('Level 5');
  });
  it('does not grant rolling or editing to a view-only member', () => {
    const { snapshot, render } = fixture();
    snapshot.userId = 'viewer';
    const html = render();
    expect(html).toContain('Read only');
    expect(
      [...html.matchAll(/<button class="dnd-roll"[^>]*>/g)].every(([button]) =>
        button.includes('disabled=""'),
      ),
    ).toBe(true);
    expect(html).not.toMatch(/<button[^>]*>Save sheet<\/button>/);
  });
});
