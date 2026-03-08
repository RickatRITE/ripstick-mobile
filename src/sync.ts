/** Flush-on-event sync engine — pushes outbox entries to GitHub. */

import { getAll, remove, markStatus, type OutboxEntry } from './outbox';
import { createNote } from './api';
import { getToken } from './auth';
import { generateFilename } from './note-format';
import { state, render } from './state';

const MAX_ATTEMPTS = 5;

let _flushing = false;

/** Attempt to sync all pending outbox entries. */
export async function flushOutbox(): Promise<void> {
  if (_flushing) return;
  _flushing = true;

  try {
    const entries = await getAll();
    const eligible = entries.filter(
      (e) => e.status === 'pending' || (e.status === 'failed' && e.attempts < MAX_ATTEMPTS),
    );

    if (eligible.length === 0) {
      await refreshSyncHealth();
      return;
    }

    for (const entry of eligible) {
      // Pick up fresh token from localStorage in case user re-authenticated
      const freshToken = getToken() || entry.token;

      await markStatus(entry.id, 'syncing');
      await refreshSyncHealth();

      try {
        await createNote(freshToken, entry.repo, entry.group, entry.filename, entry.content, entry.commitMessage);
        await remove(entry.id);
      } catch (e: any) {
        const status = extractHttpStatus(e);

        if (status === 422) {
          // Filename collision — regenerate and retry once
          const newFilename = generateFilename();
          try {
            const newCommitMessage = entry.commitMessage.replace(entry.filename, newFilename);
            await createNote(freshToken, entry.repo, entry.group, newFilename, entry.content, newCommitMessage);
            await remove(entry.id);
            continue;
          } catch (retryErr: any) {
            await markStatus(entry.id, 'failed', String(retryErr));
          }
        } else if (status === 401 || status === 403) {
          // Auth failure — stop flushing, leave remaining entries queued
          await markStatus(entry.id, 'failed', `Auth failed (${status})`);
          break;
        } else {
          await markStatus(entry.id, 'failed', String(e));
        }
      }
    }

    // Check for newly terminal entries (hit MAX_ATTEMPTS)
    const afterFlush = await getAll();
    const terminalCount = afterFlush.filter((e) => e.status === 'failed' && e.attempts >= MAX_ATTEMPTS).length;
    if (terminalCount > 0) {
      showToast(`${terminalCount} note${terminalCount > 1 ? 's' : ''} couldn't sync. Tap to review.`);
    }
  } finally {
    _flushing = false;
    await refreshSyncHealth();
  }
}

/** Recompute and update state.syncHealth from current outbox. */
export async function refreshSyncHealth(): Promise<void> {
  const entries = await getAll();

  if (entries.length === 0) {
    state.syncHealth = 'green';
  } else if (entries.some((e) => e.status === 'failed')) {
    state.syncHealth = 'red';
  } else if (entries.some((e) => e.status === 'syncing')) {
    state.syncHealth = 'syncing';
  } else {
    state.syncHealth = 'amber';
  }

  render();
}

function extractHttpStatus(err: any): number | null {
  const msg = String(err);
  const match = msg.match(/\((\d{3})\)/);
  return match ? parseInt(match[1], 10) : null;
}

function showToast(message: string): void {
  state.toast = message;
  render();
  setTimeout(() => {
    if (state.toast === message) {
      state.toast = null;
      render();
    }
  }, 6000);
}
