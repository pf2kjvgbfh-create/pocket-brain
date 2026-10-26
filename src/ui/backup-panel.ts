// «Настройки» → «Резервная копия в интернете» (status, a red line while there is no copy, restore, export) and
// «Ключ доступа» (numbered steps, the pre-filled GitHub link, the key field). Plain words (stage 7, B5).
import { buildExport, deliverExport } from '../backup/export';
import { BackupError, createGithubClient, messageFor } from '../backup/github';
import { applyMerge, loadRemote, mergeBackup } from '../backup/restore';
import { HASHES_KEY, type BackupController, type BackupStatus } from '../backup/runner';
import { checkToken, clearToken, hasToken, readToken, saveToken } from '../backup/token';
import { TOKEN_PAGE_URL } from '../config';
import type { App } from './app';
import { h, timeEl } from './dom';

/** 1 запись, 2 записи, 5 записей. */
export function recordsWord(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return `${n} запись`;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return `${n} записи`;
  return `${n} записей`;
}

function errorText(err: unknown): string {
  if (err instanceof BackupError) return messageFor(err.kind);
  if (err instanceof Error && err.message) return err.message;
  return 'не получилось';
}

/** The steps under «Ключ доступа»; GitHub's own button names are kept in English, as the owner sees them there. */
const KEY_STEPS: readonly string[] = [
  'Нажми «Открыть страницу GitHub» ниже и войди в GitHub. Название и срок (1 год) уже заполнены.',
  'Выбери: «Repository access» → «Only select repositories» → «pocket-brain-data».',
  'Проверь, что у «Contents» стоит «Read and write» (ссылка выбирает это сама).',
  'Нажми «Generate token» внизу и скопируй ключ.',
  'Вернись сюда, вставь ключ в поле и нажми «Сохранить».',
];

/** No-key status from the runner: said as a next step, not as an error. */
const NO_KEY = 'ключ доступа не введён';

