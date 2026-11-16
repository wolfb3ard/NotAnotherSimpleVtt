'use client';
import type { SrdBuilderState } from '@/lib/srd-state';
import {
  companionCapabilities,
  defaultCompanions,
  familiarShapes,
  pactWeaponOptions,
  shapeById,
  srdShapesManifest,
  type SrdCompanions,
} from '@/lib/srd-shapes';
import type { Sheet } from '@/lib/types';
import { pactConjuredId, recognizableMagicWeapon } from '@/lib/srd-equipment';

export function SrdShapesControls({
  state,
  sheet,
  onChange,
}: {
  state: SrdBuilderState;
  sheet: Sheet;
  onChange: (companions: SrdCompanions) => void;
}) {
  const selected = state.companions ?? defaultCompanions(),
    capabilities = companionCapabilities(state);
  const patch = (value: Partial<SrdCompanions>) => onChange({ ...selected, ...value });
  const shape = shapeById.get(selected.familiarForm);
  return (
    <section className="stack" aria-label="Familiar steed and pact presets">
      <h3>Companion / conjuration presets · optional until used in play</h3>
      <p>
        These select SRD references, not actors/tokens or active transformations. No spell slot,
        material, Wild Shape use, or casting time is consumed automatically. Required Druid
        known-form choices are in the latest Druid class level above/below, not optional companion
        presets.
      </p>
      <p className="notice">{srdShapesManifest.verification}</p>
      {(capabilities.normal ||
        capabilities.wild ||
        capabilities.chain ||
        selected.familiarMode !== 'none') && (
        <>
          <label>
            Familiar source
            <select
              value={selected.familiarMode}
              onChange={(e) =>
                patch({
                  familiarMode: e.target.value as SrdCompanions['familiarMode'],
                  familiarForm: '',
                  ...(e.target.value === 'wild-companion' ? { familiarType: 'Fey' as const } : {}),
                })
              }
            >
              <option value="none">No familiar preset</option>
              {capabilities.normal && <option value="spell">Find Familiar spell / ritual</option>}
              {capabilities.wild && (
                <option value="wild-companion">
                  Wild Companion · Fey, ends after Long Rest (p.43)
                </option>
              )}
              {capabilities.chain && (
                <option value="pact-chain">
                  Pact of the Chain · normal + 7 special forms (p.74)
                </option>
              )}
            </select>
          </label>
          {selected.familiarMode !== 'none' && (
            <>
              <label>
                Familiar form
                <select
                  value={selected.familiarForm}
                  onChange={(e) => patch({ familiarForm: e.target.value })}
                >
                  <option value="">Choose…</option>
                  {familiarShapes(selected.familiarMode === 'pact-chain').map((form) => (
                    <option key={form.id} value={form.id}>
                      {form.name} · CR {form.crLabel} · p.{form.page}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Familiar creature type
                <select
                  disabled={selected.familiarMode === 'wild-companion'}
                  value={selected.familiarType}
                  onChange={(e) =>
                    patch({ familiarType: e.target.value as SrdCompanions['familiarType'] })
                  }
                >
                  {['Celestial', 'Fey', 'Fiend'].map((type) => (
                    <option key={type}>{type}</option>
                  ))}
                </select>
              </label>
              {shape && (
                <details>
                  <summary>
                    {shape.name} source stat block · pp.{shape.page}–{shape.endPage}
                  </summary>
                  <p style={{ whiteSpace: 'pre-wrap' }}>{shape.text}</p>
                </details>
              )}
            </>
          )}
        </>
      )}
      {(capabilities.steed || selected.steedAppearance) && (
        <>
          <label>
            Find Steed appearance (leave blank for no preset)
            <input
              maxLength={80}
              value={selected.steedAppearance}
              placeholder="Horse, camel, dire wolf, elk, or another Large rideable animal appearance"
              onChange={(e) => patch({ steedAppearance: e.target.value })}
            />
          </label>
          <label>
            Otherworldly Steed creature type
            <select
              value={selected.steedType}
              onChange={(e) => patch({ steedType: e.target.value as SrdCompanions['steedType'] })}
            >
              {['Celestial', 'Fey', 'Fiend'].map((type) => (
                <option key={type}>{type}</option>
              ))}
            </select>
          </label>
          <p>
            The appearance does not replace the spell’s Otherworldly Steed stat block (SRD Find
            Steed).
          </p>
        </>
      )}
      {(capabilities.blade || selected.pactWeapon || selected.pactOwnedId) && (
        <>
          <label>
            Pact of the Blade conjured weapon profile
            <select
              value={selected.pactWeapon}
              onChange={(e) =>
                patch({
                  pactWeapon: e.target.value,
                  pactOwnedId: '',
                  ...(!e.target.value ? { pactActive: false } : {}),
                })
              }
            >
              <option value="">No conjured profile</option>
              {pactWeaponOptions().map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
          </label>
          <label>
            Or bond an owned magic weapon
            <select
              value={selected.pactOwnedId}
              onChange={(e) =>
                patch({
                  pactOwnedId: e.target.value,
                  pactWeapon: '',
                  ...(!e.target.value ? { pactActive: false } : {}),
                })
              }
            >
              <option value="">No owned weapon bond</option>
              {(sheet.character?.items ?? [])
                .filter(
                  (item) =>
                    item.quantity > 0 &&
                    item.id !== pactConjuredId &&
                    recognizableMagicWeapon(item),
                )
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="row">
            <input
              type="checkbox"
              checked={selected.pactActive}
              onChange={(e) => patch({ pactActive: e.target.checked })}
            />
            Apply an active bond / ensure one conjured weapon exists. Auto ready slot 1 prefers this
            explicit weapon. No existing manual item is converted or consumed.
          </label>
          <label className="row">
            <input
              type="checkbox"
              checked={selected.pactCharisma}
              onChange={(e) => patch({ pactCharisma: e.target.checked })}
            />
            Use Charisma for this active Pact weapon (otherwise normal/Finesse/Monk ability)
          </label>
          <label>
            Pact damage option
            <select
              value={selected.pactDamage}
              onChange={(e) => patch({ pactDamage: e.target.value as SrdCompanions['pactDamage'] })}
            >
              {['Normal', 'Necrotic', 'Psychic', 'Radiant'].map((type) => (
                <option key={type}>{type}</option>
              ))}
            </select>
          </label>
          <p>
            Inactive profiles are only presets. Active configuration applies proficiency, optional
            Charisma and chosen damage type to this weapon’s ready slot; a separate conjured item is
            archived at quantity zero when deactivated. Action timing, bond-distance/duration
            tracking and unrecognized homebrew magic-weapon effects are not automated.
          </p>
        </>
      )}
      {!capabilities.normal &&
        !capabilities.wild &&
        !capabilities.chain &&
        !capabilities.steed &&
        !capabilities.blade && (
          <p>
            No familiar, steed, or pact-conjuration capability is currently granted. These are not
            required choices for this build.
          </p>
        )}
    </section>
  );
}
