// «Новое»: typed or dictated text -> instant card -> save. Also receives the text of the `#t=` link.
import { walletRefs } from '../db/wallets';
import type { DraftRow, Kind, RecordRow } from '../db/types';
import { parse } from '../parser/index';
import { closeAllSheets, type App } from './app';
import { renderCard } from './card';
import { KIND_LABEL, stateFromParse, stateFromRecord } from './card-model';
import { h } from './dom';
import { intakeText } from './intake';
import { remindBlock } from './remind';

const TAB_OF_KIND: Record<Kind, { tab: string; name: string }> = {
  reminder: { tab: 'todo', name: 'Дела' },
  subscription: { tab: 'todo', name: 'Дела' },
  expense: { tab: 'money', name: 'Деньги' },
  income: { tab: 'money', name: 'Деньги' },
  transfer: { tab: 'money', name: 'Деньги' },
  held: { tab: 'money', name: 'Деньги' },
  deposit: { tab: 'money', name: 'Деньги' },
  idea: { tab: 'ideas', name: 'Мысли' },
};

export interface NewScreen {
  /** Text from the link (dedupe on) or from the box (dedupe off). */
  openText: (text: string, fromLink: boolean) => Promise<void>;
  /** After a reload: show the newest unsaved draft, if any. */
  restoreDraft: () => Promise<void>;
}

export function createNewScreen(app: App, root: HTMLElement): NewScreen {
  /** The unsaved draft currently shown on the card, if any. */
  let current: DraftRow | null = null;
  /** Calls run one after another, so two quick events never race. */
  let queue: Promise<void> = Promise.resolve();

  const showIdle = (): void => {
    current = null;
    const area = h('textarea', { id: 'new-text', rows: '4', placeholder: 'Например: напомни завтра в 19:00 позвонить маме', autocomplete: 'off' });
    const go = h('button', { type: 'button', class: 'btn primary', 'data-action': 'parse' }, 'Разобрать');
    go.addEventListener('click', () => {
      const text = area.value.trim();
      if (text) void enqueue(() => open(text, false));
    });
    root.replaceChildren(h('h1', {}, 'Новое'), h('label', { for: 'new-text', class: 'hint' }, 'Скажи или напиши, что запомнить'), area, go);
  };

  const showDone = (rec: RecordRow): void => {
    current = null;
    const where = TAB_OF_KIND[rec.kind];
    const open = h('button', { type: 'button', class: 'btn', 'data-action': 'goto' }, `Показать в «${where.name}»`);
    open.addEventListener('click', () => app.showTab(where.tab));
    const again = h('button', { type: 'button', class: 'btn primary', 'data-action': 'again' }, 'Новая запись');
    again.addEventListener('click', showIdle);
    root.replaceChildren(
      h('h1', {}, 'Новое'),
      h('p', { class: 'notice', role: 'status', 'data-testid': 'saved' }, `Сохранено: ${KIND_LABEL[rec.kind].toLowerCase()}`),
      ...[remindBlock(rec, app.now())].filter((el): el is HTMLElement => el !== null),
      h('div', { class: 'actions' }, again, open),
    );
  };

  const showDraftCard = (draft: DraftRow): void => {
    current = draft;
    const state = stateFromParse(draft.id, parse(draft.text, new Date(draft.created_utc), walletRefs(app.wallets)), app.wallets);
    root.replaceChildren(
      h('h1', {}, 'Новое'),
      renderCard({
        state,
        wallets: app.wallets,
        now: app.now,
        editing: false,
        onSave: (rec) => {
          void app.db.saveFromDraft(rec, draft.id).then(async () => {
            await app.refresh();
            showDone(rec);
          });
        },
        onCancel: () => {
          void app.db.deleteDraft(draft.id).then(showIdle);
        },
      }),
    );
  };

  const showSaved = (rec: RecordRow): void => {
    current = null;
    root.replaceChildren(
      h('h1', {}, 'Новое'),
      renderCard({
        state: stateFromRecord(rec),
        wallets: app.wallets,
        now: app.now,
        editing: false,
        notice: 'Уже сохранено',
        onSave: (updated) => {
          void app.db.putRecord(updated).then(async () => {
            await app.refresh();
            showDone(updated);
          });
        },
        onCancel: showIdle,
      }),
    );
  };

  async function open(text: string, fromLink: boolean): Promise<void> {
    closeAllSheets();
    app.showTab('new');
    // A typed re-parse replaces the unsaved draft that is still on screen.
    if (!fromLink && current) await app.db.deleteDraft(current.id);
    const result = await intakeText(app.db, text, app.now(), { dedupe: fromLink });
    if (result.type === 'saved') showSaved(result.record);
    else showDraftCard(result.draft);
  }

  const enqueue = (job: () => Promise<void>): Promise<void> => {
    queue = queue.then(job, job);
    return queue;
  };

  showIdle();
  return {
    openText: (text, fromLink) => enqueue(() => open(text, fromLink)),
    restoreDraft: () =>
      enqueue(async () => {
        const [latest] = await app.db.listDrafts();
        if (latest && !current) showDraftCard(latest);
      }),
  };
}
