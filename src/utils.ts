/** Shared utility functions for RipStick mobile. */

import { state, render } from './state';

/** Sentinel for notes with no parseable date in their filename. */
export const NO_DATE = '0000-00-00';

/** Format a date string for display: "Mar 8" or "Mar 8, 2025" if not this year. */
export function formatDate(dateStr: string): string {
  if (!dateStr || dateStr === NO_DATE) return '';
  try {
    // Handle both date-only ("2026-03-08") and full datetime ("2026-03-08T10:50:55...")
    const d = dateStr.includes('T') || dateStr.includes(' ')
      ? new Date(dateStr)
      : new Date(dateStr + 'T00:00:00');
    if (isNaN(d.getTime())) return '';
    const now = new Date();
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[d.getMonth()];
    const day = d.getDate();
    if (d.getFullYear() === now.getFullYear()) return `${month} ${day}`;
    return `${month} ${day}, ${d.getFullYear()}`;
  } catch {
    return dateStr;
  }
}

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
    html += ` <a href="https://github.com/${encodeURI(state.repo)}/blob/main/${encodeURI(state.lastSavedPath)}" target="_blank" rel="noopener" style="color: var(--accent); text-decoration: underline;">View on GitHub</a>`;
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
