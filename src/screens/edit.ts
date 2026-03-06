/** Edit screen — TipTap editor + triage actions. */

import { getToken } from '../auth';
import { getFileContent, updateFile } from '../api';
import { MARKERS, MARKER_MAP, type MarkerType } from '../note-format';
import { parseNote, rebuildNote, setMarkerInRaw, toggleDoneInRaw } from '../frontmatter';
import { createEditor, getMarkdown, destroyEditor } from '../editor';
import { state, render, navigate } from '../state';
import { escapeHtml, clearStatusAfterDelay } from '../utils';

export function renderEdit(app: HTMLElement): void {
  if (!state.editNote) return;

  const { parsed } = state.editNote;

  app.innerHTML = `
    <div class="edit-screen">
      <div class="header">
        <span class="back-link" id="back-btn">← Back</span>
        <span class="edit-title">${escapeHtml(parsed.title || 'Untitled')}</span>
        <span class="settings-link" id="save-edit-btn">${state.editSaving ? 'Saving...' : 'Save'}</span>
      </div>

      <div class="triage-bar">
        <div class="triage-markers">
          <button class="triage-chip ${!parsed.marker ? 'active' : ''}" data-triage-marker="">—</button>
          ${MARKERS.map((m) => `
            <button class="triage-chip ${m.type === parsed.marker ? 'active' : ''}" data-triage-marker="${m.type}">${m.icon}</button>
          `).join('')}
        </div>
        ${parsed.marker ? `
          <button class="triage-done ${parsed.done ? 'is-done' : ''}" id="triage-done-btn">
            ${parsed.done ? '✓ Done' : 'Mark done'}
          </button>
        ` : ''}
      </div>

      <div class="editor-container" id="editor-mount"></div>

      <div class="form-footer">
        ${state.status ? `<div class="status-message status-${state.status.type}">${state.status.message}</div>` : ''}
      </div>
    </div>
  `;

  // Mount TipTap editor
  const mount = document.getElementById('editor-mount')!;
  let editBody = parsed.body;
  if (parsed.marker && editBody.trimStart().startsWith('<!--')) {
    editBody = editBody.replace(/^<!--\s*rs:[^\n]*-->\r?\n?/, '');
  }
  createEditor(mount, editBody);

  // Back button
  document.getElementById('back-btn')!.addEventListener('click', () => {
    destroyEditor();
    state.editNote = null;
    state.status = null;
    navigate('recent');
  });

  // Save content edit
  document.getElementById('save-edit-btn')!.addEventListener('click', handleSaveEdit);

  // Triage: marker type change
  document.querySelectorAll('.triage-chip').forEach((el) => {
    el.addEventListener('click', () => {
      const newMarker = (el as HTMLElement).dataset.triageMarker || '';
      handleTriageMarker(newMarker as MarkerType | '');
    });
  });

  // Triage: done toggle
  document.getElementById('triage-done-btn')?.addEventListener('click', handleTriageDone);
}

async function handleSaveEdit(): Promise<void> {
  if (!state.editNote) return;
  const token = getToken();
  if (!token) return;

  state.editSaving = true;
  state.status = { type: 'info', message: 'Saving...' };
  render();

  try {
    let markdown = getMarkdown();

    // Re-prepend marker comment if present (use markerLine which reflects triage changes)
    if (state.editNote.parsed.marker && state.editNote.parsed.markerLine) {
      markdown = `${state.editNote.parsed.markerLine}\n${markdown}`;
    }

    const fullContent = rebuildNote(state.editNote.parsed, markdown);
    const commitMessage = `[content-edit] ${state.editNote.path}\n\nripstick-action: content-edit\nripstick-file: ${state.editNote.path}\nripstick-detail: Edited on mobile\nripstick-priority: medium`;

    await updateFile(token, state.repo, state.editNote.path, fullContent, state.editNote.sha, commitMessage);

    state.status = { type: 'success', message: 'Saved' };
    // Update SHA for subsequent saves
    const updated = await getFileContent(token, state.repo, state.editNote.path);
    state.editNote.sha = updated.sha;
  } catch (e) {
    state.status = { type: 'error', message: `Save failed: ${e}` };
  }

  state.editSaving = false;
  render();
  if (state.status?.type === 'success') clearStatusAfterDelay();
}

async function handleTriageMarker(newMarker: MarkerType | ''): Promise<void> {
  if (!state.editNote) return;
  const token = getToken();
  if (!token) return;

  // Same marker — no-op
  if (newMarker === state.editNote.parsed.marker) return;

  state.editSaving = true;
  state.status = { type: 'info', message: 'Saving...' };
  render();

  try {
    const newRaw = setMarkerInRaw(state.editNote.raw, newMarker, false);
    const commitMessage = `[triage] ${state.editNote.path}\n\nripstick-action: triage\nripstick-file: ${state.editNote.path}\nripstick-detail: Changed marker to ${newMarker || 'none'}\nripstick-priority: low`;

    await updateFile(token, state.repo, state.editNote.path, newRaw, state.editNote.sha, commitMessage);

    // Refresh local state
    const updated = await getFileContent(token, state.repo, state.editNote.path);
    state.editNote.raw = updated.content;
    state.editNote.sha = updated.sha;
    state.editNote.parsed = parseNote(updated.content);
    state.status = { type: 'success', message: 'Saved' };
  } catch (e) {
    state.status = { type: 'error', message: `Triage failed: ${e}` };
  }

  state.editSaving = false;
  render();
  clearStatusAfterDelay();
}

async function handleTriageDone(): Promise<void> {
  if (!state.editNote || !state.editNote.parsed.marker) return;
  const token = getToken();
  if (!token) return;

  state.editSaving = true;
  state.status = { type: 'info', message: 'Saving...' };
  render();

  try {
    const newRaw = toggleDoneInRaw(state.editNote.raw);
    const newDone = !state.editNote.parsed.done;
    const commitMessage = `[triage] ${state.editNote.path}\n\nripstick-action: triage\nripstick-file: ${state.editNote.path}\nripstick-detail: Marked ${newDone ? 'done' : 'undone'}\nripstick-priority: low`;

    await updateFile(token, state.repo, state.editNote.path, newRaw, state.editNote.sha, commitMessage);

    const updated = await getFileContent(token, state.repo, state.editNote.path);
    state.editNote.raw = updated.content;
    state.editNote.sha = updated.sha;
    state.editNote.parsed = parseNote(updated.content);
    state.status = { type: 'success', message: newDone ? 'Done' : 'Reopened' };
  } catch (e) {
    state.status = { type: 'error', message: `Triage failed: ${e}` };
  }

  state.editSaving = false;
  render();
  clearStatusAfterDelay();
}
