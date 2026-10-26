// Stage 4 e2e: backup, restore, export against an in-memory fake of api.github.com.
// SECURITY: only the FAKE token is ever used; api.github.com is never really contacted (every request is mocked).
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { FAKE_TOKEN, FakeRepo } from '../tests/helpers/fake-repo';
import { captureShortcutClicks } from './helpers';

const OWNER = 'pf2kjvgbfh-create';
const MAIN = 'data/pocket-brain.json';
const REMINDER = 'напомни завтра в 19:00 позвонить маме';
const IDEA = 'что-то непонятное про вторник';

// A service worker can make Playwright miss requests (WebKit then sends them to the REAL network). Backups do not
// need the service worker, so it is blocked here; `expectNoLeak` also checks that the mock saw every request.
test.use({ serviceWorkers: 'block' });

// A saved reminder opens the Shortcut by itself after 5 s: the click is recorded, never really followed.
test.beforeEach(async ({ page }) => {
  await captureShortcutClicks(page);
});

// A backup upload can still be in flight when a test ends (after a restore the app rewrites a version-1 copy):
// drop the mock routes first, or Playwright fails the test on the unfinished route callback.
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

const CORS = {
  'access-control-allow-origin': '*',
  // Close to the preflight answer of the real api.github.com (from memory). Cache-Control and Pragma are added to the
  // request by Playwright's WebKit itself while routing is on (the app never sends them: see tests/backup-github.test.ts).
  'access-control-allow-headers':
    'Authorization, Content-Type, If-Match, If-Modified-Since, If-None-Match, If-Unmodified-Since, Accept-Encoding, X-GitHub-OTP, X-Requested-With, User-Agent, X-GitHub-Api-Version, Cache-Control, Pragma',
  'access-control-allow-methods': 'GET,PUT,OPTIONS',
};

interface Seen {
  urls: string[];
  bodies: string[];
  /** Non-preflight requests answered by the mock. */
  handled: number;
  /** Requests the page reports for api.github.com (must equal `handled`: nothing reached the real network). */
  pageRequests: number;
}

/** Mock every api.github.com request with the fake repo; also remember all URLs and bodies for the leak check. */
async function mockGithub(page: Page, repo: FakeRepo): Promise<Seen> {
  const seen: Seen = { urls: [], bodies: [], handled: 0, pageRequests: 0 };
  page.on('request', (r) => {
    if (r.url().startsWith('https://api.github.com/')) seen.pageRequests += 1;
  });
  await page.route('https://api.github.com/**', async (route) => {
    const req = route.request();
    seen.urls.push(req.url());
    if (req.method() !== 'OPTIONS') seen.handled += 1;
    // A mocked response would still be delivered while the context is offline, so behave like the network: fail.
    if (!(await page.evaluate(() => navigator.onLine))) {
      await route.abort('internetdisconnected');
      return;
    }
    if (req.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: CORS });
      return;
    }
    const body = req.postData();
    if (body) seen.bodies.push(body);
    const res = repo.handle({ method: req.method(), url: req.url(), headers: await req.allHeaders(), body });
    await route.fulfill({ status: res.status, headers: { ...res.headers, ...CORS }, body: res.body });
  });
  return seen;
}

/** Every console line and page error of the test, to prove the token is never printed. */
function watchConsole(page: Page): string[] {
  const lines: string[] = [];
  page.on('console', (m) => lines.push(m.text()));
  page.on('pageerror', (e) => lines.push(e.message));
  return lines;
}

const tab = (page: Page, name: string): Promise<void> => page.getByRole('tab', { name }).click();
const status = (page: Page) => page.getByTestId('backup-status');

async function setToken(page: Page, token: string): Promise<void> {
  await tab(page, 'Настройки');
  const input = page.locator('#github-token');
  await expect(input).toHaveAttribute('type', 'password');
  await expect(input).toHaveAttribute('autocomplete', 'off');
  await input.fill(token);
  await page.locator('[data-action="token-save"]').click();
  await expect(page.getByTestId('token-state')).toHaveText('Ключ сохранён'); // said once (stage 7, A14)
  await expect(page.getByTestId('token-msg')).toHaveText('');
  await expect(input).toHaveValue(''); // the value is never echoed
}

