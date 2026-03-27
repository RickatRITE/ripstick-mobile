/** RipStick Mobile — entry point. */

import { getToken, getRepoFullName, validateToken } from './auth';
import { listGroups } from './api';
import { destroyEditor } from './editor';
import { processImage } from './image-utils';
import { loadDraft } from './outbox';
import { parseShareTarget } from './share-target';
import { flushOutbox, refreshSyncHealth } from './sync';
import { log, flushLogsToGitHub } from './log';
import { GROUP_DEFAULT } from '../../shared/constants';
import { state, setRenderFn, render, navigate, CACHED_GROUPS_KEY, CACHED_USERNAME_KEY } from './state';
import { renderAuth } from './screens/auth';
import { renderCapture } from './screens/capture';
import { renderRecent } from './screens/recent';
import { renderEdit } from './screens/edit';
import { renderOutbox } from './screens/outbox';
import { renderChat } from './screens/chat';
import { renderActivity } from './screens/activity';
import { renderSearch } from './screens/search';
import { configureRelay, connectRelay, onRelay } from './relay';
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
    case 'chat':     renderChat(app); break;
    case 'activity': renderActivity(app); break;
    case 'search':   renderSearch(app); break;
  }
}

setRenderFn(renderScreen);

// ── Share Target ──────────────────────────────────────────────────────

/**
 * Consume Web Share Target params if present, overriding any draft.
 * Processes shared images through the WebP pipeline and stores as pendingAsset.
 */
async function consumeShareTarget(): Promise<boolean> {
  const shared = await parseShareTarget();
  if (!shared) return false;

  state.title = shared.title;
  state.body = shared.body;

  // Process shared image → WebP conversion + asset filename generation
  if (shared.imageFile) {
    try {
      const { filename, webpBytes } = await processImage(shared.imageFile);
      state.pendingAsset = { filename, data: webpBytes.buffer as ArrayBuffer };
      // Embed image reference in the body so the user sees it
      const imageMarkdown = `![Screenshot](../_assets/${filename})`;
      state.body = state.body
        ? imageMarkdown + '\n\n' + state.body
        : imageMarkdown;
    } catch {
      // Image processing failed — continue with text-only share
    }
  }

  // Clean the URL so a refresh doesn't re-trigger the share
  history.replaceState({ screen: 'capture' }, '', window.location.pathname);
  return true;
}

// ── Init ──────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  const token = getToken();
  const repo = getRepoFullName();

  // Check for incoming share data first — it takes priority over drafts
  let isShare = false;
  try {
    isShare = await consumeShareTarget();
  } catch {
    // Share target parsing failed — continue with normal boot
  }

  // Restore draft from IndexedDB (skip if we have share data)
  if (!isShare) {
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
        state.selectedGroup = groups[0] || GROUP_DEFAULT;
      }
      render();

      // Auth validated + online — flush any queued notes
      flushOutbox().catch(() => {});

      // Initialize relay connection if configured
      // TODO: Read relay_url from app settings. For now, check localStorage.
      const relayUrl = localStorage.getItem('ripstick-relay-url');
      const wsId = localStorage.getItem('ripstick-workspace-id');
      if (relayUrl && wsId) {
        configureRelay(relayUrl, wsId, username);
        connectRelay();
        onRelay({
          onChat: () => {
            // Re-render chat screen if active
            if (state.screen === 'chat') render();
          },
        });
      }
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

// ── Visibility Change — Refresh SHA on Resume ────────────────────────

document.addEventListener('visibilitychange', async () => {
  log('visibility', { state: document.visibilityState, screen: state.screen, hasEditNote: !!state.editNote });

  if (document.visibilityState === 'hidden') {
    // App being backgrounded — flush logs to GitHub while we still can.
    // This is fire-and-forget: if it fails, logs persist in localStorage.
    const token = getToken();
    if (token && state.repo && state.username) {
      flushLogsToGitHub(token, state.repo, state.username).catch(() => {});
    }
    return;
  }

  // visible — refresh edit note SHA and flush outbox

  // If the user is on the edit screen with a loaded note, silently refresh
  // the SHA so the next save doesn't 409. This covers the case where the
  // desktop auto-saved while the mobile app was backgrounded.
  if (state.screen === 'edit' && state.editNote) {
    const token = getToken();
    if (!token) return;

    try {
      const { getFileContent } = await import('./api');
      const { sha } = await getFileContent(token, state.repo, state.editNote.path);
      if (sha !== state.editNote.sha) {
        log('visibility:sha-refreshed', {
          path: state.editNote.path,
          oldSha: state.editNote.sha.slice(0, 8),
          newSha: sha.slice(0, 8),
        });
        state.editNote.sha = sha;
      }
    } catch {
      // Offline or network error — the 409 retry in updateFile will handle it
    }
  }

  // Also flush any queued outbox entries
  flushOutbox().catch(() => {});
});

// ── Boot ──────────────────────────────────────────────────────────────

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js').catch(() => {});
}

init();
