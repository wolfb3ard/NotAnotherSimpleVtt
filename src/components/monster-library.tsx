'use client';

import { useMemo, useState } from 'react';
import { monsterById, srdMonsters } from '@/lib/srd-monsters';
import type { Snapshot } from '@/lib/types';
import type { Command } from '@/lib/commands';
import { CreatureAdder } from './creature-adder';

export default function MonsterLibrary({
  snapshot,
  run,
}: {
  snapshot: Snapshot;
  run: (command: Command, payload: unknown) => Promise<Record<string, string> | undefined>;
}) {
  const [query, setQuery] = useState('');
  const [cr, setCr] = useState('');
  const [selection, setSelection] = useState('');
  const [custom, setCustom] = useState(false);
  const results = useMemo(
    () =>
      srdMonsters.filter(
        (m) =>
          (!cr || m.crLabel === cr) &&
          query
            .toLowerCase()
            .trim()
            .split(/\s+/)
            .every((word) => `${m.name} ${m.creatureType}`.toLowerCase().includes(word)),
      ),
    [query, cr],
  );
  if (snapshot.role !== 'gm') return null;
  const scene = snapshot.scenes.find((s) => s.id === snapshot.game.active_scene_id);
  const monster = custom ? undefined : monsterById.get(selection);
  const actor = custom
    ? snapshot.actors.find((a) => a.id === selection && a.kind !== 'character')
    : undefined;
  return (
    <section className="stack" aria-label="GM monster library">
      <h3>Monsters · SRD 5.2.1</h3>
      <p className="small">
        All 336 printed stat blocks. New creatures have independent HP, uses and notes, are
        GM-owned, and start hidden. Existing linked tokens stay linked.
      </p>
      <label>
        Definition source
        <select
          value={custom ? 'actor' : 'srd'}
          onChange={(e) => {
            setCustom(e.target.value === 'actor');
            setSelection('');
          }}
        >
          <option value="srd">SRD 5.2.1 library</option>
          <option value="actor">Existing NPC / enemy sheet</option>
        </select>
      </label>
      {!custom && (
        <>
          <label>
            Search monsters
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelection('');
              }}
              placeholder="Name or creature type…"
            />
          </label>
          <label>
            Challenge rating
            <select
              value={cr}
              onChange={(e) => {
                setCr(e.target.value);
                setSelection('');
              }}
            >
              <option value="">All ratings</option>
              {[...new Set(srdMonsters.map((m) => m.crLabel))].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <p className="small">{results.length} monsters found</p>
        </>
      )}
      <label>
        {custom ? 'NPC / enemy definition' : 'Monster'}
        <select value={selection} onChange={(e) => setSelection(e.target.value)}>
          <option value="">Choose a creature…</option>
          {custom
            ? snapshot.actors
                .filter((a) => a.kind !== 'character')
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                    {a.encounter_instance
                      ? ' (current instance state)'
                      : ' (definition / legacy linked actor)'}
                  </option>
                ))
            : results.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} · CR {m.crLabel}
                </option>
              ))}
        </select>
      </label>
      {monster && (
        <details>
          <summary>
            {monster.name} · PDF pp. {monster.page}
            {monster.endPage !== monster.page ? `–${monster.endPage}` : ''}
          </summary>
          <p className="small" style={{ whiteSpace: 'pre-wrap' }}>
            {monster.text}
          </p>
        </details>
      )}
      {actor && (
        <p className="small">
          Copies this sheet’s current state, including spent resources. Later definition sheet edits
          never change existing creatures. Appearance follows the source until overridden on an
          instance. Sheet grants are not copied.
        </p>
      )}
      {!scene && <p role="status">Create and activate a scene before adding monsters.</p>}
      {scene && (monster || actor) && (
        <CreatureAdder
          key={`${scene.id}:${selection}`}
          gameId={snapshot.game.id}
          sceneId={scene.id}
          source={
            monster
              ? { kind: 'srd', monster_id: monster.id }
              : { kind: 'actor', actor_id: actor!.id, revision: actor!.revision }
          }
          run={run}
        />
      )}
      <small>
        This work includes material from the System Reference Document 5.2.1 (“SRD 5.2.1”) by
        Wizards of the Coast LLC, available at{' '}
        <a href="https://www.dndbeyond.com/srd">https://www.dndbeyond.com/srd</a>. The SRD 5.2.1 is
        licensed under the Creative Commons Attribution 4.0 International License, available at{' '}
        <a href="https://creativecommons.org/licenses/by/4.0/legalcode">
          https://creativecommons.org/licenses/by/4.0/legalcode
        </a>
        . Source text is retained; VTT controls and formatting are adaptations.
      </small>
    </section>
  );
}
