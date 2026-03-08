/** Capture screen — create new notes with offline-resilient save. */

import { getToken } from '../auth';
import { buildFrontmatter, generateFilename, buildCommitMessage, MARKERS, MARKER_MAP, type MarkerType } from '../note-format';
import { enqueue, saveDraft, clearDraft } from '../outbox';
import { flushOutbox } from '../sync';
import { state, render, navigate, disconnect, LAST_GROUP_KEY } from '../state';
import { escapeHtml } from '../utils';
import { loadRecentNotes } from './recent';

let _draftTimer: ReturnType<typeof setTimeout> | null = null;

// ── Sync Dot HTML ────────────────────────────────────────────────────

function syncDotHtml(): string {
  const { syncHealth } = state;
  const cls = syncHealth === 'syncing' ? 'sync-dot sync-dot--syncing' : `sync-dot sync-dot--${syncHealth}`;
  return `<span class="${cls}" id="sync-dot" title="Sync status"></span>`;
}

// ── Toast HTML ───────────────────────────────────────────────────────

function toastHtml(): string {
  if (!state.toast) return '';
  return `<div class="toast" id="toast-bar">${escapeHtml(state.toast)}</div>`;
}

// ── Render ───────────────────────────────────────────────────────────

export function renderCapture(app: HTMLElement): void {
  const markerLabel = state.marker ? MARKER_MAP[state.marker] : null;

  app.innerHTML = `
    <div class="capture-screen">
      <div class="header">
        <div class="tab-bar">
          <span class="tab active">New</span>
          <span class="tab" id="tab-recent">Recent</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          ${syncDotHtml()}
          <span style="font-size:10px;color:var(--fg-muted)">v14</span>
          <span class="settings-link" id="signout-btn">Sign out</span>
        </div>
      </div>

      <div class="group-picker">
        ${state.groups.map((g) => `
          <button class="group-chip ${g === state.selectedGroup ? 'active' : ''}" data-group="${g}">${g}</button>
        `).join('')}
      </div>

      <input type="text" class="title-input" id="title-input" value="${escapeHtml(state.title)}" placeholder="Title" />

      <div class="body-group">
        <textarea id="body-input" placeholder="Write your note...">${escapeHtml(state.body)}</textarea>
      </div>

      ${state.markerExpanded ? `
        <div class="marker-picker">
          <button class="marker-chip ${state.marker === '' ? 'active' : ''}" data-marker="">None</button>
          ${MARKERS.map((m) => `
            <button class="marker-chip ${m.type === state.marker ? 'active' : ''}" data-marker="${m.type}">${m.icon} ${m.label}</button>
          `).join('')}
        </div>
      ` : `
        <span class="marker-toggle" id="marker-toggle">${markerLabel ? `${markerLabel.icon} ${markerLabel.label} ✕` : '+ Add marker'}</span>
      `}

      <div class="form-footer">
        ${state.status ? `<div class="status-message status-${state.status.type}" style="margin-bottom: 8px">${escapeHtml(state.status.message)}</div>` : ''}
        <button class="btn btn-primary" id="save-btn" ${state.saving ? 'disabled' : ''} style="width: 100%">
          ${state.saving ? 'Saving...' : 'Save Note'}
        </button>
      </div>

      ${toastHtml()}
    </div>
  `;

  bindCaptureEvents();
}

// ── Events ───────────────────────────────────────────────────────────

function bindCaptureEvents(): void {
  document.getElementById('tab-recent')?.addEventListener('click', () => {
    state.status = null;
    navigate('recent');
    loadRecentNotes();
  });
  document.getElementById('signout-btn')?.addEventListener('click', () => disconnect());

  // Sync dot → open outbox view
  document.getElementById('sync-dot')?.addEventListener('click', () => {
    navigate('outbox');
  });

  // Toast → open outbox view
  document.getElementById('toast-bar')?.addEventListener('click', () => {
    state.toast = null;
    navigate('outbox');
  });

  document.querySelectorAll('.group-chip').forEach((el) => {
    el.addEventListener('click', () => {
      state.selectedGroup = (el as HTMLElement).dataset.group!;
      localStorage.setItem(LAST_GROUP_KEY, state.selectedGroup);
      scheduleDraftSave();
      render();
    });
  });

  if (state.markerExpanded) {
    document.querySelectorAll('.marker-chip').forEach((el) => {
      el.addEventListener('click', () => {
        state.marker = ((el as HTMLElement).dataset.marker || '') as MarkerType | '';
        state.markerExpanded = false;
        scheduleDraftSave();
        render();
      });
    });
  } else {
    document.getElementById('marker-toggle')?.addEventListener('click', () => {
      if (state.marker) {
        state.marker = '';
        scheduleDraftSave();
        render();
      } else {
        state.markerExpanded = true;
        render();
      }
    });
  }

  document.getElementById('title-input')!.addEventListener('input', (e) => {
    state.title = (e.target as HTMLInputElement).value;
    scheduleDraftSave();
  });
  document.getElementById('body-input')!.addEventListener('input', (e) => {
    state.body = (e.target as HTMLTextAreaElement).value;
    scheduleDraftSave();
  });
  document.getElementById('save-btn')!.addEventListener('click', handleSave);
}

// ── Draft Persistence ────────────────────────────────────────────────

function scheduleDraftSave(): void {
  if (_draftTimer) clearTimeout(_draftTimer);
  _draftTimer = setTimeout(() => {
    saveDraft({
      title: state.title,
      body: state.body,
      marker: state.marker,
      group: state.selectedGroup,
    }).catch(() => {});
  }, 500);
}

// ── Save (Optimistic Capture) ────────────────────────────────────────

async function handleSave(): Promise<void> {
  const title = state.title.trim();
  const body = state.body.trim();

  if (!title && !body) {
    state.status = { type: 'error', message: 'Please enter a title or body.' };
    render();
    return;
  }

  state.saving = true;
  render();

  try {
    const now = new Date();
    const effectiveTitle = title || now.toLocaleString();
    const filename = generateFilename();
    const frontmatter = buildFrontmatter(effectiveTitle, now);

    let fullBody = body;
    if (state.marker) {
      fullBody = `<!-- rs:${state.marker} -->\n${body}`;
    }

    const content = `${frontmatter}\n${fullBody}\n`;
    const commitMessage = buildCommitMessage({
      action: 'note-created',
      file: `${state.selectedGroup}/${filename}`,
      detail: `Created note: ${effectiveTitle}`,
    });

    const token = getToken() || '';
    const repo = state.repo;

    // Persist to IndexedDB — this is the moment the save "succeeds"
    await enqueue({
      group: state.selectedGroup,
      filename,
      content,
      commitMessage,
      createdAt: Date.now(),
      token,
      repo,
    });

    // Clear form and draft
    state.title = '';
    state.body = '';
    state.marker = '';
    state.markerExpanded = false;
    state.status = { type: 'success', message: 'Saved' };
    state.lastSavedPath = null;
    await clearDraft();

    // Try to sync immediately (no-op if offline)
    flushOutbox().catch(() => {});

    setTimeout(() => {
      if (state.status?.type === 'success') {
        state.status = null;
        render();
      }
    }, 3000);
  } catch {
    state.status = { type: 'error', message: 'Failed to save note. Please try again.' };
  }

  state.saving = false;
  render();
}
