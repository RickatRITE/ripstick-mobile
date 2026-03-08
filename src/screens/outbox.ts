/** Outbox screen — view and manage queued notes. */

import { getAll, remove, resetAttempts, type OutboxEntry } from '../outbox';
import { flushOutbox, refreshSyncHealth } from '../sync';
import { state, render, navigate } from '../state';
import { escapeHtml } from '../utils';

let _entries: OutboxEntry[] = [];

export function renderOutbox(app: HTMLElement): void {
  // Show loading state, then fetch entries and re-render
  app.innerHTML = `
    <div class="capture-screen">
      <div class="header">
        <span class="back-link" id="outbox-back">← Back</span>
        <span class="edit-title">Outbox</span>
        <span style="width:40px"></span>
      </div>
      <div class="loading-indicator">Loading...</div>
    </div>
  `;
  document.getElementById('outbox-back')?.addEventListener('click', () => navigate('capture'));

  getAll().then((entries) => {
    _entries = entries;
    if (state.screen === 'outbox') renderOutboxInner(app);
  }).catch(() => {
    _entries = [];
    if (state.screen === 'outbox') renderOutboxInner(app);
  });
}

function renderOutboxInner(app: HTMLElement): void {
  const failedCount = _entries.filter((e) => e.status === 'failed').length;

  app.innerHTML = `
    <div class="capture-screen">
      <div class="header">
        <span class="back-link" id="outbox-back">← Back</span>
        <span class="edit-title">Outbox</span>
        <span style="width:40px"></span>
      </div>

      ${failedCount >= 2 ? `
        <button class="btn btn-secondary" id="retry-all-btn" style="margin-bottom:8px;width:100%">Retry all (${failedCount})</button>
      ` : ''}

      ${_entries.length === 0 ? `
        <div class="empty-state">All notes synced</div>
      ` : `
        <div class="outbox-list">
          ${_entries.map((e) => `
            <div class="outbox-item ${e.status === 'failed' ? 'outbox-item--failed' : ''}" data-id="${e.id}">
              <div class="outbox-item-info">
                <span class="outbox-item-title">${escapeHtml(extractTitle(e))}</span>
                <span class="outbox-item-group">${escapeHtml(e.group)}</span>
              </div>
              <div class="outbox-item-status">
                ${statusLabel(e)}
              </div>
              <button class="outbox-item-delete" data-delete-id="${e.id}" title="Delete">✕</button>
            </div>
          `).join('')}
        </div>
      `}
    </div>
  `;

  bindOutboxEvents(app);
}

function extractTitle(entry: OutboxEntry): string {
  const match = entry.content.match(/^---[\s\S]*?title:\s*"([^"]*)"[\s\S]*?---/);
  if (match?.[1]) return match[1];
  return new Date(entry.createdAt).toLocaleString();
}

function statusLabel(entry: OutboxEntry): string {
  switch (entry.status) {
    case 'pending': return '<span class="outbox-status outbox-status--pending">Waiting to sync</span>';
    case 'syncing': return '<span class="outbox-status outbox-status--syncing">Syncing...</span>';
    case 'failed': return '<span class="outbox-status outbox-status--failed">Failed — tap to retry</span>';
  }
}

function bindOutboxEvents(app: HTMLElement): void {
  document.getElementById('outbox-back')?.addEventListener('click', () => {
    navigate('capture');
  });

  document.getElementById('retry-all-btn')?.addEventListener('click', async () => {
    try {
      for (const e of _entries) {
        if (e.status === 'failed') await resetAttempts(e.id);
      }
      flushOutbox().catch(() => {});
      _entries = await getAll();
      renderOutboxInner(app);
    } catch {
      state.status = { type: 'error', message: 'Retry failed.' };
      render();
    }
  });

  // Tap a failed entry to retry
  document.querySelectorAll('.outbox-item--failed').forEach((el) => {
    el.addEventListener('click', async (ev) => {
      if ((ev.target as HTMLElement).closest('.outbox-item-delete')) return;
      try {
        const id = Number((el as HTMLElement).dataset.id);
        await resetAttempts(id);
        flushOutbox().catch(() => {});
        _entries = await getAll();
        renderOutboxInner(app);
      } catch {
        state.status = { type: 'error', message: 'Retry failed.' };
        render();
      }
    });
  });

  // Delete buttons
  document.querySelectorAll('.outbox-item-delete').forEach((el) => {
    el.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const id = Number((el as HTMLElement).dataset.deleteId);
      const entry = _entries.find((e) => e.id === id);
      const title = entry ? extractTitle(entry) : 'this note';
      if (!confirm(`Delete "${title}" from outbox? This note will be lost.`)) return;
      try {
        await remove(id);
        _entries = await getAll();
        await refreshSyncHealth();
        renderOutboxInner(app);
      } catch {
        state.status = { type: 'error', message: 'Delete failed.' };
        render();
      }
    });
  });
}
