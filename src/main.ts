// App entry: opens the database, renders the screens, wires tabs, the `#t=` link and the service worker.
import { createBackupController } from './backup/runner';
import { PocketDb } from './db/db';
import { sortWallets } from './db/wallets';
import { setupModel, type ModelSetup } from './model/setup';
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
      // After every save or change: records the rules were unsure about go to the local model in the background
      // (only when the owner turned it on; never awaited, so it never holds up saving).
      void model?.refiner.run();
    },
  };
  let model: ModelSetup | undefined;
  await app.refresh();
  model = setupModel(app);
  void model.refiner.run();
  // Backup: fire-and-forget after every committed records/wallets write, on open (online) and when the network comes back.
  const backup = createBackupController({ db, fetch: (...a) => fetch(...a) });
  db.setOnChange(() => backup.trigger());
  window.addEventListener('online', () => backup.trigger());
  if (navigator.onLine) backup.trigger();
  renderSettings(screen('settings'), app, backup, model.panel);
  const newScreen = createNewScreen(app, screen('new'));
  const hasLink = extractHashText(window.location.hash) !== null;
  installHashListeners((text, repeat) => void newScreen.openText(text, true, repeat));
  if (!hasLink) await newScreen.restoreDraft();
}

void boot();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  const base = import.meta.env.BASE_URL;
  navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch((err: unknown) => {
    console.warn('service worker registration failed', err);
  });
}
