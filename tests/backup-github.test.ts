import { describe, expect, it, vi } from 'vitest';
import { BackupError, createGithubClient, messageFor, toBase64Utf8 } from '../src/backup/github';
import { BACKUP } from '../src/config';
import { FAKE_TOKEN, FakeRepo } from './helpers/fake-repo';

type Opts = Parameters<typeof createGithubClient>[0];
const make = (repo: FakeRepo, over: Partial<Opts> = {}) => {
  const sleeps: number[] = [];
  const logs: string[] = [];
  const client = createGithubClient({
    token: FAKE_TOKEN,
    fetch: repo.fetch,
    sleep: async (ms) => void sleeps.push(ms),
    log: (m) => logs.push(m),
    ...over,
  });
  return { client, sleeps, logs };
};
const newRepo = (): FakeRepo => new FakeRepo(BACKUP.owner, BACKUP.repo);
const fail = async (p: Promise<unknown>): Promise<BackupError> => (await p.catch((e: unknown) => e)) as BackupError;

describe('base64 of UTF-8', () => {
  it('round-trips Cyrillic, emoji and a big text', () => {
    for (const s of ['', 'a', 'Привет, мир! ёЁ ₽', 'смайл 😀 и 𝄞', 'я'.repeat(100_000)]) {
      expect(Buffer.from(toBase64Utf8(s), 'base64').toString('utf8')).toBe(s);
    }
  });
});

