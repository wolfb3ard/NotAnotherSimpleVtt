'use client';

import { useState } from 'react';
import { ActionForm } from './action-form';

export function JournalSharing({
  entry,
  current,
  members,
  action,
}: {
  entry: string;
  current: string;
  members: { user_id: string; display_name: string }[];
  action: (form: FormData) => Promise<{ error?: string; success?: string }>;
}) {
  const [audience, setAudience] = useState(current);
  const player = members.find((member) => member.user_id === audience);
  const label =
    audience === 'private'
      ? 'Make GM-only'
      : audience === 'party'
        ? 'Share with party'
        : player
          ? `Share with ${player.display_name}`
          : 'Choose an audience';
  return (
    <ActionForm
      action={action}
      label={label}
      disabled={audience === current || label === 'Choose an audience'}
    >
      <input type="hidden" name="entry" value={entry} />
      <label>
        Change visibility
        <select name="audience" value={audience} onChange={(e) => setAudience(e.target.value)}>
          <option value="private">GM only</option>
          <option value="party">Party</option>
          {!['private', 'party'].includes(current) &&
            !members.some((m) => m.user_id === current) && (
              <option value={current} disabled>
                Former player
              </option>
            )}
          {members.map((member) => (
            <option key={member.user_id} value={member.user_id}>
              {member.display_name}
            </option>
          ))}
        </select>
      </label>
    </ActionForm>
  );
}
