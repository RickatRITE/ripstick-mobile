/** Shared app state, types, and navigation for RipStick mobile. */

import { clearToken } from './auth';
import { getRepoFullName } from './auth';
import { type MarkerType } from './note-format';
import { type ParsedNote } from './frontmatter';
import { type OutboxAsset } from './outbox';
import { GROUP_DEFAULT } from '../../shared/constants';

// ── localStorage Keys ─────────────────────────────────────────────────

export const LAST_GROUP_KEY = 'ripstick-last-group';
export const CACHED_GROUPS_KEY = 'ripstick-cached-groups';
export const CACHED_USERNAME_KEY = 'ripstick-cached-username';

// ── Types ─────────────────────────────────────────────────────────────

export type Screen = 'auth' | 'capture' | 'recent' | 'edit' | 'outbox' | 'chat' | 'activity' | 'search';

export type SyncHealth = 'green' | 'amber' | 'syncing' | 'red';

export interface NoteListItem {
  path: string;
  group: string;
  filename: string;
  sha: string;
  /** Extracted from filename: YYYY-MM-DD */
  date: string;
  /** Frontmatter title, fetched asynchronously */
  title?: string;
  /** Frontmatter updated timestamp, fetched asynchronously */
  updated?: string;
  /** Body preview snippet, fetched asynchronously */
  snippet?: string;
}

export interface AppState {
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
  optionsPanelOpen: boolean;
  saving: boolean;
  status: { type: 'success' | 'error' | 'info'; message: string } | null;
  lastSavedPath: string | null;
  // Recent / Edit
  recentNotes: NoteListItem[];
  recentLoading: boolean;
  editNote: { path: string; sha: string; parsed: ParsedNote; raw: string } | null;
  editSaving: boolean;
  editOptionsPanelOpen: boolean;
  /** Tracks the edited title (null = not yet touched, uses parsed.title) */
  editTitle: string | null;
  // Image attachment (shared screenshot or file picker)
  pendingAsset: OutboxAsset | null;
  // Sync
  syncHealth: SyncHealth;
  toast: string | null;
}

// ── State Singleton ───────────────────────────────────────────────────

export const state: AppState = {
  screen: 'auth',
  username: localStorage.getItem(CACHED_USERNAME_KEY) || '',
  repo: getRepoFullName() || '',
  groups: JSON.parse(localStorage.getItem(CACHED_GROUPS_KEY) || '[]'),
  selectedGroup: localStorage.getItem(LAST_GROUP_KEY) || GROUP_DEFAULT,
  title: '',
  body: '',
  marker: '',
  markerExpanded: false,
  optionsPanelOpen: false,
  saving: false,
  status: null,
  lastSavedPath: null,
  pendingAsset: null,
  recentNotes: [],
  recentLoading: false,
  editNote: null,
  editSaving: false,
  editOptionsPanelOpen: false,
  editTitle: null,
  syncHealth: 'green',
  toast: null,
};

// ── Render Callback ───────────────────────────────────────────────────

let _renderFn: () => void = () => {};

export function setRenderFn(fn: () => void): void {
  _renderFn = fn;
}

export function render(): void {
  _renderFn();
}

export function navigate(screen: Screen, pushHistory = true): void {
  state.screen = screen;
  if (pushHistory) {
    history.pushState({ screen }, '', '');
  }
  render();
}

// ── Shared Actions ────────────────────────────────────────────────────

export async function disconnect(): Promise<void> {
  // Lazy import to avoid circular dependency
  const { pendingCount } = await import('./outbox');
  const count = await pendingCount();
  if (count > 0) {
    const confirmed = confirm(`You have ${count} unsynced note${count > 1 ? 's' : ''}. Sign out anyway?`);
    if (!confirmed) return;
  }
  clearToken();
  localStorage.removeItem(CACHED_GROUPS_KEY);
  localStorage.removeItem(CACHED_USERNAME_KEY);
  state.screen = 'auth';
  state.username = '';
  state.repo = '';
  state.groups = [];
  state.status = null;
  state.syncHealth = 'green';
  render();
}
