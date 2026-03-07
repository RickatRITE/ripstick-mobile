/** Edit screen — TipTap editor + triage actions. */

import { getToken } from '../auth';
import { getFileContent, updateFile } from '../api';
import { MARKERS, MARKER_MAP, type MarkerType, buildCommitMessage } from '../note-format';
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

  // Back button — use history.back() so it pops the history entry
  document.getElementById('back-btn')!.addEventListener('click', () => {
    history.back();
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

/** Shared save-commit-refresh cycle for all edit-screen mutations. */
async function saveEditMutation(
  prepare: (note: NonNullable<typeof state.editNote>, token: string) => { content: string; commitMessage: string; successMessage: string },
): Promise<void> {
  if (!state.editNote) return;
  const token = getToken();
  if (!token) return;

  state.editSaving = true;
  state.status = { type: 'info', message: 'Saving...' };
  render();

  try {
    const { content, commitMessage, successMessage } = prepare(state.editNote, token);
    await updateFile(token, state.repo, state.editNote.path, content, state.editNote.sha, commitMessage);

    const updated = await getFileContent(token, state.repo, state.editNote.path);
    state.editNote.raw = updated.content;
    state.editNote.sha = updated.sha;
    state.editNote.parsed = parseNote(updated.content);
    state.status = { type: 'success', message: successMessage };
  } catch (e) {
    state.status = { type: 'error', message: `Save failed: ${e}` };
  }

  state.editSaving = false;
  render();
  if (state.status?.type === 'success') clearStatusAfterDelay();
}

async function handleSaveEdit(): Promise<void> {
  await saveEditMutation((note) => {
    let markdown = getMarkdown();
    if (note.parsed.marker && note.parsed.markerLine) {
      markdown = `${note.parsed.markerLine}\n${markdown}`;
    }
    return {
      content: rebuildNote(note.parsed, markdown),
      commitMessage: buildCommitMessage({ action: 'content-edit', file: note.path, detail: 'Edited on mobile' }),
      successMessage: 'Saved',
    };
  });
}

async function handleTriageMarker(newMarker: MarkerType | ''): Promise<void> {
  if (newMarker === state.editNote?.parsed.marker) return;
  await saveEditMutation((note) => ({
    content: setMarkerInRaw(note.raw, newMarker, false),
    commitMessage: buildCommitMessage({ action: 'triage', file: note.path, detail: `Changed marker to ${newMarker || 'none'}`, priority: 'low' }),
    successMessage: 'Saved',
  }));
}

async function handleTriageDone(): Promise<void> {
  if (!state.editNote?.parsed.marker) return;
  const newDone = !state.editNote.parsed.done;
  await saveEditMutation((note) => ({
    content: toggleDoneInRaw(note.raw),
    commitMessage: buildCommitMessage({ action: 'triage', file: note.path, detail: `Marked ${newDone ? 'done' : 'undone'}`, priority: 'low' }),
    successMessage: newDone ? 'Done' : 'Reopened',
  }));
}
