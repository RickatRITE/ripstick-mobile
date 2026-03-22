/** Relay WebSocket client for mobile — connects to the RipStick relay server
 * for real-time chat, presence, and sync signals.
 *
 * Same protocol as the desktop client (shared/relay.ts), adapted for the
 * vanilla TypeScript PWA architecture (no React, no Zustand).
 */

import {
  RELAY_PROTOCOL_VERSION,
  HEARTBEAT_ACTIVE_MS,
  HEARTBEAT_IDLE_MS,
  PRESENCE_TIMEOUT_MS,
} from '../../shared/relay';
import type {
  RelayConnect,
  RelayHeartbeat,
  ServerMessage,
  RelayChatBroadcast,
  ChatMessagePayload,
  DmSummary,
  RepoEntry,
  MemberPresence,
} from '../../shared/relay';

// ── State ──────────────────────────────────────────────────────────────

let ws: WebSocket | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let reconnectDelay = 1000;
let relayUrl: string | null = null;
let workspaceId: string | null = null;
let username: string | null = null;
let connected = false;

/** Chat messages received from the relay, keyed by channel. */
export const chatMessages: Map<string, ChatMessage[]> = new Map();

/** Workspace manifest data (repos + DMs). */
export let workspaceRepos: RepoEntry[] = [];
export let dmSummaries: DmSummary[] = [];

/** Member presence (online/idle/offline). */
export let memberPresence: Record<string, MemberPresence> = {};

/** Callbacks for UI updates. */
let onChatMessage: ((channel: string, msg: ChatMessage) => void) | null = null;
let onConnectionChange: ((connected: boolean) => void) | null = null;
let onManifestUpdate: (() => void) | null = null;

export interface ChatMessage {
  uuid: string;
  created: string;
  created_by: string;
  body: string;
  seq: number | null;
  mentions: string[];
  pending: boolean;
}

// ── Public API ─────────────────────────────────────────────────────────

/** Configure the relay connection. Call once on app init. */
export function configureRelay(url: string, workspace: string, user: string): void {
  relayUrl = url;
  workspaceId = workspace;
  username = user;
}

/** Connect to the relay. No-op if not configured. */
export function connectRelay(): void {
  if (!relayUrl || !workspaceId || !username) return;
  if (ws && ws.readyState === WebSocket.OPEN) return;

  try {
    ws = new WebSocket(relayUrl);
  } catch {
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    reconnectDelay = 1000;
    const msg: RelayConnect = {
      v: RELAY_PROTOCOL_VERSION,
      type: 'connect',
      workspace_id: workspaceId!,
      user: username!,
    };
    ws!.send(JSON.stringify(msg));
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data) as ServerMessage;
      handleMessage(msg);
    } catch { /* ignore malformed */ }
  };

  ws.onclose = () => {
    connected = false;
    onConnectionChange?.(false);
    stopHeartbeat();
    scheduleReconnect();
  };

  ws.onerror = () => { /* onclose fires after */ };
}

/** Disconnect from the relay. */
export function disconnectRelay(): void {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  stopHeartbeat();
  if (ws) {
    ws.close();
    ws = null;
  }
  connected = false;
  onConnectionChange?.(false);
}

/** Send a chat message via the relay. */
export function sendChat(repo: string, group: string, body: string): void {
  if (!ws || ws.readyState !== WebSocket.OPEN || !username) return;

  const uuid = crypto.randomUUID();
  const created = new Date().toISOString();

  // Parse @mentions
  const mentionPattern = /@(\w+)/g;
  const mentions: string[] = [];
  let match;
  while ((match = mentionPattern.exec(body)) !== null) {
    mentions.push(match[1]);
  }

  // Optimistic add
  const channel = `${repo}:${group}/_chat`;
  const localMsg: ChatMessage = {
    uuid, created, created_by: username, body,
    seq: null, mentions, pending: true,
  };
  addMessage(channel, localMsg);

  ws.send(JSON.stringify({
    type: 'chat',
    v: RELAY_PROTOCOL_VERSION,
    repo,
    group,
    message: { uuid, created, body } as ChatMessagePayload,
    mentions,
  }));
}

