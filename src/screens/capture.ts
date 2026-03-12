/** Capture screen — create new notes with offline-resilient save. */

import { getToken } from '../auth';
import { processImage } from '../image-utils';
import { buildFrontmatter, generateFilename, buildCommitMessage, MARKERS, MARKER_MAP, type MarkerType } from '../note-format';
import { enqueue, saveDraft, clearDraft } from '../outbox';
import { flushOutbox } from '../sync';
import { state, render, navigate, disconnect, LAST_GROUP_KEY } from '../state';
import { escapeHtml, syncDotHtml } from '../utils';
import { loadRecentNotes } from './recent';

let _draftTimer: ReturnType<typeof setTimeout> | null = null;

// ── Toast HTML ───────────────────────────────────────────────────────

function toastHtml(): string {
  if (!state.toast) return '';
  return `<div class="toast" id="toast-bar">${escapeHtml(state.toast)}</div>`;
}

// ── Options Panel (group + marker pickers) ───────────────────────────

function optionsSummary(): string {
  const parts: string[] = [];
  if (state.selectedGroup) parts.push(state.selectedGroup);
  if (state.marker) {
    const m = MARKER_MAP[state.marker];
    if (m) parts.push(`${m.icon} ${m.label}`);
  }
  return parts.length > 0 ? parts.join(' · ') : '';
}

function optionsPanelHtml(): string {
  if (!state.optionsPanelOpen) return '';

  const markerLabel = state.marker ? MARKER_MAP[state.marker] : null;

  return `
    <div class="options-panel" id="options-panel">
      <div class="options-section">
        <div class="options-label">Folder</div>
        <div class="group-picker">
          ${state.groups.map((g) => `
            <button class="group-chip ${g === state.selectedGroup ? 'active' : ''}" data-group="${g}">${g}</button>
          `).join('')}
        </div>
      </div>
      <div class="options-section">
        <div class="options-label">Marker</div>
        <div class="marker-picker">
          <button class="marker-chip ${state.marker === '' ? 'active' : ''}" data-marker="">None</button>
          ${MARKERS.map((m) => `
            <button class="marker-chip ${m.type === state.marker ? 'active' : ''}" data-marker="${m.type}">${m.icon} ${m.label}</button>
          `).join('')}
        </div>
      </div>
      <div class="options-section">
        <button class="attach-image-btn" id="attach-image-btn">
          ${state.pendingAsset ? '&#128247; Image attached' : '&#128247; Attach image'}
        </button>
        <input type="file" accept="image/*" id="image-file-input" style="display:none" />
      </div>
      <div class="options-section options-footer">
        <span class="settings-link" id="signout-btn">Sign out</span>
      </div>
    </div>
  `;
}

// ── Render ───────────────────────────────────────────────────────────

export function renderCapture(app: HTMLElement): void {
  const summary = optionsSummary();

  app.innerHTML = `
    <div class="capture-screen">
      <div class="header">
        <div class="tab-bar">
          <span class="tab active">New</span>
          <span class="tab" id="tab-recent">Recent ${syncDotHtml()}</span>
        </div>
        <div class="header-actions">
          <button class="header-icon-btn ${state.optionsPanelOpen ? 'active' : ''}" id="options-toggle-btn" title="Options">
            <span class="icon-label">${state.optionsPanelOpen ? '&#9650;' : '&#9881;'}</span>
          </button>
          <button class="header-icon-btn save-icon-btn" id="save-btn" ${state.saving ? 'disabled' : ''} title="Save note">
            <span class="icon-label">${state.saving ? '...' : '&#10003;'}</span>
          </button>
        </div>
      </div>

      ${summary && !state.optionsPanelOpen ? `<div class="options-summary" id="options-summary">${escapeHtml(summary)} ▾</div>` : ''}

      ${optionsPanelHtml()}

      ${state.status ? `<div class="status-message status-${state.status.type}">${escapeHtml(state.status.message)}</div>` : ''}

      <input type="text" class="title-input" id="title-input" value="${escapeHtml(state.title)}" placeholder="Title" />

      <div class="body-group">
        <textarea id="body-input" placeholder="Write your note...">${escapeHtml(state.body)}</textarea>
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
    state.optionsPanelOpen = false;
    navigate('recent');
    loadRecentNotes();
  });

  // Sign out (inside options panel)
  document.getElementById('signout-btn')?.addEventListener('click', () => disconnect());

  // Sync dot → open outbox view (stop propagation so tab click doesn't fire)
  document.getElementById('sync-dot')?.addEventListener('click', (e) => {
    e.stopPropagation();
    navigate('outbox');
  });

  // Toast → open outbox view
  document.getElementById('toast-bar')?.addEventListener('click', () => {
    state.toast = null;
    navigate('outbox');
  });

  // Options toggle
  document.getElementById('options-toggle-btn')?.addEventListener('click', () => {
    state.optionsPanelOpen = !state.optionsPanelOpen;
    render();
  });

  // Options summary also opens panel
  document.getElementById('options-summary')?.addEventListener('click', () => {
    state.optionsPanelOpen = true;
    render();
  });

  // Group chips (inside options panel)
  document.querySelectorAll('.group-chip').forEach((el) => {
    el.addEventListener('click', () => {
      state.selectedGroup = (el as HTMLElement).dataset.group!;
      localStorage.setItem(LAST_GROUP_KEY, state.selectedGroup);
      scheduleDraftSave();
      render();
    });
  });

  // Marker chips (inside options panel)
  document.querySelectorAll('.marker-chip').forEach((el) => {
    el.addEventListener('click', () => {
      state.marker = ((el as HTMLElement).dataset.marker || '') as MarkerType | '';
      scheduleDraftSave();
      render();
    });
  });

  // Attach image — trigger hidden file input
  document.getElementById('attach-image-btn')?.addEventListener('click', () => {
    document.getElementById('image-file-input')?.click();
  });

  // Process selected image file
  document.getElementById('image-file-input')?.addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;

    try {
      const { filename, webpBytes } = await processImage(file);
      state.pendingAsset = { filename, data: webpBytes.buffer as ArrayBuffer };

      // Embed image reference in the body
      const imageMarkdown = `![Image](../_assets/${filename})`;
      const bodyInput = document.getElementById('body-input') as HTMLTextAreaElement;
      const currentBody = bodyInput?.value || state.body;
      state.body = currentBody ? currentBody + '\n\n' + imageMarkdown : imageMarkdown;
      scheduleDraftSave();
      render();
    } catch {
      state.status = { type: 'error', message: 'Failed to process image.' };
      render();
    }
  });

  document.getElementById('title-input')?.addEventListener('input', (e) => {
    state.title = (e.target as HTMLInputElement).value;
    scheduleDraftSave();
  });
  document.getElementById('body-input')?.addEventListener('input', (e) => {
    state.body = (e.target as HTMLTextAreaElement).value;
    scheduleDraftSave();
  });
  document.getElementById('save-btn')?.addEventListener('click', handleSave);
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
      asset: state.pendingAsset ?? undefined,
    });

    // Clear form and draft
    state.title = '';
    state.body = '';
    state.marker = '';
    state.markerExpanded = false;
    state.optionsPanelOpen = false;
    state.pendingAsset = null;
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
