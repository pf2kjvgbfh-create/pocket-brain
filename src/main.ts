// App entry: opens the database, renders the screens, wires tabs, the `#t=` link and the service worker.
import { PocketDb } from './db/db';
import { sortWallets } from './db/wallets';
import type { App } from './ui/app';
import { extractHashText, installHashListeners } from './ui/intake';
import { renderIdeas, renderTodo } from './ui/lists';
import { renderMoney } from './ui/money-screen';
import { createNewScreen } from './ui/new-screen';
import { renderSettings } from './ui/settings-screen';

const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('.tabbar button'));
const screens = Array.from(document.querySelectorAll<HTMLElement>('.screen'));
const screen = (name: string): HTMLElement => document.getElementById(`screen-${name}`) as HTMLElement;

function showTab(name: string): void {
  for (const s of screens) s.hidden = s.dataset.tab !== name;
  for (const t of tabs) t.setAttribute('aria-selected', String(t.dataset.tab === name));
  window.scrollTo(0, 0);
}

for (const t of tabs) {
  t.addEventListener('click', () => showTab(t.dataset.tab ?? 'new'));
}

async function boot(): Promise<void> {
  let db: PocketDb;
  try {
    db = await PocketDb.open();
  } catch (err) {
    console.error('storage unavailable', err);
    screen('new').textContent = 'Не удалось открыть хранилище на этом устройстве. Закрой другие вкладки приложения и обнови страницу.';
    return;
  }
  const app: App = {
    db,
    wallets: [],
    records: [],
    now: () => new Date(),
    showTab,
    refresh: async () => {
      app.wallets = sortWallets(await db.listWallets());
      app.records = await db.listRecords();
      renderTodo(app, screen('todo'));
      renderMoney(app, screen('money'));
      renderIdeas(app, screen('ideas'));
    },
  };
  await app.refresh();
  renderSettings(screen('settings'));
  const newScreen = createNewScreen(app, screen('new'));
  const hasLink = extractHashText(window.location.hash) !== null;
  installHashListeners((text) => void newScreen.openText(text, true));
  if (!hasLink) await newScreen.restoreDraft();
}

void boot();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  const base = import.meta.env.BASE_URL;
  navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch((err: unknown) => {
    console.warn('service worker registration failed', err);
  });
}
