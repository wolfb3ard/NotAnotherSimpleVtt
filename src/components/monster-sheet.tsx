'use client';

import { dndId } from '@/lib/dnd';
import { monsterSource, monsterSpells } from '@/lib/srd-monsters';
import type { QuickUpdate } from '@/lib/resources';
import type { Sheet } from '@/lib/types';

export default function MonsterSheet({
  sheet,
  editable,
  rollable,
  blocked,
  quickEditable,
  quickUpdate,
  onRoll,
}: {
  sheet: Sheet;
  editable: boolean;
  rollable: boolean;
  blocked: boolean;
  quickEditable: boolean;
  quickUpdate: QuickUpdate;
  onRoll: (expression: string, label: string) => void;
}) {
  const source = monsterSource(sheet);
  const fields = sheet.sections.flatMap((s) => s.fields);
  return (
    <div className="stack monster-sheet">
      <p className="small">
        Encounter edits and uses affect only this creature. Configure statistics and expressions
        with “Customize monster sheet”. Printed source remains available below. Rolls use the room’s
        displayed audience.
      </p>
      <p className="small">
        Use counters and recover them explicitly; casting and declaring actions do not spend uses
        automatically. Multiattack, targeting, conditional damage, concentration and spell scaling
        require GM adjudication.
      </p>
      {source?.cr === null && (
        <p role="status">
          This creature has summoner/size/spell-dependent statistics. Set HP, AC and roll
          expressions from the printed formulas before play; unresolved HP starts at 0.
        </p>
      )}
      {sheet.sections
        .filter(
          (s) =>
            !['Source', 'Published stat block', 'Uses and recharge', 'Spells'].includes(s.title) &&
            !s.title.startsWith('Spells ('),
        )
        .map((section) => (
          <section className="sheet-section stack" key={section.id}>
            <h3>{section.title}</h3>
            {section.fields.map((f) => (
              <p key={f.id}>
                <strong>{f.label}: </strong>
                {String(f.value) || '—'}
                {f.kind === 'resource' ? ` / ${f.max}` : ''}
              </p>
            ))}
            {section.abilities.map((ability) => (
              <div className="ability stack" key={ability.id}>
                <strong>{ability.name}</strong>
                {ability.description && (
                  <p style={{ whiteSpace: 'pre-wrap' }}>{ability.description}</p>
                )}
                {ability.expression && (
                  <>
                    <code>{ability.expression}</code>
                    <div className="wrap">
                      <button
                        disabled={!rollable || blocked}
                        onClick={() => onRoll(ability.expression, ability.name)}
                      >
                        Roll {ability.name}
                      </button>
                      {ability.expression.startsWith('1d20') && (
                        <>
                          <button
                            disabled={!rollable || blocked}
                            onClick={() =>
                              onRoll(ability.expression.replace('1d20', '2d20kh1'), ability.name)
                            }
                          >
                            Advantage
                          </button>
                          <button
                            disabled={!rollable || blocked}
                            onClick={() =>
                              onRoll(ability.expression.replace('1d20', '2d20kl1'), ability.name)
                            }
                          >
                            Disadvantage
                          </button>
                        </>
                      )}
                    </div>
                  </>
                )}
                {!ability.expression && (
                  <div className="wrap">
                    <button
                      disabled={!rollable || blocked}
                      onClick={() => onRoll('0', `Use ${ability.name} (manual)`)}
                    >
                      Declare {ability.name}
                    </button>
                    {fields
                      .filter((f) => f.kind === 'resource' && f.label === `${ability.name} uses`)
                      .map((f) => (
                        <span key={f.id}>
                          {f.value} / {f.max} uses{' '}
                          <button
                            disabled={!editable || !quickEditable || Number(f.value) <= 0}
                            onClick={() => quickUpdate([{ id: f.id, value: Number(f.value) - 1 }])}
                          >
                            Spend use
                          </button>
                          <button
                            disabled={
                              !editable || !quickEditable || Number(f.value) >= (f.max ?? 0)
                            }
                            onClick={() => quickUpdate([{ id: f.id, value: f.max ?? 0 }])}
                          >
                            Recover uses (manual)
                          </button>
                        </span>
                      ))}
                  </div>
                )}
              </div>
            ))}
          </section>
        ))}
      {source &&
        monsterSpells(source).map((spell) => {
          const counter = fields.find(
            (f) => f.id === dndId(`monster:spell:${spell.entry.id}:uses`),
          );
          const spellAbilities = sheet.sections
            .flatMap((s) => s.abilities)
            .filter(
              (a) =>
                a.id === dndId(`monster:spell:${spell.entry.id}`) ||
                a.name.startsWith(`${spell.entry.name} · `),
            );
          return (
            <section key={spell.entry.id} className="sheet-section stack">
              <h3>{spell.entry.name}</h3>
              {spell.levelOverride && <p>Printed level {spell.levelOverride} version</p>}
              {fields
                .filter((f) => f.id === dndId(`monster:spell:${spell.entry.id}:dc`))
                .map((f) => (
                  <p key={f.id}>
                    {f.label}: {f.value}
                  </p>
                ))}
              <details>
                <summary>Monster casting rules and restrictions</summary>
                <p style={{ whiteSpace: 'pre-wrap' }}>{spell.casting}</p>
              </details>
              <details>
                <summary>Full spell · SRD p. {spell.entry.page}</summary>
                <p style={{ whiteSpace: 'pre-wrap' }}>{spell.entry.text}</p>
              </details>
              <div className="wrap">
                <button
                  disabled={!rollable || blocked}
                  onClick={() =>
                    onRoll('0', `Cast ${spell.entry.name} (manual; review source restrictions)`)
                  }
                >
                  Declare cast {spell.entry.name}
                </button>
                {counter && (
                  <>
                    <span>
                      {counter.value} / {counter.max} uses
                    </span>
                    <button
                      disabled={!editable || !quickEditable || Number(counter.value) <= 0}
                      onClick={() =>
                        quickUpdate([{ id: counter.id, value: Number(counter.value) - 1 }])
                      }
                    >
                      Spend {spell.entry.name} use
                    </button>
                    <button
                      disabled={
                        !editable || !quickEditable || Number(counter.value) >= (counter.max ?? 0)
                      }
                      onClick={() => quickUpdate([{ id: counter.id, value: counter.max ?? 0 }])}
                    >
                      Recover {spell.entry.name} uses (manual)
                    </button>
                  </>
                )}
              </div>
              {spellAbilities
                .filter((a) => a.expression)
                .map((a) => (
                  <div key={a.id} className="wrap">
                    <span>
                      {a.name}: <code>{a.expression}</code>
                    </span>
                    <small>{a.description}</small>
                    <button
                      disabled={!rollable || blocked}
                      onClick={() => onRoll(a.expression, a.name)}
                    >
                      Roll {a.name}
                    </button>
                    {a.expression.startsWith('1d20') && (
                      <>
                        <button
                          disabled={!rollable || blocked}
                          onClick={() => onRoll(a.expression.replace('1d20', '2d20kh1'), a.name)}
                        >
                          Advantage
                        </button>
                        <button
                          disabled={!rollable || blocked}
                          onClick={() => onRoll(a.expression.replace('1d20', '2d20kl1'), a.name)}
                        >
                          Disadvantage
                        </button>
                      </>
                    )}
                  </div>
                ))}
            </section>
          );
        })}
      {source && (
        <details>
          <summary>
            Published {source.name} · SRD 5.2.1 pp. {source.page}–{source.endPage} (unmodified)
          </summary>
          <p style={{ whiteSpace: 'pre-wrap' }}>{source.text}</p>
          <small>
            This work includes material from the System Reference Document 5.2.1 (“SRD 5.2.1”) by
            Wizards of the Coast LLC, available at{' '}
            <a href="https://www.dndbeyond.com/srd">https://www.dndbeyond.com/srd</a>. The SRD 5.2.1
            is licensed under the Creative Commons Attribution 4.0 International License, available
            at{' '}
            <a href="https://creativecommons.org/licenses/by/4.0/legalcode">
              https://creativecommons.org/licenses/by/4.0/legalcode
            </a>
            . VTT controls and formatting are adaptations.
          </small>
        </details>
      )}
    </div>
  );
}