async function addTyped(page: Page, phrase: string): Promise<void> {
  await tab(page, 'Новое');
  await page.locator('#new-text').fill(phrase);
  await page.locator('[data-action="parse"]').click();
  await expect(page.locator('#new-text')).toHaveValue(''); // saved at once: no card, no «Сохранить»
  await expect(page.getByTestId('saved')).toBeVisible();
}

const mainJson = (repo: FakeRepo): { records: { raw_text: string }[]; wallets: unknown[] } =>
  JSON.parse(repo.files.get(MAIN) ?? '{"records":[],"wallets":[]}') as { records: { raw_text: string }[]; wallets: unknown[] };

/** The token must not be in the console, in any request URL, or in any request body (it only goes in the header). */
function expectNoLeak(console_: string[], seen: Seen): void {
  expect(seen.pageRequests).toBe(seen.handled);
  for (const l of console_) {
    expect(l).not.toContain(FAKE_TOKEN);
    expect(l).not.toContain('github_pat');
  }
  for (const u of seen.urls) expect(u).not.toContain(FAKE_TOKEN);
  for (const b of seen.bodies) {
    expect(b).not.toContain(FAKE_TOKEN);
    expect(b).not.toContain('github_pat');
  }
}

const shot = (page: Page, info: TestInfo, name: string): Promise<Buffer> =>
  page.screenshot({ path: `test-results/shots/${name}-${info.project.name}.png` });

test('token -> save a record -> «последняя копия»; the repo has the record and NOT the token', async ({ page }, info) => {
  const repo = new FakeRepo(OWNER, 'pocket-brain-data');
  const seen = await mockGithub(page, repo);
  const log = watchConsole(page);
  await page.goto('./');
  await setToken(page, FAKE_TOKEN);
  await addTyped(page, REMINDER);
  await expect.poll(() => mainJson(repo).records.map((r) => r.raw_text)).toContain(REMINDER);
  await tab(page, 'Настройки');
  await expect(status(page)).toContainText('Последняя копия');
  await expect(status(page)).toContainText('МСК');
  expect(mainJson(repo).wallets.length).toBeGreaterThan(0);
  for (const text of repo.files.values()) {
    expect(text).not.toContain(FAKE_TOKEN);
    expect(text).not.toContain('github_pat');
  }
  await expect(page.getByTestId('token-state')).toHaveText('Ключ сохранён');
  await expect(page.getByTestId('no-backup')).toBeHidden();
  await shot(page, info, 'settings');
  expectNoLeak(log, seen);
});

test('409 on the first PUT -> retried with a fresh sha -> success', async ({ page }) => {
  const repo = new FakeRepo(OWNER, 'pocket-brain-data');
  const seen = await mockGithub(page, repo);
  const log = watchConsole(page);
  await page.goto('./');
  await setToken(page, FAKE_TOKEN);
  await expect.poll(() => repo.files.has(MAIN)).toBe(true);
  repo.failures.push({ method: 'PUT', status: 409 });
  repo.log.length = 0;
  await addTyped(page, REMINDER);
  await expect.poll(() => mainJson(repo).records.map((r) => r.raw_text)).toContain(REMINDER);
  expect(repo.failures).toHaveLength(0); // the 409 was really served
  const seq = repo.log.map((l) => l.method).join(',');
  expect(seq).toContain('GET,PUT,GET,PUT'); // 409, then a fresh sha, then the retry
  await tab(page, 'Настройки');
  await expect(status(page)).toContainText('Последняя копия');
  expectNoLeak(log, seen);
});

