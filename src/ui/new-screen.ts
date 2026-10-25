// «Новое»: typed or dictated text (also the `#t=` link) is SAVED AT ONCE (no confirmation card). A bottom toast
// offers «Отменить» / «Изменить» for UNDO_MS; a reminder then opens in «Напоминания» by itself.
import { LAST_WALLET_KEY, LEARNED_KEY, TOAST_SHORT_MS, UNDO_MS } from '../config';
import type { DraftRow, Kind, RecordRow } from '../db/types';
import { sanitizeLearned } from '../parser/learned';
import { buildPayload, buildShortcutUrl } from '../shortcut/payload';
import { closeAllSheets, editRecord, type App } from './app';
import { buildAutoRecord } from './autosave';
import { alreadySentence, savedSentence } from './card-model';
import { h } from './dom';
import { intakeText } from './intake';
import { openShortcut, remindBlock } from './remind';
import { dismissToast, showToast } from './toast';

/** What «the last wallet» was before this phrase named another one, so «Отменить» can put it back. */
type WalletBefore = { changed: false } | { changed: true; value: string | undefined };
const UNCHANGED: WalletBefore = { changed: false };

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
  /** Text from the link (dedupe on) or from the box (dedupe off): saved at once. */
  openText: (text: string, fromLink: boolean) => Promise<void>;
  /** After a reload: save the drafts a killed page left behind (no automatic reminder). */
  restoreDraft: () => Promise<void>;
}

