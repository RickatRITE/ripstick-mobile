/** Shared utility functions for RipStick mobile. */

import { state, render } from './state';

/** Sentinel for notes with no parseable date in their filename. */
export const NO_DATE = '0000-00-00';

/** Format a date string for display: "Mar 8, 10:50 AM" or "Mar 8, 2025, 10:50 AM".
 *  Date-only inputs omit the time portion. */
export function formatDate(dateStr: string): string {
  if (!dateStr || dateStr === NO_DATE) return '';
  try {
    const hasTime = dateStr.includes('T') || dateStr.includes(' ');
    const d = hasTime ? new Date(dateStr) : new Date(dateStr + 'T00:00:00');
    if (isNaN(d.getTime())) return '';
    const now = new Date();
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[d.getMonth()];
    const day = d.getDate();

    let time = '';
    if (hasTime) {
      const h = d.getHours();
      const m = d.getMinutes().toString().padStart(2, '0');
      const ampm = h >= 12 ? 'PM' : 'AM';
      const h12 = h % 12 || 12;
      time = `, ${h12}:${m} ${ampm}`;
    }

    if (d.getFullYear() === now.getFullYear()) return `${month} ${day}${time}`;
    return `${month} ${day}, ${d.getFullYear()}${time}`;
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

/** Sync-health indicator dot (used in capture + recent tab bars). */
export function syncDotHtml(): string {
  const { syncHealth } = state;
  const cls = syncHealth === 'syncing' ? 'sync-dot sync-dot--syncing' : `sync-dot sync-dot--${syncHealth}`;
  return `<span class="${cls}" id="sync-dot" title="Sync status"></span>`;
}

export function clearStatusAfterDelay(ms = 2000): void {
  setTimeout(() => {
    if (state.status?.type === 'success') {
      state.status = null;
      render();
    }
  }, ms);
}
