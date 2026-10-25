// In-memory fake of the GitHub contents API (GET/PUT with sha), used by the unit tests and the Playwright mock.
// It never talks to the network. The token it expects is always a FAKE value.
import { createHash } from 'node:crypto';

export const FAKE_TOKEN = 'github_pat_FAKE_TEST_0000';

export interface FakeRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
}

export interface FakeResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface Failure {
  method: 'GET' | 'PUT';
  status: number;
  /** Only requests for this repo path (e.g. `data/pocket-brain.json`); omitted = any path. */
  path?: string;
}

const sha1 = (s: string): string => createHash('sha1').update(s, 'utf8').digest('hex');
const json = (status: number, value: unknown): FakeResponse => ({
  status,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(value),
});

export class FakeRepo {
  /** path -> decoded text */
  files = new Map<string, string>();
  /** Every request seen: method + repo path (no headers, so a token can never end up here). */
  log: { method: string; path: string }[] = [];
  /** One-shot failures, consumed in order by the first request that matches. */
  failures: Failure[] = [];
  inflight = 0;
  maxInflight = 0;

  constructor(
    public owner: string,
    public repo: string,
    public token: string = FAKE_TOKEN,
  ) {}

  putCount(): number {
    return this.log.filter((l) => l.method === 'PUT').length;
  }

  /** Synchronous core: one request in, one response out. */
  handle(req: FakeRequest): FakeResponse {
    const url = new URL(req.url);
    const prefix = `/repos/${this.owner}/${this.repo}/contents/`;
    if (!url.pathname.startsWith(prefix)) return json(404, { message: 'Not Found' });
    const path = decodeURIComponent(url.pathname.slice(prefix.length));
    this.log.push({ method: req.method, path });

    const auth = req.headers['authorization'] ?? '';
    if (auth !== `Bearer ${this.token}`) return json(401, { message: 'Bad credentials' });

    const i = this.failures.findIndex((f) => f.method === req.method && (f.path === undefined || f.path === path));
    if (i >= 0) {
      const [f] = this.failures.splice(i, 1);
      return json(f.status, { message: `injected ${f.status}` });
    }

    const existing = this.files.get(path);
    if (req.method === 'GET') {
      if (existing === undefined) return json(404, { message: 'Not Found' });
      if ((req.headers['accept'] ?? '').includes('raw')) {
        return { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' }, body: existing };
      }
      return json(200, {
        type: 'file',
        path,
        sha: sha1(existing),
        encoding: 'base64',
        content: Buffer.from(existing, 'utf8').toString('base64'),
      });
    }
    if (req.method === 'PUT') {
      let body: { message?: unknown; content?: unknown; sha?: unknown };
      try {
        body = JSON.parse(req.body ?? '') as typeof body;
      } catch {
        return json(422, { message: 'Invalid request' });
      }
      if (typeof body.message !== 'string' || typeof body.content !== 'string') return json(422, { message: 'Invalid request' });
      if (existing !== undefined && body.sha === undefined) return json(422, { message: "Invalid request. \"sha\" wasn't supplied." });
      if (existing === undefined && body.sha !== undefined) return json(422, { message: 'sha given for a new file' });
      if (existing !== undefined && body.sha !== sha1(existing)) return json(409, { message: `${path} does not match` });
      const text = Buffer.from(body.content, 'base64').toString('utf8');
      this.files.set(path, text);
      return json(existing === undefined ? 201 : 200, { content: { path, sha: sha1(text) } });
    }
    return json(404, { message: 'Not Found' });
  }

  /** A `fetch` for the unit tests: the same core plus in-flight counting and a short async delay. */
  fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    this.inflight += 1;
    this.maxInflight = Math.max(this.maxInflight, this.inflight);
    try {
      await new Promise((r) => setTimeout(r, 5));
      const headers: Record<string, string> = {};
      new Headers(init.headers).forEach((v, k) => {
        headers[k.toLowerCase()] = v;
      });
      const res = this.handle({
        method: (init.method ?? 'GET').toUpperCase(),
        url: String(input),
        headers,
        body: typeof init.body === 'string' ? init.body : null,
      });
      return new Response(res.body, { status: res.status, headers: res.headers });
    } finally {
      this.inflight -= 1;
    }
  };
}
