/** IndexedDB outbox store + draft persistence for offline capture. */

import { type MarkerType } from './note-format';

// ── Outbox Schema ────────────────────────────────────────────────────

/** Optional image asset to upload alongside the note. */
export interface OutboxAsset {
  /** Asset filename (e.g. `2026-03-08-15-30-00-abc12345.webp`) */
  filename: string;
  /** Raw WebP bytes — stored as ArrayBuffer in IndexedDB (no base64 overhead). */
  data: ArrayBuffer;
}

export interface OutboxEntry {
  id: number;
  group: string;
  filename: string;
  content: string;
  commitMessage: string;
  createdAt: number;
  status: 'pending' | 'syncing' | 'failed';
  attempts: number;
  lastError?: string;
  token: string;
  repo: string;
  /** Image asset to upload before the note. Cleared after successful upload. */
  asset?: OutboxAsset;
}

// ── Draft Schema ─────────────────────────────────────────────────────

export interface Draft {
  title: string;
  body: string;
  marker: MarkerType | '';
  group: string;
}

// ── Database ─────────────────────────────────────────────────────────

const DB_NAME = 'ripstick-capture';
const DB_VERSION = 1;
const OUTBOX_STORE = 'outbox';
const DRAFT_STORE = 'draft';

let _db: IDBDatabase | null = null;

function openDB(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
        db.createObjectStore(OUTBOX_STORE, { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(DRAFT_STORE)) {
        db.createObjectStore(DRAFT_STORE);
      }
    };

    req.onsuccess = () => {
      _db = req.result;
      _db.onclose = () => { _db = null; };
      resolve(_db);
    };

    req.onerror = () => reject(req.error);
  });
}

// ── Outbox API ───────────────────────────────────────────────────────

/** Add a note to the outbox. Returns the assigned ID. */
export async function enqueue(
  entry: Omit<OutboxEntry, 'id' | 'status' | 'attempts'>,
): Promise<number> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OUTBOX_STORE, 'readwrite');
    const store = tx.objectStore(OUTBOX_STORE);
    const req = store.add({ ...entry, status: 'pending', attempts: 0 });
    req.onsuccess = () => resolve(req.result as number);
    req.onerror = () => reject(req.error);
  });
}

/** Get all entries, ordered by createdAt ascending. */
export async function getAll(): Promise<OutboxEntry[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OUTBOX_STORE, 'readonly');
    const store = tx.objectStore(OUTBOX_STORE);
    const req = store.getAll();
    req.onsuccess = () => {
      const entries = req.result as OutboxEntry[];
      entries.sort((a, b) => a.createdAt - b.createdAt);
      resolve(entries);
    };
    req.onerror = () => reject(req.error);
  });
}

/** Get count of pending + failed entries. */
export async function pendingCount(): Promise<number> {
  const entries = await getAll();
  return entries.filter((e) => e.status === 'pending' || e.status === 'failed').length;
}

/** Remove a successfully synced entry. */
export async function remove(id: number): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OUTBOX_STORE, 'readwrite');
    const store = tx.objectStore(OUTBOX_STORE);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/** Update status and error info after a sync attempt. */
export async function markStatus(
  id: number,
  status: OutboxEntry['status'],
  error?: string,
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OUTBOX_STORE, 'readwrite');
    const store = tx.objectStore(OUTBOX_STORE);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const entry = getReq.result as OutboxEntry | undefined;
      if (!entry) { resolve(); return; }
      entry.status = status;
      if (status === 'failed') {
        entry.attempts += 1;
        if (error) entry.lastError = error;
      }
      const putReq = store.put(entry);
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

/** Reset attempts to 0 so a failed entry can be retried. */
export async function resetAttempts(id: number): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OUTBOX_STORE, 'readwrite');
    const store = tx.objectStore(OUTBOX_STORE);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const entry = getReq.result as OutboxEntry | undefined;
      if (!entry) { resolve(); return; }
      entry.status = 'pending';
      entry.attempts = 0;
      entry.lastError = undefined;
      const putReq = store.put(entry);
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

// ── Draft API ────────────────────────────────────────────────────────

const DRAFT_KEY = 'current';

/** Save the in-progress draft. */
export async function saveDraft(draft: Draft): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DRAFT_STORE, 'readwrite');
    const store = tx.objectStore(DRAFT_STORE);
    const req = store.put(draft, DRAFT_KEY);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/** Load the saved draft, if any. */
export async function loadDraft(): Promise<Draft | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DRAFT_STORE, 'readonly');
    const store = tx.objectStore(DRAFT_STORE);
    const req = store.get(DRAFT_KEY);
    req.onsuccess = () => resolve((req.result as Draft) || null);
    req.onerror = () => reject(req.error);
  });
}

/** Clear the saved draft. */
export async function clearDraft(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DRAFT_STORE, 'readwrite');
    const store = tx.objectStore(DRAFT_STORE);
    const req = store.delete(DRAFT_KEY);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
