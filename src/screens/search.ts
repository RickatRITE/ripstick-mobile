/** Search screen — full-text search via relay AI request.
 *
 * Spec §4 (Phase 4): "Mobile AI features via server routing (search queries,
 * soul invocations via relay)."
 *
 * Sends search queries to the server via ai_request. The server queries its
 * FTS5 index and returns results. On mobile, this is the only search path
 * (no local SQLite index).
 */

import { state, render } from '../state';
import { sendAiRequest, onAiResponse, isRelayConnected } from '../relay';

let searchResults: string = '';
let searching = false;
let currentRequestId: string = '';

/** Render the search screen. */
export function renderSearch(app: HTMLElement): void {
  const connected = isRelayConnected();

  app.innerHTML = `
    <div class="search-screen">
      <header class="search-header">
        <button class="back-btn" id="search-back">&larr;</button>
        <input
          class="search-input"
          id="search-input"
          type="text"
          placeholder="${connected ? 'Search workspace...' : 'Connect to search'}"
          ${!connected ? 'disabled' : ''}
          autofocus
        />
      </header>

      <div class="search-results" id="search-results">
        ${searching
          ? '<div class="search-loading">Searching...</div>'
          : searchResults
            ? `<div class="search-result-content">${formatResults(searchResults)}</div>`
            : '<div class="search-empty">Type to search notes, tasks, and chat messages</div>'
        }
      </div>
    </div>
  `;

  document.getElementById('search-back')?.addEventListener('click', () => {
    searchResults = '';
    searching = false;
    state.screen = 'recent';
    render();
  });

  const input = document.getElementById('search-input') as HTMLInputElement;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  input?.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const query = input.value.trim();
      if (query.length >= 2 && connected) {
        performSearch(query, app);
      }
    }, 400);
  });

  // Enter key triggers immediate search
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      clearTimeout(debounceTimer);
      const query = input.value.trim();
      if (query && connected) {
        performSearch(query, app);
      }
    }
  });
}

function performSearch(query: string, app: HTMLElement): void {
  searching = true;
  searchResults = '';
  render();

  // Send search as an AI request — the server's harness can query the FTS5 index
  const prompt = `Search the workspace for: "${query}". Return matching note titles, groups, and relevant snippets. Format as a list.`;
  currentRequestId = sendAiRequest(prompt, undefined, undefined);

  if (!currentRequestId) {
    searching = false;
    searchResults = 'Search unavailable — relay not connected';
    render();
    return;
  }

  let accumulated = '';
  onAiResponse(currentRequestId, (delta, done) => {
    accumulated += delta;
    if (done) {
      searching = false;
      searchResults = accumulated;
      render();
    }
  });
}

function formatResults(text: string): string {
  // Simple markdown-to-HTML for search results
  return escapeHtml(text)
    .replace(/\n/g, '<br>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
