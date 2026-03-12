/** Edit screen — TipTap editor with options panel matching capture screen. */

import { getToken } from '../auth';
import { getFileContent, updateFile, getDefaultBranch } from '../api';
import { MARKERS, MARKER_MAP, type MarkerType, buildCommitMessage } from '../note-format';
import { parseNote, rebuildNote, setMarkerInRaw, toggleDoneInRaw } from '../frontmatter';
import { createEditor, getMarkdown } from '../editor';
import { state, render } from '../state';
import { escapeHtml, clearStatusAfterDelay } from '../utils';

// ── Helpers ─────────────────────────────────────────────────────────

/** Extract the group (folder) name from a note path like "general/2025-03-08-abc.md". */
function noteGroup(): string {
  if (!state.editNote) return '';
  const slash = state.editNote.path.indexOf('/');
  return slash > 0 ? state.editNote.path.slice(0, slash) : '';
}

/** The current effective title — edited value if touched, otherwise parsed. */
function effectiveTitle(): string {
  return state.editTitle ?? state.editNote?.parsed.title ?? '';
}

/** The current effective marker from parsed state. */
function currentMarker(): MarkerType | '' {
  return (state.editNote?.parsed.marker || '') as MarkerType | '';
}

// ── Options Panel ───────────────────────────────────────────────────

function optionsSummary(): string {
  const parts: string[] = [];
  const group = noteGroup();
  if (group) parts.push(group);
  const marker = currentMarker();
  if (marker) {
    const m = MARKER_MAP[marker];
    if (m) parts.push(`${m.icon} ${m.label}`);
  }
  if (state.editNote?.parsed.done) parts.push('✓ Done');
  return parts.length > 0 ? parts.join(' · ') : '';
}

function optionsPanelHtml(): string {
  if (!state.editOptionsPanelOpen) return '';

  const marker = currentMarker();
  const parsed = state.editNote!.parsed;

  return `
    <div class="options-panel" id="options-panel">
      <div class="options-section">
        <div class="options-label">Folder</div>
        <div class="group-picker">
          <span class="group-chip active">${escapeHtml(noteGroup())}</span>
        </div>
      </div>
      <div class="options-section">
        <div class="options-label">Marker</div>
        <div class="marker-picker">
          <button class="marker-chip ${marker === '' ? 'active' : ''}" data-marker="">None</button>
          ${MARKERS.map((m) => `
            <button class="marker-chip ${m.type === marker ? 'active' : ''}" data-marker="${m.type}">${m.icon} ${m.label}</button>
          `).join('')}
        </div>
      </div>
      ${marker ? `
        <div class="options-section">
          <div class="marker-picker">
            <button class="marker-chip ${parsed.done ? 'active' : ''}" id="done-toggle-btn">
              ${parsed.done ? '✓ Done' : 'Mark done'}
            </button>
          </div>
        </div>
      ` : ''}
    </div>
  `;
}

// ── Render ───────────────────────────────────────────────────────────

