/** GitHub Contents API wrapper for creating notes. */

const GITHUB_API = 'https://api.github.com';

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
  };
}

/** List groups (top-level directories) in the repo. */
export async function listGroups(token: string, repo: string): Promise<string[]> {
  const res = await fetch(`${GITHUB_API}/repos/${repo}/contents/`, {
    headers: headers(token),
  });
  if (!res.ok) throw new Error(`List groups: ${res.status}`);
  const items = await res.json() as Array<{ name: string; type: string }>;
  return items
    .filter((i) => i.type === 'dir' && !i.name.startsWith('.') && !i.name.startsWith('_'))
    .map((i) => i.name);
}

/** List files in a group directory. */
export async function listFiles(token: string, repo: string, group: string): Promise<string[]> {
  const res = await fetch(`${GITHUB_API}/repos/${repo}/contents/${encodeURIComponent(group)}`, {
    headers: headers(token),
  });
  if (!res.ok) return [];
  const items = await res.json() as Array<{ name: string; type: string }>;
  return items.filter((i) => i.type === 'file' && i.name.endsWith('.md')).map((i) => i.name);
}

/** Create a note file via PUT /contents/{path}. */
export async function createNote(
  token: string,
  repo: string,
  group: string,
  filename: string,
  content: string,
  commitMessage: string,
): Promise<void> {
  const path = `${group}/${filename}`;
  const encodedContent = btoa(unescape(encodeURIComponent(content)));

  const res = await fetch(`${GITHUB_API}/repos/${repo}/contents/${encodeURIComponent(path)}`, {
    method: 'PUT',
    headers: headers(token),
    body: JSON.stringify({
      message: commitMessage,
      content: encodedContent,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Create note failed (${res.status}): ${body}`);
  }
}
