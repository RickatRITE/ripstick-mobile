/** Recent notes screen — list and open notes. */

import { getToken } from '../auth';
import { getAllFiles, getFileContent } from '../api';
import { parseNote } from '../frontmatter';
import { state, render, navigate, disconnect, type NoteListItem } from '../state';

export function renderRecent(app: HTMLElement): void {
  app.innerHTML = `
    <div class="capture-screen">
      <div class="header">
        <div class="tab-bar">
          <span class="tab" id="tab-new">New</span>
          <span class="tab active">Recent</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:10px;color:var(--fg-muted)">v10</span>
          <span class="settings-link" id="signout-btn">Sign out</span>
        </div>
      </div>

      ${state.recentLoading ? `
        <div class="loading-indicator">Loading notes...</div>
      ` : `
        <div class="note-list">
          ${state.recentNotes.length === 0 ? '<div class="empty-state">No notes found</div>' : ''}
          ${state.recentNotes.map((n) => `
            <button class="note-list-item" data-path="${n.path}">
              <span class="note-item-group">${n.group}</span>
              <span class="note-item-name" data-title-path="${n.path}">${n.title || n.filename.replace('.md', '')}</span>
            </button>
          `).join('')}
        </div>
      `}
    </div>
  `;

  document.getElementById('tab-new')?.addEventListener('click', () => {
    state.status = null;
    navigate('capture');
  });
  document.getElementById('signout-btn')?.addEventListener('click', disconnect);

  document.querySelectorAll('.note-list-item').forEach((el) => {
    el.addEventListener('click', () => {
      const path = (el as HTMLElement).dataset.path!;
      openNote(path);
    });
  });
}

export async function loadRecentNotes(): Promise<void> {
  const token = getToken();
  if (!token) return;

  state.recentLoading = true;
  render();

  try {
    const allFiles = await getAllFiles(token, state.repo);

    const notes: NoteListItem[] = allFiles
      .filter((f) => {
        const parts = f.path.split('/');
        return parts.length >= 2 && !parts[parts.length - 1].startsWith('_');
      })
      .map((f) => {
        const parts = f.path.split('/');
        const filename = parts[parts.length - 1];
        const group = parts.slice(0, -1).join('/');
        const dateMatch = filename.match(/^(\d{4}-\d{2}-\d{2})/);
        return {
          path: f.path,
          group,
          filename,
          sha: f.sha,
          date: dateMatch ? dateMatch[1] : '0000-00-00',
        };
      });

    notes.sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return b.filename.localeCompare(a.filename);
    });

    state.recentNotes = notes.slice(0, 30);
  } catch (e) {
    state.status = { type: 'error', message: `Failed to load notes: ${e}` };
  }

  state.recentLoading = false;
  render();

  // Fetch titles in background for notes that don't have one yet
  if (token && state.recentNotes.length > 0) {
    fetchTitles(token);
  }
}

async function fetchTitles(token: string): Promise<void> {
  const toFetch = state.recentNotes.filter((n) => !n.title);
  if (toFetch.length === 0) return;

  // Fetch in parallel, batches of 10 to avoid overwhelming the API
  for (let i = 0; i < toFetch.length; i += 10) {
    const batch = toFetch.slice(i, i + 10);
    await Promise.all(batch.map(async (note) => {
      try {
        const { content } = await getFileContent(token, state.repo, note.path);
        const parsed = parseNote(content);
        if (parsed.title) note.title = parsed.title;
        if (parsed.updated) note.updated = parsed.updated;
      } catch {
        // Silently skip — filename stays as fallback
      }
    }));
  }

  // Re-sort by updated timestamp (matches desktop sort order) and re-render
  state.recentNotes.sort((a, b) => {
    const aKey = a.updated || a.date;
    const bKey = b.updated || b.date;
    return bKey.localeCompare(aKey);
  });

  if (state.screen === 'recent') render();
}

async function openNote(path: string): Promise<void> {
  const token = getToken();
  if (!token) return;

  state.status = { type: 'info', message: 'Loading...' };
  state.screen = 'edit';
  render();

  try {
    const { content, sha } = await getFileContent(token, state.repo, path);
    const parsed = parseNote(content);

    state.editNote = { path, sha, parsed, raw: content };
    state.status = null;
  } catch (e) {
    state.status = { type: 'error', message: `Failed to load note: ${e}` };
    state.screen = 'recent';
  }
  render();
}
