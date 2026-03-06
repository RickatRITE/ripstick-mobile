/** RipStick Mobile — entry point. */

import { getToken, getRepoFullName, validateToken } from './auth';
import { listGroups } from './api';
import { destroyEditor } from './editor';
import { state, setRenderFn, render, CACHED_GROUPS_KEY, CACHED_USERNAME_KEY } from './state';
import { renderAuth } from './screens/auth';
import { renderCapture } from './screens/capture';
import { renderRecent } from './screens/recent';
import { renderEdit } from './screens/edit';
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
  }
}

setRenderFn(renderScreen);

// ── Init ──────────────────────────────────────────────────────────────

async function init(): Promise<void> {
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

// ── Boot ──────────────────────────────────────────────────────────────

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js').catch(() => {});
}

init();