export function renderBackupPanel(app: App, backup: BackupController, doFetch: typeof fetch = (...a) => fetch(...a)): HTMLElement {
  const noBackup = h('p', { class: 'error', 'data-testid': 'no-backup' }, 'Копии нет — записи только на этом телефоне');
  const status = h('p', { class: 'backup-status', role: 'status', 'data-testid': 'backup-status' });
  const tokenState = h('p', { class: 'hint', 'data-testid': 'token-state' });
  const tokenMsg = h('p', { class: 'hint', role: 'status', 'data-testid': 'token-msg' });
  const restoreMsg = h('p', { class: 'hint', role: 'status', 'data-testid': 'restore-msg' });
  const confirmBox = h('div', { 'data-testid': 'restore-confirm' });
  const exportMsg = h('p', { class: 'hint', role: 'status', 'data-testid': 'export-msg' });

  const paintStatus = (s: BackupStatus): void => {
    noBackup.hidden = s.lastOkUtc !== null;
    if (s.running) status.replaceChildren('Копирую…');
    else if (s.error === NO_KEY) status.replaceChildren('Копия не делается: нужен ключ доступа — шаги ниже.');
    else if (s.error) status.replaceChildren(`Не получилось сделать копию: ${s.error}`);
    else if (s.lastOkUtc) status.replaceChildren('Последняя копия: ', timeEl(s.lastOkUtc, app.now()));
    else status.replaceChildren();
  };
  paintStatus(backup.getStatus());
  backup.subscribe(paintStatus);
  void backup.ready.then(() => paintStatus(backup.getStatus()));

  const paintTokenState = async (): Promise<void> => {
    tokenState.textContent = (await hasToken(app.db)) ? 'Ключ сохранён' : 'Ключа нет';
  };
  void paintTokenState();

  // ---- token ----
  const input = h('input', { type: 'password', autocomplete: 'off', id: 'github-token', 'data-field': 'github-token', spellcheck: 'false', autocapitalize: 'off' });
  const save = h('button', { type: 'button', class: 'btn primary', 'data-action': 'token-save' }, 'Сохранить');
  save.addEventListener('click', () => {
    const check = checkToken(input.value);
    input.value = ''; // never keep (or echo) the value in the page
    if (!check.ok) {
      tokenMsg.textContent = check.reason;
      return;
    }
    void saveToken(app.db, check.token)
      .then(() => app.db.setSetting(HASHES_KEY, {}))
      .then(async () => {
        tokenMsg.textContent = ''; // «Ключ сохранён» above says it once
        await paintTokenState();
        backup.trigger();
      })
      .catch(() => {
        tokenMsg.textContent = 'Не удалось сохранить ключ на этом телефоне';
      });
  });
  const remove = h('button', { type: 'button', class: 'btn danger', 'data-action': 'token-clear' }, 'Удалить ключ');
  remove.addEventListener('click', () => {
    void clearToken(app.db).then(async () => {
      input.value = '';
      tokenMsg.textContent = '';
      await paintTokenState();
      backup.trigger(); // the status says «нужен ключ», not an old error of the removed key
    });
  });

  // ---- restore ----
  const restore = h('button', { type: 'button', class: 'btn', 'data-action': 'restore' }, 'Восстановить из GitHub');
  restore.addEventListener('click', () => {
    confirmBox.replaceChildren();
    restoreMsg.textContent = 'читаю копию…';
    void (async () => {
      const token = await readToken(app.db);
      if (!token) {
        restoreMsg.textContent = 'Сначала сохрани ключ доступа';
        return;
      }
      try {
        const remote = await loadRemote(createGithubClient({ token, fetch: doFetch }));
        const merged = mergeBackup({ records: await app.db.listAllRecords(), wallets: await app.db.listWallets() }, remote);
        restoreMsg.textContent = '';
        const yes = h('button', { type: 'button', class: 'btn primary', 'data-action': 'restore-confirm' }, 'Восстановить');
        const no = h('button', { type: 'button', class: 'btn', 'data-action': 'restore-cancel' }, 'Отмена');
        no.addEventListener('click', () => confirmBox.replaceChildren());
        yes.addEventListener('click', () => {
          confirmBox.replaceChildren();
          void applyMerge(app.db, merged).then(
            async () => {
              await app.refresh();
              restoreMsg.textContent = `Восстановлено: ${recordsWord(merged.liveCount)}`;
            },
            () => {
              restoreMsg.textContent = 'не удалось записать восстановленное на этом устройстве';
            },
          );
        });
        confirmBox.replaceChildren(
          h('p', { class: 'notice', role: 'status', 'data-testid': 'restore-found' }, `Найдено ${recordsWord(merged.liveCount)}, восстановить?`),
          h('div', { class: 'actions' }, yes, no),
        );
      } catch (err) {
        restoreMsg.textContent = `Не получилось: ${errorText(err)}`;
      }
    })();
  });

  // ---- export ----
  const exp = h('button', { type: 'button', class: 'btn', 'data-action': 'export' }, 'Экспорт в Файлы');
  exp.addEventListener('click', () => {
    exportMsg.textContent = '';
    void buildExport(app.db, app.now())
      .then(deliverExport)
      .then((r) => {
        exportMsg.textContent = r === 'shared' ? 'Файл отправлен' : r === 'downloaded' ? 'Файл скачан' : '';
      })
      .catch(() => {
        exportMsg.textContent = 'не получилось сделать файл';
      });
  });

  const keyPage = h(
    'a',
    { class: 'btn', href: TOKEN_PAGE_URL, target: '_blank', rel: 'noopener noreferrer', 'data-action': 'token-page' },
    'Открыть страницу GitHub',
  );
  return h(
    'section',
    { class: 'backup', 'data-testid': 'backup' },
    h('h2', {}, 'Резервная копия в интернете'),
    h('p', { class: 'hint' }, 'Каждая запись сама копируется в твой закрытый репозиторий на GitHub. Телефон потерялся — всё восстановится.'),
    noBackup,
    status,
    h('div', { class: 'actions' }, restore, exp),
    restoreMsg,
    confirmBox,
    exportMsg,
    h('h2', {}, 'Ключ доступа'),
    tokenState,
    h('ol', { class: 'steps', 'data-testid': 'key-steps' }, ...KEY_STEPS.map((t) => h('li', {}, t))),
    keyPage,
    h('label', { class: 'row-field', for: 'github-token' }, h('span', { class: 'lbl' }, 'Ключ доступа (токен GitHub)'), input),
    h('p', { class: 'hint small' }, 'Ключ хранится только на этом телефоне и открывает только репозиторий с копией.'),
    h('div', { class: 'actions' }, save, remove),
    tokenMsg,
  );
}
