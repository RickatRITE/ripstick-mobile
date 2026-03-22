/** Offline chat queuing via IndexedDB — stores pending messages when relay is disconnected.
 *
 * When the relay connection drops, outgoing chat messages are written to
 * IndexedDB. On reconnect, queued messages are sent in local_seq order.
 * See SPEC_Server.md §11.
 */

const DB_NAME = 'ripstick-chat';
const DB_VERSION = 1;
const STORE_NAME = 'pending_messages';

/** A queued offline chat message. */
export interface PendingChatMessage {
  uuid: string;
  repo: string;
  group: string;
  created: string;
  body: string;
  mentions: string[];
  /** Monotonic per-device counter preserving send order. */
  local_seq: number;
}

let db: IDBDatabase | null = null;
let localSeqCounter = 0;

/** Open the IndexedDB (or create it on first use). */
function openDb(): Promise<IDBDatabase> {
  if (db) return Promise.resolve(db);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const idb = request.result;
      if (!idb.objectStoreNames.contains(STORE_NAME)) {
        idb.createObjectStore(STORE_NAME, { keyPath: 'uuid' });
      }
    };

    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onerror = () => reject(request.error);
  });
}

/** Queue a message for sending when the relay reconnects. */
export async function queueMessage(
  repo: string,
  group: string,
  body: string,
  mentions: string[],
): Promise<PendingChatMessage> {
  const idb = await openDb();
  const uuid = crypto.randomUUID();
  const msg: PendingChatMessage = {
    uuid,
    repo,
    group,
    created: new Date().toISOString(),
    body,
    mentions,
    local_seq: ++localSeqCounter,
  };

  return new Promise((resolve, reject) => {
    const tx = idb.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(msg);
    tx.oncomplete = () => resolve(msg);
    tx.onerror = () => reject(tx.error);
  });
}

/** Get all queued messages, sorted by local_seq. */
export async function getPendingMessages(): Promise<PendingChatMessage[]> {
  const idb = await openDb();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => {
      const msgs = request.result as PendingChatMessage[];
      msgs.sort((a, b) => a.local_seq - b.local_seq);
      resolve(msgs);
    };
    request.onerror = () => reject(request.error);
  });
}

/** Remove a message from the queue (after successful send). */
export async function removePending(uuid: string): Promise<void> {
  const idb = await openDb();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(uuid);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Count of pending messages. */
export async function pendingChatCount(): Promise<number> {
  const idb = await openDb();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