describe('putFile', () => {
  it('creates a new file (404 on GET -> PUT without sha)', async () => {
    const repo = newRepo();
    const { client } = make(repo);
    await client.putFile('data/x.json', '{"a":"Привет"}', 'msg');
    expect(repo.files.get('data/x.json')).toBe('{"a":"Привет"}');
    expect(repo.log.map((l) => l.method)).toEqual(['GET', 'PUT']);
  });

  it('updates an existing file with its current sha', async () => {
    const repo = newRepo();
    repo.files.set('data/x.json', 'old');
    const { client } = make(repo);
    await client.putFile('data/x.json', 'new', 'msg');
    expect(repo.files.get('data/x.json')).toBe('new');
  });

  it('sends the documented headers and body', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const repo = newRepo();
    const { client } = make(repo, {
      fetch: async (u, i) => {
        seen.push({ url: String(u), init: i ?? {} });
        return repo.fetch(u, i);
      },
    });
    await client.putFile('data/x.json', 'тест', 'backup');
    expect(seen[0].url).toBe(`https://api.github.com/repos/${BACKUP.owner}/${BACKUP.repo}/contents/data/x.json`);
    const h = new Headers(seen[1].init.headers);
    expect(h.get('authorization')).toBe(`Bearer ${FAKE_TOKEN}`);
    expect(h.get('accept')).toBe('application/vnd.github+json');
    expect(h.get('x-github-api-version')).toBe(BACKUP.apiVersion);
    const body = JSON.parse(String(seen[1].init.body)) as { message: string; content: string; sha?: string };
    expect(body.message).toBe('backup');
    expect(Buffer.from(body.content, 'base64').toString('utf8')).toBe('тест');
    expect(body.sha).toBeUndefined();
    // Only headers GitHub's CORS preflight allows (Safari adds Cache-Control/Pragma for cache:'no-store' -> preflight fails).
    expect(seen[0].init.cache).toBeUndefined();
    const names = [...new Headers(seen[1].init.headers).keys()].sort();
    expect(names).toEqual(['accept', 'authorization', 'content-type', 'x-github-api-version']);
    expect([...new Headers(seen[0].init.headers).keys()].sort()).toEqual(['accept', 'authorization', 'x-github-api-version']);
  });

  it('409 -> re-GET sha and retry succeeds', async () => {
    const repo = newRepo();
    repo.files.set('p', 'old');
    repo.failures.push({ method: 'PUT', status: 409 });
    const { client, sleeps } = make(repo);
    await client.putFile('p', 'new', 'm');
    expect(repo.files.get('p')).toBe('new');
    expect(repo.log.map((l) => l.method)).toEqual(['GET', 'PUT', 'GET', 'PUT']);
    expect(sleeps).toEqual([BACKUP.backoffMs[0]]);
  });

  it('422 -> same', async () => {
    const repo = newRepo();
    repo.failures.push({ method: 'PUT', status: 422 });
    const { client } = make(repo);
    await client.putFile('p', 'new', 'm');
    expect(repo.files.get('p')).toBe('new');
    expect(repo.log.filter((l) => l.method === 'GET')).toHaveLength(2);
  });

  it('gives up after maxRetries retries with a friendly conflict error', async () => {
    const repo = newRepo();
    for (let i = 0; i < 10; i += 1) repo.failures.push({ method: 'PUT', status: 409 });
    const { client, sleeps } = make(repo);
    const err = await fail(client.putFile('p', 'x', 'm'));
    expect(err).toBeInstanceOf(BackupError);
    expect(err.kind).toBe('conflict');
    expect(repo.putCount()).toBe(BACKUP.maxRetries + 1);
    expect(sleeps).toEqual([...BACKUP.backoffMs]);
  });

  it('401 -> auth error, no retry loop', async () => {
    const repo = newRepo();
    const { client } = make(repo, { token: 'github_pat_WRONG_FAKE' });
    const err = await fail(client.putFile('p', 'x', 'm'));
    expect(err.kind).toBe('auth');
    expect(messageFor(err.kind)).toBe('ключ доступа не подходит или истёк');
    expect(repo.log).toHaveLength(1);
  });

  it('403 on PUT -> auth too', async () => {
    const repo = newRepo();
    repo.failures.push({ method: 'PUT', status: 403 });
    const { client } = make(repo);
    const err = await fail(client.putFile('p', 'x', 'm'));
    expect(err.kind).toBe('auth');
    expect(repo.putCount()).toBe(1);
  });

  it('fetch throwing (no network) -> offline', async () => {
    const repo = newRepo();
    const { client } = make(repo, {
      fetch: async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    const err = await fail(client.putFile('p', 'x', 'm'));
    expect(err.kind).toBe('offline');
    expect(messageFor(err.kind)).toBe('нет интернета');
  });

  it('500 -> server error without retry spam', async () => {
    const repo = newRepo();
    repo.failures.push({ method: 'PUT', status: 500 });
    const { client } = make(repo);
    const err = await fail(client.putFile('p', 'x', 'm'));
    expect(err.kind).toBe('server');
    expect(repo.putCount()).toBe(1);
  });

  it('logs only status and path: never the token or headers', async () => {
    const repo = newRepo();
    repo.failures.push({ method: 'PUT', status: 409 }, { method: 'PUT', status: 401 });
    const { client, logs } = make(repo);
    await client.putFile('data/x.json', 'x', 'm').catch(() => undefined);
    expect(logs.length).toBeGreaterThan(0);
    for (const l of logs) {
      expect(l).not.toContain(FAKE_TOKEN);
      expect(l).not.toContain('github_pat');
      expect(l).not.toMatch(/bearer/i);
    }
    expect(logs.some((l) => l.includes('409') && l.includes('data/x.json'))).toBe(true);
  });

  it('the default logger writes nothing with the token to the console', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    const repo = newRepo();
    repo.failures.push({ method: 'PUT', status: 401 });
    const client = createGithubClient({ token: FAKE_TOKEN, fetch: repo.fetch, sleep: async () => undefined });
    await client.putFile('p', 'x', 'm').catch(() => undefined);
    const all = spies.flatMap((s) => s.mock.calls.flat().map(String)).join('\n');
    spies.forEach((s) => s.mockRestore());
    expect(all).not.toContain(FAKE_TOKEN);
  });
});

describe('getText', () => {
  it('returns the raw text, null on 404', async () => {
    const repo = newRepo();
    repo.files.set('p', '{"к":"Привет"}');
    const { client } = make(repo);
    expect(await client.getText('p')).toBe('{"к":"Привет"}');
    expect(await client.getText('missing')).toBeNull();
  });
  it('401 -> auth', async () => {
    const repo = newRepo();
    const { client } = make(repo, { token: 'github_pat_WRONG_FAKE' });
    const err = await fail(client.getText('p'));
    expect(err.kind).toBe('auth');
  });
});
