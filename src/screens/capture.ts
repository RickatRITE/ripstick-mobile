/** Capture screen — create new notes. */

import { getToken } from '../auth';
import { listFiles, createNote } from '../api';
import { buildFrontmatter, generateFilename, buildCommitMessage, MARKERS, MARKER_MAP, type MarkerType } from '../note-format';
import { state, render, disconnect, LAST_GROUP_KEY } from '../state';
import { escapeHtml, datePlaceholder, statusHtml } from '../utils';
import { loadRecentNotes } from './recent';

export function renderCapture(app: HTMLElement): void {
  const markerLabel = state.marker ? MARKER_MAP[state.marker] : null;

  app.innerHTML = `
    <div class="capture-screen">
      <div class="header">
        <div class="tab-bar">
          <span class="tab active">New</span>
          <span class="tab" id="tab-recent">Recent</span>
        </div>
        <span class="settings-link" id="signout-btn">Sign out</span>
      </div>

      <div class="group-picker">
        ${state.groups.map((g) => `
          <button class="group-chip ${g === state.selectedGroup ? 'active' : ''}" data-group="${g}">${g}</button>
        `).join('')}
      </div>

      <input type="text" class="title-input" id="title-input" value="${escapeHtml(state.title)}" placeholder="${datePlaceholder()}" />

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
        ${state.status ? `<div class="status-message status-${state.status.type}" style="margin-bottom: 8px">${statusHtml()}</div>` : ''}
        <button class="btn btn-primary" id="save-btn" ${state.saving ? 'disabled' : ''} style="width: 100%">
          ${state.saving ? 'Saving...' : 'Save Note'}
        </button>
      </div>
    </div>
  `;

  bindCaptureEvents();
}

function bindCaptureEvents(): void {
  document.getElementById('tab-recent')?.addEventListener('click', () => {
    state.status = null;
    state.screen = 'recent';
    loadRecentNotes();
    render();
  });
  document.getElementById('signout-btn')?.addEventListener('click', disconnect);

  document.querySelectorAll('.group-chip').forEach((el) => {
    el.addEventListener('click', () => {
      state.selectedGroup = (el as HTMLElement).dataset.group!;
      localStorage.setItem(LAST_GROUP_KEY, state.selectedGroup);
      render();
    });
  });

  if (state.markerExpanded) {
    document.querySelectorAll('.marker-chip').forEach((el) => {
      el.addEventListener('click', () => {
        state.marker = ((el as HTMLElement).dataset.marker || '') as MarkerType | '';
        state.markerExpanded = false;
        render();
      });
    });
  } else {
    document.getElementById('marker-toggle')?.addEventListener('click', () => {
      if (state.marker) {
        state.marker = '';
        render();
      } else {
        state.markerExpanded = true;
        render();
      }
    });
  }

  document.getElementById('title-input')!.addEventListener('input', (e) => {
    state.title = (e.target as HTMLInputElement).value;
  });
  document.getElementById('body-input')!.addEventListener('input', (e) => {
    state.body = (e.target as HTMLTextAreaElement).value;
  });
  document.getElementById('save-btn')!.addEventListener('click', () => handleSave(getToken()!));
}

async function handleSave(token: string): Promise<void> {
  const title = state.title.trim();
  const body = state.body.trim();

  if (!title && !body) {
    state.status = { type: 'error', message: 'Please enter a title or body.' };
    render();
    return;
  }

  state.saving = true;
  state.status = { type: 'info', message: 'Saving...' };
  render();

  try {
    const existingFiles = await listFiles(token, state.repo, state.selectedGroup);
    const filename = generateFilename(existingFiles);
    const now = new Date();
    const effectiveTitle = title || now.toLocaleString();
    const frontmatter = buildFrontmatter(effectiveTitle, now);

    let fullBody = body;
    if (state.marker) {
      fullBody = `<!-- rs:${state.marker} -->\n${body}`;
    }

    const content = `${frontmatter}\n${fullBody}\n`;
    const commitMessage = buildCommitMessage(state.selectedGroup, filename, effectiveTitle);

    await createNote(token, state.repo, state.selectedGroup, filename, content, commitMessage);

    const savedPath = `${state.selectedGroup}/${filename}`;
    state.lastSavedPath = savedPath;
    state.status = { type: 'success', message: `Saved to ${state.selectedGroup}` };
    state.title = '';
    state.body = '';
    state.marker = '';
    state.markerExpanded = false;
  } catch (e) {
    state.status = { type: 'error', message: `Save failed: ${e}` };
    state.lastSavedPath = null;
  }

  state.saving = false;
  render();

  if (state.status?.type === 'success') {
    setTimeout(() => {
      if (state.status?.type === 'success') {
        state.status = null;
        state.lastSavedPath = null;
        render();
      }
    }, 5000);
  }
}
