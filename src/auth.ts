/** GitHub Personal Access Token auth for mobile PWA. */

const TOKEN_KEY = 'ripstick-github-pat';
const REPO_KEY = 'ripstick-github-repo';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export function getRepoFullName(): string | null {
  return localStorage.getItem(REPO_KEY);
}

export function setRepoFullName(repo: string): void {
  localStorage.setItem(REPO_KEY, repo);
}

/** Validate token by calling GET /user. Returns the username on success. */
export async function validateToken(token: string): Promise<string> {
  const res = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(`Auth failed: ${res.status}`);
  const data = await res.json();
  return data.login as string;
}

/** Auto-discover the ripstick-notes repo for the authenticated user. */
export async function discoverRepo(token: string): Promise<string | null> {
  const res = await fetch('https://api.github.com/user/repos?per_page=100&sort=updated', {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) return null;
  const repos = await res.json() as Array<{ full_name: string; name: string }>;
  const match = repos.find((r) => r.name === 'ripstick-notes');
  return match?.full_name ?? null;
}
