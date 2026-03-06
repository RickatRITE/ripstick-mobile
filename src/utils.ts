/** Shared utility functions for RipStick mobile. */

import { state, render } from './state';

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function datePlaceholder(): string {
  const now = new Date();
  return now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' note...';
}

export function statusHtml(): string {
  if (!state.status) return '';
  let html = escapeHtml(state.status.message);

  // Add "View on GitHub" link for successful saves
  if (state.status.type === 'success' && state.lastSavedPath && state.repo) {
    html += ` <a href="https://github.com/${state.repo}/blob/main/${state.lastSavedPath}" target="_blank" rel="noopener" style="color: var(--accent); text-decoration: underline;">View on GitHub</a>`;
  }
  return html;
}

export function clearStatusAfterDelay(ms = 2000): void {
  setTimeout(() => {
    if (state.status?.type === 'success') {
      state.status = null;
      render();
    }
  }, ms);
}
