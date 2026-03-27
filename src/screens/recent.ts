/** Recent notes screen — Gmail-style note list. */

import { getToken } from '../auth';
import { getAllFiles, getFileContent } from '../api';
import { parseNote } from '../frontmatter';
import { state, render, navigate, disconnect, type NoteListItem } from '../state';
import { escapeHtml, formatDate, NO_DATE, syncDotHtml } from '../utils';

/** Render a single note list item in Gmail style. */
function noteItemHtml(n: NoteListItem): string {
  const title = n.title || n.filename.replace('.md', '');
  const date = formatDate(n.updated || n.date);
  const snippet = n.snippet ? escapeHtml(n.snippet) : '';

  return `
    <button class="gmail-item" data-path="${n.path}">
      <div class="gmail-item-top">
        <span class="gmail-item-group">${escapeHtml(n.group)}</span>
        <span class="gmail-item-date">${date}</span>
      </div>
      <div class="gmail-item-title">${escapeHtml(title)}</div>
      ${snippet ? `<div class="gmail-item-snippet">${snippet}</div>` : ''}
    </button>
  `;
}

export function renderRecent(app: HTMLElement): void {
  app.innerHTML = `
    <div class="capture-screen">
      <div class="header">
        <div class="tab-bar">
          <span class="tab" id="tab-new">New</span>
          <span class="tab active">Recent ${syncDotHtml()}</span>
          <span class="tab" id="tab-chat">Chat</span>
          <span class="tab" id="tab-activity">Activity</span>
          <span class="tab" id="tab-search">&#x1F50D;</span>
        </div>
        <div class="header-actions">
          <button class="header-icon-btn ${state.optionsPanelOpen ? 'active' : ''}" id="options-toggle-btn" title="Options">
            <span class="icon-label">${state.optionsPanelOpen ? '&#9650;' : '&#9881;'}</span>
          </button>
        </div>
      </div>

      ${state.optionsPanelOpen ? `
        <div class="options-panel" id="options-panel">
          <div class="options-section" style="align-items:flex-start">
            <span class="settings-link" id="signout-btn">Sign out</span>
          </div>
          <div style="font-size:var(--font-xs);color:var(--fg-muted);text-align:center">v0.0033</div>
        </div>
      ` : ''}

      ${state.recentLoading ? `
        <div class="loading-indicator">Loading notes...</div>
      ` : `
        <div class="gmail-list">
          ${state.recentNotes.length === 0 ? '<div class="empty-state">No notes found</div>' : ''}
          ${state.recentNotes.map(noteItemHtml).join('')}
        </div>
      `}
    </div>
  `;

  document.getElementById('tab-new')?.addEventListener('click', () => {
    state.status = null;
    state.optionsPanelOpen = false;
    navigate('capture');
  });

  document.getElementById('tab-chat')?.addEventListener('click', () => {
    state.optionsPanelOpen = false;
    navigate('chat');
  });

  document.getElementById('tab-activity')?.addEventListener('click', () => {
    state.optionsPanelOpen = false;
    navigate('activity');
  });

  document.getElementById('tab-search')?.addEventListener('click', () => {
    state.optionsPanelOpen = false;
    navigate('search');
  });

  // Gear toggle
  document.getElementById('options-toggle-btn')?.addEventListener('click', () => {
    state.optionsPanelOpen = !state.optionsPanelOpen;
    render();
  });

  // Sign out (inside options panel)
  document.getElementById('signout-btn')?.addEventListener('click', () => disconnect());

  // Sync dot → open outbox view
  document.getElementById('sync-dot')?.addEventListener('click', (e) => {
    e.stopPropagation();
    navigate('outbox');
  });

  document.querySelectorAll('.gmail-item').forEach((el) => {
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
          date: dateMatch ? dateMatch[1] : NO_DATE,
        };
      });

    notes.sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return b.filename.localeCompare(a.filename);
    });

    state.recentNotes = notes.slice(0, 30);
  } catch {
    // Network error or offline — show contextual message, not raw error
    state.status = { type: 'info', message: "Can't load notes right now." };
  }

  state.recentLoading = false;
  render();

  // Fetch titles + snippets in background
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
        // Extract a short snippet from the body
        if (parsed.body) {
          const plain = parsed.body
            .replace(/<!--[\s\S]*?-->/g, '')  // strip HTML comments (markers)
            .replace(/[#*_~`>\-\[\]]/g, '')   // strip markdown formatting
            .replace(/\s+/g, ' ')             // collapse whitespace
            .trim();
          note.snippet = plain.slice(0, 100);
        }
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
    state.editTitle = null;
    state.editOptionsPanelOpen = false;
    state.status = null;
  } catch (e) {
    state.status = { type: 'error', message: 'Failed to load note.' };
    state.screen = 'recent';
  }
  render();
}
