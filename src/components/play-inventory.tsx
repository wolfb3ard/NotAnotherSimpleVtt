import { equipmentEntry } from '@/lib/srd-equipment';
import { inventoryEntries } from '@/lib/inventory-play';
import type { Sheet } from '@/lib/types';

export function PlayInventory({
  sheet,
  disabled,
  onChange,
}: {
  sheet: Sheet;
  disabled: boolean;
  onChange?: (action: { type: 'toggle' | 'use'; id: string }) => void;
}) {
  const entries = inventoryEntries(sheet);
  return (
    <section className="stack" aria-label="Inventory items">
      {!entries.length && <p>No inventory items.</p>}
      {entries.map(({ item, equipped, equippable }) => {
        const source = equipmentEntry(item.name === 'Additional shield' ? 'Shield' : item.name);
        return (
          <article className="dnd-box" key={item.id}>
            <h3>
              {item.name} ×{item.quantity}
            </h3>
            <p>
              {item.description.split('\n').find(Boolean) ||
                source?.kind ||
                'No description recorded.'}
              {equipped && ' · Equipped'}
            </p>
            <details>
              <summary>Item details</summary>
              {item.description && <p className="dnd-description">{item.description}</p>}
              {source && (
                <p className="dnd-description">
                  SRD p.{source.page}: {source.text}
                </p>
              )}
              {!source && !item.description && <p>No rules or notes recorded.</p>}
            </details>
            {equippable ? (
              <button
                disabled={disabled || !onChange || (!equipped && !item.quantity)}
                onClick={() => onChange?.({ type: 'toggle', id: item.id })}
              >
                {equipped ? 'Unequip' : 'Equip'} {item.name}
              </button>
            ) : (
              !equipped && (
                <button
                  disabled={disabled || !onChange || !item.quantity}
                  onClick={() => onChange?.({ type: 'use', id: item.id })}
                >
                  Use one {item.name} (−1)
                </button>
              )
            )}
          </article>
        );
      })}
    </section>
  );
}