export function renderEdit(app: HTMLElement): void {
  if (!state.editNote) return;

  const summary = optionsSummary();
  const title = effectiveTitle();

  app.innerHTML = `
    <div class="edit-screen">
      <div class="header">
        <div class="header-actions">
          <button class="header-icon-btn" id="back-btn" title="Back">
            <span class="icon-label">&#8592;</span>
          </button>
        </div>
        <div class="header-actions">
          <button class="header-icon-btn ${state.editOptionsPanelOpen ? 'active' : ''}" id="options-toggle-btn" title="Options">
            <span class="icon-label">${state.editOptionsPanelOpen ? '&#9650;' : '&#9881;'}</span>
          </button>
          <button class="save-btn-pill" id="save-edit-btn" ${state.editSaving ? 'disabled' : ''}>
            ${state.editSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      ${summary && !state.editOptionsPanelOpen ? `<div class="options-summary" id="options-summary">${escapeHtml(summary)} ▾</div>` : ''}

      ${optionsPanelHtml()}

      ${state.status ? `<div class="status-message status-${state.status.type}">${escapeHtml(state.status.message)}</div>` : ''}

      <input type="text" class="title-input" id="edit-title-input" value="${escapeHtml(title)}" placeholder="Title" />

      <div class="editor-container" id="editor-mount"></div>
    </div>
  `;

  // Mount TipTap editor
  const mount = document.getElementById('editor-mount')!;
  let editBody = state.editNote.parsed.body;
  if (state.editNote.parsed.marker && editBody.trimStart().startsWith('<!--')) {
    editBody = editBody.replace(/^<!--\s*rs:[^\n]*-->\r?\n?/, '');
  }
  createEditor(mount, editBody, {
    resolveImageSrc: (relativeSrc) => {
      // ../_assets/foo.webp → _assets/foo.webp
      const assetPath = relativeSrc.replace(/^\.\.\//, '');
      return `https://raw.githubusercontent.com/${state.repo}/${getDefaultBranch()}/${assetPath}`;
    },
  });

  bindEditEvents();
}

// ── Events ──────────────────────────────────────────────────────────

function bindEditEvents(): void {
  // Back button
  document.getElementById('back-btn')!.addEventListener('click', () => {
    history.back();
  });

  // Save
  document.getElementById('save-edit-btn')!.addEventListener('click', handleSaveEdit);

  // Title editing
  document.getElementById('edit-title-input')?.addEventListener('input', (e) => {
    state.editTitle = (e.target as HTMLInputElement).value;
  });

  // Options toggle
  document.getElementById('options-toggle-btn')?.addEventListener('click', () => {
    state.editOptionsPanelOpen = !state.editOptionsPanelOpen;
    render();
  });

  // Options summary also opens panel
  document.getElementById('options-summary')?.addEventListener('click', () => {
    state.editOptionsPanelOpen = true;
    render();
  });

  // Marker chips (inside options panel)
  document.querySelectorAll('.marker-chip[data-marker]').forEach((el) => {
    el.addEventListener('click', () => {
      const newMarker = ((el as HTMLElement).dataset.marker || '') as MarkerType | '';
      handleTriageMarker(newMarker);
    });
  });

  // Done toggle (inside options panel)
  document.getElementById('done-toggle-btn')?.addEventListener('click', handleTriageDone);
}

// ── Save ────────────────────────────────────────────────────────────

/** Shared save-commit-refresh cycle for all edit-screen mutations. */
async function saveEditMutation(
  prepare: (note: NonNullable<typeof state.editNote>, token: string) => { content: string; commitMessage: string; successMessage: string },
): Promise<void> {
  if (!state.editNote) return;
  const token = getToken();
  if (!token) return;

  // Build the content BEFORE render() — render() destroys the TipTap editor
  // and recreates it with the original body, so getMarkdown() must run first.
  const { content, commitMessage, successMessage } = prepare(state.editNote, token);

  state.editSaving = true;
  state.status = { type: 'info', message: 'Saving...' };
  render();

  try {
    await updateFile(token, state.repo, state.editNote.path, content, state.editNote.sha, commitMessage);

    const updated = await getFileContent(token, state.repo, state.editNote.path);
    state.editNote.raw = updated.content;
    state.editNote.sha = updated.sha;
    state.editNote.parsed = parseNote(updated.content);
    // Reset editTitle to track the freshly saved value
    state.editTitle = null;
    state.status = { type: 'success', message: successMessage };
  } catch (e) {
    state.status = { type: 'error', message: `Save failed: ${e}` };
  }

  state.editSaving = false;
  render();
  if (state.status?.type === 'success') clearStatusAfterDelay();
}

/** @internal — exported for regression test (BUG-47) */
export async function handleSaveEdit(): Promise<void> {
  await saveEditMutation((note) => {
    let markdown = getMarkdown();
    if (note.parsed.marker && note.parsed.markerLine) {
      markdown = `${note.parsed.markerLine}\n${markdown}`;
    }

    // Apply title change if the user edited it
    const editedTitle = effectiveTitle();
    const parsed = editedTitle !== note.parsed.title
      ? { ...note.parsed, title: editedTitle }
      : note.parsed;

    return {
      content: rebuildNote(parsed, markdown),
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