test('401 -> «ключ доступа не подходит или истёк», the record is still saved; «Удалить ключ» clears that old error', async ({ page }) => {
  const repo = new FakeRepo(OWNER, 'pocket-brain-data', 'github_pat_SOMETHING_ELSE_FAKE');
  const seen = await mockGithub(page, repo);
  const log = watchConsole(page);
  await page.goto('./');
  await setToken(page, FAKE_TOKEN);
  await addTyped(page, REMINDER);
  await tab(page, 'Настройки');
  await expect(status(page)).toHaveText('Не получилось сделать копию: ключ доступа не подходит или истёк');
  await expect(page.getByTestId('no-backup')).toHaveText('Копии нет — записи только на этом телефоне');
  await page.locator('[data-action="token-clear"]').click();
  await expect(page.getByTestId('token-state')).toHaveText('Ключа нет');
  await expect(status(page)).toHaveText('Копия не делается: нужен ключ доступа — шаги ниже.');
  await tab(page, 'Дела');
  await expect(page.locator('#screen-todo').getByText('позвонить маме').first()).toBeVisible();
  expectNoLeak(log, seen);
});

test('offline -> saving works, status «нет интернета»', async ({ page, context }) => {
  const repo = new FakeRepo(OWNER, 'pocket-brain-data');
  const seen = await mockGithub(page, repo);
  const log = watchConsole(page);
  await page.goto('./');
  await setToken(page, FAKE_TOKEN);
  await expect.poll(() => repo.files.has(MAIN)).toBe(true);
  await context.setOffline(true);
  await addTyped(page, REMINDER);
  await tab(page, 'Настройки');
  await expect(status(page)).toHaveText('Не получилось сделать копию: нет интернета');
  await tab(page, 'Дела');
  await expect(page.locator('#screen-todo').getByText('позвонить маме').first()).toBeVisible();
  expectNoLeak(log, seen);
  await context.setOffline(false);
});

const BACKUP_FILE = JSON.stringify({
  format: 'pocket-brain',
  version: 1,
  exported_utc: '2026-10-23T10:00:00.000Z',
  wallets: [{ id: 'cash', name: 'Наличные', hidden: false, start_balance_minor: 150000 }],
  settings: {},
  records: [
    { id: 'r1', kind: 'idea', raw_text: 'идея про велосипед', fields: { title: 'идея про велосипед' }, wallet_id: null, due_utc: null, created_utc: '2026-10-20T08:00:00.000Z', updated_utc: '2026-10-20T08:00:00.000Z', deleted: false },
    { id: 'r2', kind: 'idea', raw_text: 'идея про огород', fields: { title: 'идея про огород' }, wallet_id: null, due_utc: null, created_utc: '2026-10-21T08:00:00.000Z', updated_utc: '2026-10-21T08:00:00.000Z', deleted: false },
  ],
});

test('restore: pre-filled repo -> «Найдено 2 записи» -> confirm -> records appear; cancel changes nothing', async ({ page }) => {
  const repo = new FakeRepo(OWNER, 'pocket-brain-data');
  repo.files.set(MAIN, BACKUP_FILE);
  const seen = await mockGithub(page, repo);
  const log = watchConsole(page);
  await page.goto('./');
  await setToken(page, FAKE_TOKEN);
  // A new phone must not overwrite the existing copy: the status tells to restore, the repo file stays as it was.
  await tab(page, 'Настройки');
  await expect(status(page)).toContainText('Восстановить из GitHub');
  expect(repo.files.get(MAIN)).toBe(BACKUP_FILE);
  await page.locator('[data-action="restore"]').click();
  await expect(page.getByTestId('restore-found')).toHaveText('Найдено 2 записи, восстановить?');
  // cancel first: nothing is written
  await page.locator('[data-action="restore-cancel"]').click();
  await expect(page.getByTestId('restore-found')).toHaveCount(0);
  await tab(page, 'Мысли');
  await expect(page.getByText('идея про велосипед')).toHaveCount(0);
  // again, confirm
  await tab(page, 'Настройки');
  await page.locator('[data-action="restore"]').click();
  await expect(page.getByTestId('restore-found')).toBeVisible();
  await page.locator('[data-action="restore-confirm"]').click();
  await expect(page.getByTestId('restore-msg')).toContainText('Восстановлено');
  await tab(page, 'Мысли');
  await expect(page.getByText('идея про велосипед')).toBeVisible();
  await expect(page.getByText('идея про огород')).toBeVisible();
  expectNoLeak(log, seen);
});

