import type { Sheet } from './types';
import { previewResources, type ResourceChange } from './resources';

type Operation = {
  id: string;
  revision: number;
  operation_id: string;
  changes: ResourceChange[];
};
export type ResourceState = { sheet: Sheet; status: 'Saved' | 'Saving' | 'Failed'; error: string };

/** Serializes this editor's rapid edits, never rebasing across another editor's revision. */
export class ResourceWriter {
  private queue: ResourceChange[][] = [];
  private attempt?: Operation;
  private running = false;
  state: ResourceState;

  constructor(
    private actorId: string,
    private confirmed: Sheet,
    private revision: number,
    private send: (operation: Operation) => Promise<Record<string, string> | undefined>,
    private notify: (state: ResourceState) => void,
    private committed: (sheet: Sheet, revision: number) => void,
  ) {
    this.state = { sheet: confirmed, status: 'Saved', error: '' };
  }

  private publish(sheet: Sheet, status: ResourceState['status'], error = '') {
    this.state = { sheet, status, error };
    this.notify(this.state);
  }

  sync(sheet: Sheet, revision: number) {
    if (this.running || this.state.status !== 'Saved' || revision <= this.revision) return;
    this.confirmed = sheet;
    this.revision = revision;
    this.publish(sheet, 'Saved');
  }

  enqueue(changes: ResourceChange[]) {
    if (this.state.status === 'Failed') return;
    const next = previewResources(this.state.sheet, changes);
    this.queue.push(changes);
    this.publish(next, 'Saving');
    void this.flush();
  }

  retry() {
    if (this.state.status !== 'Failed') return;
    // The exact operation ID, revision, and payload survive an unconfirmed response.
    this.publish(this.confirmed, 'Saving');
    void this.flush();
  }

  discard(sheet: Sheet, revision: number) {
    if (this.running) return false;
    this.queue = [];
    this.attempt = undefined;
    const accepted = revision >= this.revision;
    if (accepted) {
      this.confirmed = sheet;
      this.revision = revision;
    }
    this.publish(this.confirmed, 'Saved');
    this.committed(this.confirmed, this.revision);
    return accepted;
  }

  private async flush() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        this.attempt ??= {
          id: this.actorId,
          revision: this.revision,
          operation_id: crypto.randomUUID(),
          changes: this.queue[0],
        };
        const result = await this.send(this.attempt);
        if (!result?.sheet || !result.revision) throw new Error('Update not confirmed.');
        this.confirmed = JSON.parse(result.sheet) as Sheet;
        this.revision = Number(result.revision);
        this.queue.shift();
        this.attempt = undefined;
        this.committed(this.confirmed, this.revision);
        const view = this.queue.reduce(
          (s, changes) => previewResources(s, changes),
          this.confirmed,
        );
        this.publish(view, this.queue.length ? 'Saving' : 'Saved');
      }
    } catch {
      this.publish(
        this.confirmed,
        'Failed',
        'Update failed or is unconfirmed. Retry safely, or reload resources and review the latest values.',
      );
    } finally {
      this.running = false;
    }
  }
}
