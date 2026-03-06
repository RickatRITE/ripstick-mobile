/** GitHub Contents API wrapper for RipStick mobile. */

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
  const items = (await res.json()) as Array<{ name: string; type: string }>;
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
  const items = (await res.json()) as Array<{ name: string; type: string }>;
  return items.filter((i) => i.type === 'file' && i.name.endsWith('.md')).map((i) => i.name);
}

export interface FileEntry {
  name: string;
  path: string;
  sha: string;
  type: string;
}

/** Get all files in the repo via the Git Trees API (single call). */
export async function getAllFiles(token: string, repo: string): Promise<FileEntry[]> {
  const res = await fetch(`${GITHUB_API}/repos/${repo}/git/trees/main?recursive=1`, {
    headers: headers(token),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { tree: FileEntry[] };
  return data.tree.filter((f) => f.type === 'blob' && f.path.endsWith('.md') && !f.path.startsWith('_') && !f.path.startsWith('.'));
}

export interface FileContent {
  content: string;
  sha: string;
}

/** Fetch a single file's content and SHA. */
export async function getFileContent(token: string, repo: string, path: string): Promise<FileContent> {
  const res = await fetch(`${GITHUB_API}/repos/${repo}/contents/${encodeURIComponent(path)}`, {
    headers: headers(token),
  });
  if (!res.ok) throw new Error(`Get file: ${res.status}`);
  const data = (await res.json()) as { content: string; sha: string };
  // GitHub returns base64-encoded content
  const content = decodeURIComponent(escape(atob(data.content.replace(/\n/g, ''))));
  return { content, sha: data.sha };
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

/** Update an existing file via PUT /contents/{path} (requires SHA). */
export async function updateFile(
  token: string,
  repo: string,
  path: string,
  content: string,
  sha: string,
  commitMessage: string,
): Promise<void> {
  const encodedContent = btoa(unescape(encodeURIComponent(content)));

  const res = await fetch(`${GITHUB_API}/repos/${repo}/contents/${encodeURIComponent(path)}`, {
    method: 'PUT',
    headers: headers(token),
    body: JSON.stringify({
      message: commitMessage,
      content: encodedContent,
      sha,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Update failed (${res.status}): ${body}`);
  }
}