test('restore from an empty repo says there is no copy', async ({ page }) => {
  const repo = new FakeRepo(OWNER, 'pocket-brain-data');
  await mockGithub(page, repo);
  await page.goto('./');
  await setToken(page, FAKE_TOKEN);
  await expect.poll(() => repo.files.has(MAIN)).toBe(true); // the app's own first backup
  repo.files.clear(); // ... now the repo is empty again
  await page.locator('[data-action="restore"]').click();
  await expect(page.getByTestId('restore-msg')).toContainText('в GitHub пока нет копии');
});

test('export (download path): the file has the record and no token', async ({ page }) => {
  const repo = new FakeRepo(OWNER, 'pocket-brain-data');
  const seen = await mockGithub(page, repo);
  const log = watchConsole(page);
  // Force the download path whatever the browser can share.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true });
  });
  await page.goto('./');
  await setToken(page, FAKE_TOKEN);
  await addTyped(page, IDEA);
  await tab(page, 'Настройки');
  const downloadPromise = page.waitForEvent('download');
  await page.locator('[data-action="export"]').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^pocket-brain-export-\d{4}-\d{2}-\d{2}\.json$/);
  const path = await download.path();
  const { readFileSync } = await import('node:fs');
  const text = readFileSync(path, 'utf8');
  expect(text).toContain(IDEA);
  expect(text).not.toContain(FAKE_TOKEN);
  expect(text).not.toContain('github_pat');
  expect((JSON.parse(text) as { format: string }).format).toBe('pocket-brain');
  expectNoLeak(log, seen);
});

test('export (share path): navigator.share gets one JSON file without the token', async ({ page }) => {
  const repo = new FakeRepo(OWNER, 'pocket-brain-data');
  await mockGithub(page, repo);
  await page.addInitScript(() => {
    const w = window as unknown as { __shared?: { name: string; text: string }[] };
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data: { files?: File[] }) => {
        w.__shared = await Promise.all((data.files ?? []).map(async (f) => ({ name: f.name, text: await f.text() })));
      },
    });
  });
  await page.goto('./');
  await setToken(page, FAKE_TOKEN);
  await addTyped(page, IDEA);
  await tab(page, 'Настройки');
  await page.locator('[data-action="export"]').click();
  await expect(page.getByTestId('export-msg')).toHaveText('Файл отправлен');
  const shared = await page.evaluate(() => (window as unknown as { __shared?: { name: string; text: string }[] }).__shared);
  expect(shared).toHaveLength(1);
  expect(shared![0].name).toMatch(/^pocket-brain-export-.*\.json$/);
  expect(shared![0].text).toContain(IDEA);
  expect(shared![0].text).not.toContain(FAKE_TOKEN);
});

test('«Удалить ключ»: no more backups, status says so', async ({ page }) => {
  const repo = new FakeRepo(OWNER, 'pocket-brain-data');
  await mockGithub(page, repo);
  await page.goto('./');
  await setToken(page, FAKE_TOKEN);
  await expect.poll(() => repo.files.has(MAIN)).toBe(true);
  await page.locator('[data-action="token-clear"]').click();
  await expect(page.getByTestId('token-state')).toHaveText('Ключа нет');
  repo.log.length = 0;
  await addTyped(page, IDEA);
  await tab(page, 'Настройки');
  await expect(status(page)).toHaveText('Копия не делается: нужен ключ доступа — шаги ниже.');
  expect(repo.log).toHaveLength(0);
});
