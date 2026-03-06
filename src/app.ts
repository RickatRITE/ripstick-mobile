import { getToken, setToken, clearToken, getRepoFullName, setRepoFullName, validateToken, discoverRepo } from './auth';
import { listGroups, listFiles, createNote } from './api';
import { buildFrontmatter, generateFilename, buildCommitMessage, type MarkerType } from './note-format';
import './style.css';

// ── State ──────────────────────────────────────────────────────────────

const LAST_GROUP_KEY = 'ripstick-last-group';

interface AppState {
  screen: 'auth' | 'capture';
  username: string;
  repo: string;
  groups: string[];
  selectedGroup: string;
  title: string;
  body: string;
  marker: MarkerType | '';
  markerExpanded: boolean;
  saving: boolean;
  status: { type: 'success' | 'error' | 'info'; message: string } | null;
}

const state: AppState = {
  screen: 'auth',
  username: '',
  repo: '',
  groups: [],
  selectedGroup: localStorage.getItem(LAST_GROUP_KEY) || 'general',
  title: '',
  body: '',
  marker: '',
  markerExpanded: false,
  saving: false,
  status: null,
};

const MARKERS: Array<{ type: MarkerType; icon: string; label: string }> = [
  { type: 'todo', icon: '✅', label: 'Todo' },
  { type: 'idea', icon: '💡', label: 'Idea' },
  { type: 'question', icon: '❓', label: 'Question' },
  { type: 'important', icon: '⚠️', label: 'Important' },
  { type: 'reference', icon: '📎', label: 'Reference' },
  { type: 'followup', icon: '🔄', label: 'Follow-up' },
];

function defaultTitle(): string {
  const now = new Date();
  return now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' — Quick note';
}

// ── Init ───────────────────────────────────────────────────────────────

const app = document.getElementById('app')!;

async function init() {
  const token = getToken();
  const repo = getRepoFullName();
  if (token && repo) {
    try {
      state.username = await validateToken(token);
      state.repo = repo;
      state.groups = await listGroups(token, repo);
      if (state.groups.length > 0 && !state.groups.includes(state.selectedGroup)) {
        state.selectedGroup = state.groups[0];
      }
      state.title = defaultTitle();
      state.screen = 'capture';
    } catch {
      state.screen = 'auth';
    }
  }
  render();
}

// ── Render ──────────────────────────────────────────────────────────────

function render() {
  if (state.screen === 'auth') {
    renderAuth();
  } else {
    renderCapture();
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
  const token = getToken()!;

  const markerLabel = state.marker
    ? MARKERS.find((m) => m.type === state.marker)!
    : null;

  app.innerHTML = `
    <div class="capture-screen">
      <div class="header">
        <h1>New Note</h1>
        <div class="header-actions">
          <span class="settings-link" id="signout-btn">Sign out</span>
        </div>
      </div>

      <div class="group-picker">
        ${state.groups.map((g) => `
          <button class="group-chip ${g === state.selectedGroup ? 'active' : ''}" data-group="${g}">${g}</button>
        `).join('')}
      </div>

      <input type="text" class="title-input" id="title-input" value="${escapeHtml(state.title)}" placeholder="Note title..." />

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
        ${state.status ? `<div class="status-message status-${state.status.type}" style="margin-bottom: 8px">${state.status.message}</div>` : ''}
        <button class="btn btn-primary" id="save-btn" ${state.saving ? 'disabled' : ''} style="width: 100%">
          ${state.saving ? 'Saving...' : 'Save Note'}
        </button>
      </div>
    </div>
  `;

  // Event listeners
  document.getElementById('signout-btn')!.addEventListener('click', handleDisconnect);

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
        // Tapping the active marker label clears it
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

  document.getElementById('save-btn')!.addEventListener('click', () => handleSave(token));
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
    if (state.groups.length > 0 && !state.groups.includes(state.selectedGroup)) {
      state.selectedGroup = state.groups[0];
    }
    state.title = defaultTitle();
    state.screen = 'capture';
    state.status = null;
  } catch (e) {
    state.status = { type: 'error', message: `Connection failed: ${e}` };
  }
  render();
}

function handleDisconnect() {
  clearToken();
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
    // Determine filename
    const existingFiles = await listFiles(token, state.repo, state.selectedGroup);
    const filename = generateFilename(existingFiles);

    // Build note content
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

    state.status = { type: 'success', message: `Saved to ${state.selectedGroup}` };
    state.title = defaultTitle();
    state.body = '';
    state.marker = '';
    state.markerExpanded = false;
  } catch (e) {
    state.status = { type: 'error', message: `Save failed: ${e}` };
  }

  state.saving = false;
  render();

  // Clear success status after 3 seconds
  if (state.status?.type === 'success') {
    setTimeout(() => {
      if (state.status?.type === 'success') {
        state.status = null;
        render();
      }
    }, 3000);
  }
}

// ── Utilities ──────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Boot ───────────────────────────────────────────────────────────────

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js').catch(() => {});
}

init();
