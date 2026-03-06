import { getToken, setToken, clearToken, getRepoFullName, setRepoFullName, validateToken, discoverRepo } from './auth';
import { listGroups, listFiles, createNote, getAllFiles, getFileContent, updateFile, type FileEntry } from './api';
import { buildFrontmatter, generateFilename, buildCommitMessage, type MarkerType } from './note-format';
import { parseNote, rebuildNote, setMarkerInRaw, toggleDoneInRaw, type ParsedNote } from './frontmatter';
import { createEditor, getMarkdown, destroyEditor } from './editor';
import './style.css';

// ── State ──────────────────────────────────────────────────────────────

const LAST_GROUP_KEY = 'ripstick-last-group';
const CACHED_GROUPS_KEY = 'ripstick-cached-groups';
const CACHED_USERNAME_KEY = 'ripstick-cached-username';

type Screen = 'auth' | 'capture' | 'recent' | 'edit';

interface NoteListItem {
  path: string;
  group: string;
  filename: string;
  sha: string;
  /** Extracted from filename: YYYY-MM-DD */
  date: string;
}

interface AppState {
  screen: Screen;
  username: string;
  repo: string;
  groups: string[];
  selectedGroup: string;
  // Capture
  title: string;
  body: string;
  marker: MarkerType | '';
  markerExpanded: boolean;
  saving: boolean;
  status: { type: 'success' | 'error' | 'info'; message: string } | null;
  lastSavedPath: string | null;
  // Recent / Edit
  recentNotes: NoteListItem[];
  recentLoading: boolean;
  editNote: { path: string; sha: string; parsed: ParsedNote; raw: string } | null;
  editSaving: boolean;
}

const state: AppState = {
  screen: 'auth',
  username: localStorage.getItem(CACHED_USERNAME_KEY) || '',
  repo: getRepoFullName() || '',
  groups: JSON.parse(localStorage.getItem(CACHED_GROUPS_KEY) || '[]'),
  selectedGroup: localStorage.getItem(LAST_GROUP_KEY) || 'general',
  title: '',
  body: '',
  marker: '',
  markerExpanded: false,
  saving: false,
  status: null,
  lastSavedPath: null,
  recentNotes: [],
  recentLoading: false,
  editNote: null,
  editSaving: false,
};

const MARKERS: Array<{ type: MarkerType; icon: string; label: string }> = [
  { type: 'todo', icon: '✅', label: 'Todo' },
  { type: 'idea', icon: '💡', label: 'Idea' },
  { type: 'question', icon: '❓', label: 'Question' },
  { type: 'important', icon: '⚠️', label: 'Important' },
  { type: 'reference', icon: '📎', label: 'Reference' },
  { type: 'followup', icon: '🔄', label: 'Follow-up' },
];

const MARKER_MAP = Object.fromEntries(MARKERS.map((m) => [m.type, m]));

// ── Init ───────────────────────────────────────────────────────────────

const app = document.getElementById('app')!;

async function init() {
  const token = getToken();
  const repo = getRepoFullName();

  // Show cached UI immediately if we have cached state
  if (token && repo && state.groups.length > 0) {
    state.screen = 'capture';
    state.repo = repo;
    if (!state.groups.includes(state.selectedGroup)) {
      state.selectedGroup = state.groups[0];
    }
    render();

    // Validate in background — if token expired, bounce to auth
    try {
      const username = await validateToken(token);
      state.username = username;
      localStorage.setItem(CACHED_USERNAME_KEY, username);
      // Refresh groups silently
      const groups = await listGroups(token, repo);
      state.groups = groups;
      localStorage.setItem(CACHED_GROUPS_KEY, JSON.stringify(groups));
      if (!groups.includes(state.selectedGroup)) {
        state.selectedGroup = groups[0] || 'general';
      }
      render();
    } catch {
      state.screen = 'auth';
      render();
    }
    return;
  }

  // No cached state — try fresh auth
  if (token && repo) {
    try {
      state.username = await validateToken(token);
      state.repo = repo;
      state.groups = await listGroups(token, repo);
      localStorage.setItem(CACHED_USERNAME_KEY, state.username);
      localStorage.setItem(CACHED_GROUPS_KEY, JSON.stringify(state.groups));
      if (state.groups.length > 0 && !state.groups.includes(state.selectedGroup)) {
        state.selectedGroup = state.groups[0];
      }
      state.screen = 'capture';
    } catch {
      state.screen = 'auth';
    }
  }
  render();
}

// ── Render ──────────────────────────────────────────────────────────────

function render() {
  // Destroy editor when leaving edit screen
  if (state.screen !== 'edit') {
    destroyEditor();
  }

  switch (state.screen) {
    case 'auth':
      renderAuth();
      break;
    case 'capture':
      renderCapture();
      break;
    case 'recent':
      renderRecent();
      break;
    case 'edit':
      renderEdit();
      break;
  }
}

function renderAuth() {
  app.innerHTML = `
    <div class="auth-screen">
      <h2>RipStick Capture</h2>
      <p>Enter your GitHub Personal Access Token to connect to your RipStick notes repo.</p>
      <div class="input-group">
        <label>GitHub PAT</label>
        <input type="password" id="pat-input" placeholder="ghp_..." autocomplete="off" />
      </div>
      <div class="input-group">
        <label>Repository (leave blank to auto-discover)</label>
        <input type="text" id="repo-input" placeholder="owner/ripstick-notes" value="${getRepoFullName() || ''}" />
      </div>
      <button class="btn btn-primary" id="connect-btn">Connect</button>
      ${state.status ? `<div class="status-message status-${state.status.type}">${state.status.message}</div>` : ''}
      <p>Create a <a href="https://github.com/settings/tokens?type=beta" target="_blank" rel="noopener" style="color: var(--accent)">fine-grained PAT</a> with Contents read/write access to your ripstick-notes repo.</p>
    </div>
  `;
  document.getElementById('connect-btn')!.addEventListener('click', handleConnect);
}

