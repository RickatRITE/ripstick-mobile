/** Chat screen — real-time message stream via relay server.
 * Supports public channels (groups) and DMs (from workspace manifest).
 */

import { state, render } from '../state';
import { chatMessages, sendChat, isRelayConnected, dmSummaries, memberPresence, type ChatMessage } from '../relay';

/** Render the chat screen. */
export function renderChat(app: HTMLElement): void {
  const group = state.selectedGroup;
  const channel = `chat:${group}/_chat`;
  const messages = chatMessages.get(channel) || [];
  const connected = isRelayConnected();

  // DM summaries for sidebar
  const dms = dmSummaries || [];

  app.innerHTML = `
    <div class="chat-screen">
      <header class="chat-header">
        <button class="back-btn" id="chat-back">&larr;</button>
        <span class="chat-channel-name">#${escapeHtml(group)}</span>
        ${!connected ? '<span class="chat-offline">offline</span>' : ''}
      </header>

      ${dms.length > 0 ? `
        <div class="dm-sidebar-mobile">
          <div class="dm-sidebar-header">Direct Messages</div>
          ${dms.map(dm => {
            const online = dm.participants.some(p => memberPresence[p]?.status === 'online');
            return `
              <button class="dm-sidebar-item ${dm.unread_count > 0 ? 'unread' : ''}" data-dm="${dm.repo_name}">
                <span class="dm-dot ${online ? 'online' : ''}"></span>
                <span class="dm-name">${escapeHtml(dm.participants.join(', '))}</span>
                ${dm.unread_count > 0 ? `<span class="dm-badge">${dm.unread_count}</span>` : ''}
              </button>
            `;
          }).join('')}
        </div>
      ` : ''}

      <div class="chat-messages" id="chat-messages">
        ${messages.length === 0
          ? '<div class="chat-empty">No messages yet</div>'
          : messages
              .filter(m => m.seq !== null || m.pending)
              .sort((a, b) => (a.seq ?? Infinity) - (b.seq ?? Infinity))
              .map(renderMessage)
              .join('')
        }
      </div>

      <div class="chat-input-bar">
        <textarea
          id="chat-input"
          placeholder="${connected ? 'Type a message...' : 'Offline — connect to send'}"
          rows="1"
          ${!connected ? 'disabled' : ''}
        ></textarea>
      </div>
    </div>
  `;

  // Scroll to bottom
  const messagesEl = document.getElementById('chat-messages');
  if (messagesEl) {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // Back button
  document.getElementById('chat-back')?.addEventListener('click', () => {
    state.screen = 'recent' as any;
    render();
  });

  // DM item clicks
  document.querySelectorAll('.dm-sidebar-item').forEach(el => {
    el.addEventListener('click', () => {
      const repoName = (el as HTMLElement).dataset.dm!;
      state.selectedGroup = repoName;
      renderChat(app);
    });
  });

  // Input: Enter to send, Shift+Enter for newline
  const input = document.getElementById('chat-input') as HTMLTextAreaElement;
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const text = input.value.trim();
      if (text && connected) {
        sendChat('chat', group, text);
        input.value = '';
        // Re-render to show the pending message
        renderChat(app);
      }
    }
  });

  // Auto-resize textarea
  input?.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  });
}

function renderMessage(msg: ChatMessage): string {
  const time = formatTime(msg.created);
  const initial = msg.created_by.charAt(0).toUpperCase();
  const pendingClass = msg.pending ? ' chat-msg-pending' : '';

  return `
    <div class="chat-msg${pendingClass}">
      <div class="chat-msg-avatar">${initial}</div>
      <div class="chat-msg-content">
        <div class="chat-msg-header">
          <span class="chat-msg-author">${escapeHtml(msg.created_by)}</span>
          <span class="chat-msg-time">${time}</span>
        </div>
        <div class="chat-msg-body">${escapeHtml(msg.body)}</div>
      </div>
    </div>
  `;
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