export function createNewScreen(app: App, root: HTMLElement): NewScreen {
  /** Id of the record the «done» state shows, so a late edit does not redraw a screen that moved on. */
  let shownId: string | null = null;
  /** Calls run one after another, so two quick events never race. */
  let queue: Promise<void> = Promise.resolve();

  const enqueue = (job: () => Promise<void>): Promise<void> => {
    queue = queue.then(job, job);
    return queue;
  };

  /** A newer phrase cancels the pending toast (and with it the automatic reminder) at once, before anything is awaited. */
  const submit = (text: string, fromLink: boolean): Promise<void> => {
    dismissToast();
    return enqueue(() => open(text, fromLink));
  };

  const showIdle = (prefill = '', problem = ''): void => {
    shownId = null;
    const area = h('textarea', {
      id: 'new-text', rows: '4', placeholder: 'Например: напомни завтра в 19:00 позвонить маме', autocomplete: 'off', enterkeyhint: 'done',
    });
    area.value = prefill;
    const go = h('button', { type: 'button', class: 'btn primary', 'data-action': 'parse' }, 'Записать');
    const send = (): void => {
      const text = area.value.trim();
      if (!text || go.disabled) return;
      // Locked at once: a second tap or Enter while saving must not write the phrase twice.
      go.disabled = true;
      area.readOnly = true;
      void submit(text, false);
    };
    go.addEventListener('click', send);
    area.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
      e.preventDefault();
      send();
    });
    root.replaceChildren(
      h('h1', {}, 'Новое'),
      h('label', { for: 'new-text', class: 'hint' }, 'Скажи или напиши, что запомнить'),
      area,
      ...(problem ? [h('p', { class: 'error', role: 'alert' }, problem)] : []),
      go,
    );
  };

  const showDone = (rec: RecordRow, sentence: string): void => {
    shownId = rec.id;
    const where = TAB_OF_KIND[rec.kind];
    const open = h('button', { type: 'button', class: 'btn', 'data-action': 'goto' }, `Показать в «${where.name}»`);
    open.addEventListener('click', () => app.showTab(where.tab));
    const again = h('button', { type: 'button', class: 'btn primary', 'data-action': 'again' }, 'Новая запись');
    again.addEventListener('click', () => showIdle());
    root.replaceChildren(
      h('h1', {}, 'Новое'),
      h('p', { class: 'notice', 'data-testid': 'saved' }, sentence),
      ...[remindBlock(rec, app.now())].filter((el): el is HTMLElement => el !== null),
      h('div', { class: 'actions' }, again, open),
    );
  };

  const edit = (rec: RecordRow): void => {
    editRecord(app, rec, (changed) => {
      if (shownId !== rec.id) return;
      if (changed) showDone(changed, savedSentence(changed, app.wallets, app.now()));
      else showIdle();
    });
  };

  /**
   * «Отменить»: the record goes away and the wallet it named stops being «the last one». The text comes back into
   * the box (it is never lost) — unless the owner has already started typing something else there.
   */
  const undo = async (rec: RecordRow, walletBefore: WalletBefore): Promise<void> => {
    await app.db.softDelete(rec.id, app.now().toISOString());
    if (walletBefore.changed) await app.db.setSetting(LAST_WALLET_KEY, walletBefore.value);
    await app.refresh();
    const box = root.querySelector<HTMLTextAreaElement>('#new-text');
    if (shownId === rec.id || !box || box.value.trim() === '') showIdle(rec.raw_text);
    showToast({ text: 'Отменено', ms: TOAST_SHORT_MS });
  };

  /** The reminder opens by itself only if the record is still there exactly as saved (not undone, not edited meanwhile). */
  const autoOpenShortcut = async (rec: RecordRow): Promise<void> => {
    const fresh = await app.db.getRecord(rec.id);
    if (!fresh || fresh.deleted || fresh.updated_utc !== rec.updated_utc) return;
    const payload = buildPayload(fresh, app.now());
    if (payload) openShortcut(buildShortcutUrl(payload));
  };

  const present = (rec: RecordRow, autoOpen: boolean, walletBefore: WalletBefore = UNCHANGED): void => {
    showDone(rec, savedSentence(rec, app.wallets, app.now()));
    showToast({
      text: savedSentence(rec, app.wallets, app.now()),
      ms: UNDO_MS,
      actions: [
        { label: 'Отменить', action: 'undo', run: () => void undo(rec, walletBefore) },
        { label: 'Изменить', action: 'edit', run: () => edit(rec) },
      ],
      onExpire: autoOpen && buildPayload(rec, app.now()) ? () => void autoOpenShortcut(rec) : undefined,
    });
  };

  /** The same link again: nothing new is written, nothing opens by itself. */
  const presentAlready = (rec: RecordRow): void => {
    showDone(rec, alreadySentence(rec, app.wallets, app.now()));
    showToast({
      text: alreadySentence(rec, app.wallets, app.now()),
      ms: UNDO_MS,
      actions: [{ label: 'Изменить', action: 'edit', run: () => edit(rec) }],
    });
  };

  /** Draft -> record. Settings first (the record write triggers the backup), then ONE transaction: record + draft removal. */
  async function saveDraft(draft: DraftRow): Promise<{ record: RecordRow; walletBefore: WalletBefore }> {
    const [last, learned] = await Promise.all([app.db.getSetting<string>(LAST_WALLET_KEY), app.db.getSetting<unknown>(LEARNED_KEY)]);
    const { record, namedWalletId } = buildAutoRecord({
      draft, wallets: app.wallets, lastWalletId: last, learned: sanitizeLearned(learned), now: app.now(),
    });
    const walletBefore: WalletBefore = namedWalletId && namedWalletId !== last ? { changed: true, value: last } : UNCHANGED;
    if (walletBefore.changed) await app.db.setSetting(LAST_WALLET_KEY, namedWalletId);
    await app.db.saveFromDraft(record, draft.id);
    return { record, walletBefore };
  }

  async function open(text: string, fromLink: boolean): Promise<void> {
    closeAllSheets();
    app.showTab('new');
    let saved: Awaited<ReturnType<typeof saveDraft>>;
    let draftId: string | null = null;
    try {
      const result = await intakeText(app.db, text, app.now(), { dedupe: fromLink });
      if (result.type === 'saved') {
        presentAlready(result.record);
        return;
      }
      draftId = result.draft.id;
      saved = await saveDraft(result.draft);
    } catch (err) {
      console.error('autosave failed', err instanceof Error ? err.name : 'error');
      // The text stays in the box; its draft goes, so a retry (or the next start) does not write it twice.
      if (draftId) await app.db.deleteDraft(draftId).catch(() => undefined);
      showIdle(text, 'Не получилось записать. Текст сохранён здесь — нажми «Записать» ещё раз.');
      return;
    }
    // Saved: whatever fails from here on must not invite a second save of the same phrase.
    await app.refresh().catch((err: unknown) => console.error('refresh failed', err instanceof Error ? err.name : 'error'));
    present(saved.record, true, saved.walletBefore);
  }

  async function restore(): Promise<void> {
    const drafts = (await app.db.listDrafts()).reverse(); // oldest first
    let last: RecordRow | null = null;
    for (const draft of drafts) {
      try {
        last = (await saveDraft(draft)).record;
      } catch (err) {
        console.error('draft restore failed', err instanceof Error ? err.name : 'error');
      }
    }
    if (!last) return;
    await app.refresh();
    present(last, false);
  }

  showIdle();
  return {
    openText: (text, fromLink) => submit(text, fromLink),
    restoreDraft: () => enqueue(restore),
  };
}
