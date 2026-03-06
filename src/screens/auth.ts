/** Auth screen — GitHub PAT login + repo discovery. */

import { getRepoFullName, setRepoFullName, setToken, validateToken, discoverRepo } from '../auth';
import { listGroups } from '../api';
import { state, render, CACHED_GROUPS_KEY, CACHED_USERNAME_KEY } from '../state';

export function renderAuth(app: HTMLElement): void {
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

async function handleConnect(): Promise<void> {
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
