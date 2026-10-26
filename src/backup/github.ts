// GitHub contents API client (GET sha -> PUT base64). `fetch` is injected so tests never touch the network.
// Logging: status + path only. The token and the headers are never logged and never put in an error.
import { BACKUP } from '../config';

export type BackupErrorKind = 'auth' | 'offline' | 'timeout' | 'conflict' | 'not_found' | 'server';

const MESSAGES: Record<BackupErrorKind, string> = {
  auth: 'ключ доступа не подходит или истёк',
  offline: 'нет интернета',
  timeout: 'GitHub не отвечает',
  conflict: 'копия изменилась в другом месте, попробую позже',
  not_found: 'нет доступа к репозиторию с копией',
  server: 'GitHub сейчас не отвечает',
};

export const messageFor = (kind: BackupErrorKind): string => MESSAGES[kind];

export class BackupError extends Error {
  constructor(
    public readonly kind: BackupErrorKind,
    public readonly status?: number,
  ) {
    super(MESSAGES[kind]);
    this.name = 'BackupError';
  }
}

/** UTF-8 text -> base64 (TextEncoder -> bytes -> btoa in chunks, so Cyrillic and big texts are safe). */
export function toBase64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export interface ClientOptions {
  token: string;
  fetch: typeof fetch;
  owner?: string;
  repo?: string;
  sleep?: (ms: number) => Promise<void>;
  /** Receives short lines like «409 PUT data/x.json». Default: console.warn. */
  log?: (line: string) => void;
}

export interface GithubClient {
  /** Create or update a file with `text` (UTF-8). Retries 409/422 with a fresh sha. Throws BackupError. */
  putFile: (path: string, text: string, message: string) => Promise<void>;
  /** Raw text of a file, or null when it does not exist. Throws BackupError. */
  getText: (path: string) => Promise<string | null>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export function createGithubClient(opts: ClientOptions): GithubClient {
  const owner = opts.owner ?? BACKUP.owner;
  const repo = opts.repo ?? BACKUP.repo;
  const sleep = opts.sleep ?? defaultSleep;
  const log = opts.log ?? ((line: string) => console.warn(`[backup] ${line}`));
  const url = (path: string): string => `https://api.github.com/repos/${owner}/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;

  async function call(method: 'GET' | 'PUT', path: string, accept: string, body?: string): Promise<Response> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), BACKUP.timeoutMs);
    try {
      // No `cache` option and no extra headers: Safari turns cache:'no-store' into Cache-Control/Pragma request headers,
      // which GitHub's CORS preflight does not allow. Only Authorization, Accept, X-GitHub-Api-Version (+ Content-Type on PUT).
      const res = await opts.fetch(url(path), {
        method,
        signal: ctl.signal,
        headers: {
          Authorization: `Bearer ${opts.token}`,
          Accept: accept,
          'X-GitHub-Api-Version': BACKUP.apiVersion,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body }),
      });
      if (!res.ok) log(`${res.status} ${method} ${path}`);
      return res;
    } catch {
      // Never log the error object: only that the request did not complete.
      log(`no response ${method} ${path}`);
      throw new BackupError(ctl.signal.aborted ? 'timeout' : 'offline');
    } finally {
      clearTimeout(timer);
    }
  }

  const failFor = (status: number): BackupError => {
    if (status === 401 || status === 403) return new BackupError('auth', status);
    if (status === 404) return new BackupError('not_found', status);
    return new BackupError('server', status);
  };

  /** The sha of the file now, or undefined when it does not exist yet. */
  async function currentSha(path: string): Promise<string | undefined> {
    const res = await call('GET', path, 'application/vnd.github+json');
    if (res.status === 404) return undefined;
    if (!res.ok) throw failFor(res.status);
    const data = (await res.json()) as { sha?: unknown };
    if (typeof data.sha !== 'string') throw new BackupError('server', res.status);
    return data.sha;
  }

  async function putFile(path: string, text: string, message: string): Promise<void> {
    const content = toBase64Utf8(text);
    for (let attempt = 0; ; attempt += 1) {
      const sha = await currentSha(path);
      const res = await call('PUT', path, 'application/vnd.github+json', JSON.stringify({ message, content, ...(sha ? { sha } : {}) }));
      if (res.ok) return;
      if (res.status === 409 || res.status === 422) {
        if (attempt >= BACKUP.maxRetries) throw new BackupError('conflict', res.status);
        await sleep(BACKUP.backoffMs[Math.min(attempt, BACKUP.backoffMs.length - 1)]);
        continue;
      }
      throw failFor(res.status);
    }
  }

  async function getText(path: string): Promise<string | null> {
    const res = await call('GET', path, 'application/vnd.github.raw+json');
    if (res.status === 404) return null;
    if (!res.ok) throw failFor(res.status);
    return res.text();
  }

  return { putFile, getText };
}
