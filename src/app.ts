/** RipStick Mobile — entry point. */

import { getToken, getRepoFullName, validateToken } from './auth';
import { listGroups } from './api';
import { destroyEditor } from './editor';
import { loadDraft } from './outbox';
import { flushOutbox, refreshSyncHealth } from './sync';
import { state, setRenderFn, render, navigate, CACHED_GROUPS_KEY, CACHED_USERNAME_KEY } from './state';
import { renderAuth } from './screens/auth';
import { renderCapture } from './screens/capture';
import { renderRecent } from './screens/recent';
import { renderEdit } from './screens/edit';
import { renderOutbox } from './screens/outbox';
import './style.css';

// ── Render Dispatcher ─────────────────────────────────────────────────

const app = document.getElementById('app')!;

function renderScreen(): void {
  if (state.screen !== 'edit') destroyEditor();

  switch (state.screen) {
    case 'auth':    renderAuth(app); break;
    case 'capture': renderCapture(app); break;
    case 'recent':  renderRecent(app); break;
    case 'edit':    renderEdit(app); break;
    case 'outbox':  renderOutbox(app); break;
  }
}

setRenderFn(renderScreen);

// ── Init ──────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  const token = getToken();
  const repo = getRepoFullName();

  // Restore draft from IndexedDB
  try {
    const draft = await loadDraft();
    if (draft) {
      state.title = draft.title;
      state.body = draft.body;
      state.marker = draft.marker;
      if (draft.group) state.selectedGroup = draft.group;
    }
  } catch {
    // Draft restore is best-effort
  }

  // Show cached UI immediately if we have cached state
  if (token && repo && state.groups.length > 0) {
    state.screen = 'capture';
    state.repo = repo;
    if (!state.groups.includes(state.selectedGroup)) {
      state.selectedGroup = state.groups[0];
    }
    history.replaceState({ screen: 'capture' }, '', '');
    render();

    // Refresh sync health from outbox
    refreshSyncHealth().catch(() => {});

    // Validate in background — distinguish auth errors from network errors
    try {
      const username = await validateToken(token);
      state.username = username;
      localStorage.setItem(CACHED_USERNAME_KEY, username);
      const groups = await listGroups(token, repo);
      state.groups = groups;
      localStorage.setItem(CACHED_GROUPS_KEY, JSON.stringify(groups));
      if (!groups.includes(state.selectedGroup)) {
        state.selectedGroup = groups[0] || 'general';
      }
      render();

      // Auth validated + online — flush any queued notes
      flushOutbox().catch(() => {});
    } catch (e: any) {
      // Only bounce to auth on explicit auth rejection (401/403)
      // Network errors → keep the capture screen with cached credentials
      if (isAuthError(e)) {
        state.screen = 'auth';
        render();
      }
      // Otherwise swallow — user keeps capture screen, online listener will retry
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

      // Flush any queued notes from a previous session
      flushOutbox().catch(() => {});
    } catch {
      state.screen = 'auth';
    }
  }
  history.replaceState({ screen: state.screen }, '', '');
  render();

  // Initialize sync health
  refreshSyncHealth().catch(() => {});
}

/** Returns true for HTTP 401/403 auth failures, false for network/other errors. */
function isAuthError(e: any): boolean {
  const msg = String(e);
  return msg.includes('401') || msg.includes('403');
}

// ── Online Event — Sync + Revalidation ───────────────────────────────

window.addEventListener('online', () => {
  // Flush queued notes when connectivity returns
  flushOutbox().catch(() => {});

  // Re-validate auth in background if we have cached credentials
  const token = getToken();
  const repo = getRepoFullName();
  if (token && repo && state.screen !== 'auth') {
    validateToken(token)
      .then((username) => {
        state.username = username;
        localStorage.setItem(CACHED_USERNAME_KEY, username);
        return listGroups(token, repo);
      })
      .then((groups) => {
        state.groups = groups;
        localStorage.setItem(CACHED_GROUPS_KEY, JSON.stringify(groups));
        render();
      })
      .catch(() => {
        // Silently ignore — if auth is truly expired, sync will surface it
      });
  }
});

// ── History Back Navigation ───────────────────────────────────────────

window.addEventListener('popstate', (e) => {
  const target = e.state?.screen;
  if (target) {
    if (state.screen === 'edit') destroyEditor();
    state.editNote = null;
    state.status = null;
    navigate(target, false);
  } else {
    // No previous state — go to the default screen without exiting
    if (state.screen === 'edit') {
      destroyEditor();
      state.editNote = null;
      state.status = null;
      navigate('recent', false);
      history.replaceState({ screen: 'recent' }, '', '');
    } else if (state.screen === 'outbox') {
      navigate('capture', false);
      history.replaceState({ screen: 'capture' }, '', '');
    }
  }
});

// ── Boot ──────────────────────────────────────────────────────────────

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js').catch(() => {});
}

init();
