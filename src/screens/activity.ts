/** Activity stream — unified feed of chat messages, @mentions, and task changes.
 *
 * Spec §6: "Activity stream (right panel unified feed) — requires full workspace
 * context from private spaces."
 *
 * On mobile, rendered as a full-screen scrollable feed sorted by time.
 */

import { state, render } from '../state';
import { chatMessages, memberPresence } from '../relay';

interface ActivityItem {
  type: 'chat' | 'mention';
  channel: string;
  sender: string;
  body: string;
  timestamp: string;
  seq: number | null;
}

/** Render the activity stream screen. */
export function renderActivity(app: HTMLElement): void {
  const items = buildActivityFeed();

  app.innerHTML = `
    <div class="activity-screen">
      <header class="activity-header">
        <button class="back-btn" id="activity-back">&larr;</button>
        <span class="activity-title">Activity</span>
      </header>

      <div class="activity-feed" id="activity-feed">
        ${items.length === 0
          ? '<div class="activity-empty">No recent activity</div>'
          : items.map(renderActivityItem).join('')
        }
      </div>
    </div>
  `;

  document.getElementById('activity-back')?.addEventListener('click', () => {
    state.screen = 'recent';
    render();
  });
}

function buildActivityFeed(): ActivityItem[] {
  const items: ActivityItem[] = [];

  // Gather all chat messages across all channels
  for (const [channel, messages] of chatMessages) {
    for (const msg of messages) {
      if (msg.seq === null && !msg.pending) continue;
      items.push({
        type: msg.mentions.includes(state.username) ? 'mention' : 'chat',
        channel,
        sender: msg.created_by,
        body: msg.body,
        timestamp: msg.created,
        seq: msg.seq,
      });
    }
  }

  // Sort by timestamp descending (most recent first)
  items.sort((a, b) => {
    const ta = new Date(a.timestamp).getTime();
    const tb = new Date(b.timestamp).getTime();
    return tb - ta;
  });

  // Limit to most recent 50 items
  return items.slice(0, 50);
}

function renderActivityItem(item: ActivityItem): string {
  const time = formatTime(item.timestamp);
  const initial = item.sender.charAt(0).toUpperCase();
  const channelName = item.channel.split(':').pop()?.replace('/_chat', '') || item.channel;
  const mentionClass = item.type === 'mention' ? ' activity-item-mention' : '';
  const online = memberPresence[item.sender]?.status === 'online';

  return `
    <div class="activity-item${mentionClass}">
      <div class="activity-item-avatar ${online ? 'online' : ''}">${initial}</div>
      <div class="activity-item-content">
        <div class="activity-item-meta">
          <span class="activity-item-sender">${escapeHtml(item.sender)}</span>
          <span class="activity-item-channel">#${escapeHtml(channelName)}</span>
          <span class="activity-item-time">${time}</span>
        </div>
        <div class="activity-item-body">${escapeHtml(item.body)}</div>
      </div>
    </div>
  `;
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'now';
    if (diffMin < 60) return `${diffMin}m`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH}h`;
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