function renderCapture() {
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

function renderRecent() {
  app.innerHTML = `
    <div class="capture-screen">
      <div class="header">
        <div class="tab-bar">
          <span class="tab" id="tab-new">New</span>
          <span class="tab active">Recent</span>
        </div>
        <span class="settings-link" id="signout-btn">Sign out</span>
      </div>

      ${state.recentLoading ? `
        <div class="loading-indicator">Loading notes...</div>
      ` : `
        <div class="note-list">
          ${state.recentNotes.length === 0 ? '<div class="empty-state">No notes found</div>' : ''}
          ${state.recentNotes.map((n) => `
            <button class="note-list-item" data-path="${n.path}">
              <span class="note-item-group">${n.group}</span>
              <span class="note-item-name">${n.filename.replace('.md', '')}</span>
            </button>
          `).join('')}
        </div>
      `}
    </div>
  `;

  document.getElementById('tab-new')?.addEventListener('click', () => {
    state.screen = 'capture';
    state.status = null;
    render();
  });
  document.getElementById('signout-btn')?.addEventListener('click', handleDisconnect);

  document.querySelectorAll('.note-list-item').forEach((el) => {
    el.addEventListener('click', () => {
      const path = (el as HTMLElement).dataset.path!;
      openNote(path);
    });
  });
}

function renderEdit() {
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
  // Strip the marker comment from the body for editing — it'll be re-prepended on save
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
    state.screen = 'recent';
    render();
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

// ── Event Binding ──────────────────────────────────────────────────────

function bindCaptureEvents() {
  document.getElementById('tab-recent')?.addEventListener('click', () => {
    state.status = null;
    state.screen = 'recent';
    loadRecentNotes();
    render();
  });
  document.getElementById('signout-btn')?.addEventListener('click', handleDisconnect);

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

// ── Handlers ───────────────────────────────────────────────────────────

async function handleConnect() {
  const pat = (document.getElementById('pat-input') as HTMLInputElement).value.trim();
  const repoInput = (document.getElementById('repo-input') as HTMLInputElement).value.trim();

  if (!pat) {
    state.status = { type: 'error', message: 'Please enter a token.' };
    render();
    return;
  }

  state.status = { type: 'info', message: 'Validating...' };
  render();

  try {
    const username = await validateToken(pat);
    setToken(pat);
    state.username = username;
    localStorage.setItem(CACHED_USERNAME_KEY, username);

    let repo = repoInput;
    if (!repo) {
      const discovered = await discoverRepo(pat);
      if (!discovered) {
        state.status = { type: 'error', message: `No ripstick-notes repo found for ${username}. Create it first from the desktop app.` };
        render();
        return;
      }
      repo = discovered;
    }

    setRepoFullName(repo);
    state.repo = repo;
    state.groups = await listGroups(pat, repo);
    localStorage.setItem(CACHED_GROUPS_KEY, JSON.stringify(state.groups));
    if (state.groups.length > 0 && !state.groups.includes(state.selectedGroup)) {
      state.selectedGroup = state.groups[0];
    }
    state.screen = 'capture';
    state.status = null;
  } catch (e) {
    state.status = { type: 'error', message: `Connection failed: ${e}` };
  }
  render();
}

function handleDisconnect() {
  clearToken();
  localStorage.removeItem(CACHED_GROUPS_KEY);
  localStorage.removeItem(CACHED_USERNAME_KEY);
  state.screen = 'auth';
  state.username = '';
  state.repo = '';
  state.groups = [];
  state.status = null;
  render();
}

async function handleSave(token: string) {
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

async function loadRecentNotes() {
  const token = getToken();
  if (!token) return;

  state.recentLoading = true;
  render();

  try {
    const allFiles = await getAllFiles(token, state.repo);

    // Parse into NoteListItems, extract date from filename
    const notes: NoteListItem[] = allFiles
      .filter((f) => {
        const parts = f.path.split('/');
        // Skip files in root, settings files, etc.
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

    // Sort by date descending, then by filename descending
    notes.sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return b.filename.localeCompare(a.filename);
    });

    // Show the most recent 30
    state.recentNotes = notes.slice(0, 30);
  } catch (e) {
    state.status = { type: 'error', message: `Failed to load notes: ${e}` };
  }

  state.recentLoading = false;
  render();
}

async function openNote(path: string) {
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

async function handleSaveEdit() {
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
    const parts = state.editNote.path.split('/');
    const filename = parts[parts.length - 1];
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

async function handleTriageMarker(newMarker: MarkerType | '') {
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

async function handleTriageDone() {
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

function clearStatusAfterDelay() {
  setTimeout(() => {
    if (state.status?.type === 'success') {
      state.status = null;
      render();
    }
  }, 2000);
}

// ── Utilities ──────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function datePlaceholder(): string {
  const now = new Date();
  return now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' note...';
}

function statusHtml(): string {
  if (!state.status) return '';
  let html = escapeHtml(state.status.message);

  // Add "View on GitHub" link for successful saves
  if (state.status.type === 'success' && state.lastSavedPath && state.repo) {
    html += ` <a href="https://github.com/${state.repo}/blob/main/${state.lastSavedPath}" target="_blank" rel="noopener" style="color: var(--accent); text-decoration: underline;">View on GitHub</a>`;
  }
  return html;
}

// ── Boot ───────────────────────────────────────────────────────────────

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js').catch(() => {});
}

init();