/** Send an AI request via the relay server. Returns request_id for tracking. */
export function sendAiRequest(prompt: string, context?: string, model?: string): string {
  if (!ws || ws.readyState !== WebSocket.OPEN) return '';

  const requestId = crypto.randomUUID();
  ws.send(JSON.stringify({
    type: 'ai_request',
    v: RELAY_PROTOCOL_VERSION,
    request_id: requestId,
    prompt,
    context,
    model,
  }));
  return requestId;
}

/** AI response callbacks, keyed by request_id. */
const aiCallbacks = new Map<string, (delta: string, done: boolean) => void>();

/** Register a callback for AI response streaming. */
export function onAiResponse(requestId: string, cb: (delta: string, done: boolean) => void): void {
  aiCallbacks.set(requestId, cb);
}

/** Register callbacks for UI updates. */
export function onRelay(handlers: {
  onChat?: (channel: string, msg: ChatMessage) => void;
  onConnection?: (connected: boolean) => void;
  onManifest?: () => void;
}): void {
  onChatMessage = handlers.onChat || null;
  onConnectionChange = handlers.onConnection || null;
  onManifestUpdate = handlers.onManifest || null;
}

/** Whether the relay is currently connected. */
export function isRelayConnected(): boolean {
  return connected;
}

// ── Internal ───────────────────────────────────────────────────────────

function handleMessage(msg: ServerMessage): void {
  switch (msg.type) {
    case 'ack':
      connected = true;
      onConnectionChange?.(true);
      startHeartbeat();
      break;

    case 'chat_ack': {
      const ack = msg as any;
      // Confirm pending message
      for (const [, msgs] of chatMessages) {
        const m = msgs.find(m => m.uuid === ack.uuid);
        if (m) { m.seq = ack.seq; m.pending = false; }
      }
      break;
    }

    case 'chat_broadcast': {
      const cb = msg as RelayChatBroadcast;
      const channel = `${cb.repo}:${cb.group}/_chat`;
      const chatMsg: ChatMessage = {
        uuid: cb.message.uuid,
        created: cb.message.created,
        created_by: cb.sender,
        body: cb.message.body,
        seq: cb.seq,
        mentions: cb.mentions,
        pending: false,
      };
      addMessage(channel, chatMsg);
      break;
    }

    case 'sync':
      // Another client pushed — could trigger a git sync on mobile
      break;

    case 'workspace_manifest': {
      const wm = msg as any;
      workspaceRepos = wm.repos || [];
      dmSummaries = wm.dm_summaries || [];
      onManifestUpdate?.();
      break;
    }

    case 'presence_summary': {
      const ps = msg as any;
      memberPresence = ps.members || {};
      break;
    }

    case 'mention_notify': {
      // Could trigger a push notification or badge update
      break;
    }

    case 'ai_response': {
      const ar = msg as any;
      const cb = aiCallbacks.get(ar.request_id);
      if (cb) {
        cb(ar.delta, ar.done);
        if (ar.done) aiCallbacks.delete(ar.request_id);
      }
      break;
    }

    case 'mutation_broadcast':
    case 'channel_state':
    case 'cursor_sync':
    case 'cursor_update':
    case 'channel_create_ack':
    case 'dm_repo_error':
    case 'recovery_mode':
      break;

    default:
      break;
  }
}

function addMessage(channel: string, msg: ChatMessage): void {
  let msgs = chatMessages.get(channel);
  if (!msgs) {
    msgs = [];
    chatMessages.set(channel, msgs);
  }
  // Deduplicate
  if (!msgs.find(m => m.uuid === msg.uuid)) {
    msgs.push(msg);
    onChatMessage?.(channel, msg);
  }
}

function startHeartbeat(): void {
  stopHeartbeat();
  const interval = document.hasFocus() ? HEARTBEAT_ACTIVE_MS : HEARTBEAT_IDLE_MS;
  heartbeatTimer = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      const msg: RelayHeartbeat = {
        v: RELAY_PROTOCOL_VERSION,
        type: 'heartbeat',
        event: 'heartbeat',
      };
      ws.send(JSON.stringify(msg));
    }
  }, interval);
}

function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = undefined;
  }
}

function scheduleReconnect(): void {
  reconnectTimer = setTimeout(() => {
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
    connectRelay();
  }, reconnectDelay);
}
