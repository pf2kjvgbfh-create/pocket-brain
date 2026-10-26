// «Новое»: typed or dictated text (also the `#t=` link) is SAVED AT ONCE (no confirmation card). A bottom toast says
// WHAT was saved and offers «Отменить» / «Изменить» for UNDO_MS; «Последняя запись» stays on top of the screen until
// the next phrase (stage 7, B2). A reminder then opens «Напоминания» by itself after a visible countdown.
import { LAST_WALLET_KEY, LEARNED_KEY, TOAST_SHORT_MS, UNDO_MS } from '../config';
import type { DraftRow, RecordRow } from '../db/types';
import { sanitizeLearned } from '../parser/learned';
import { buildPayload, buildShortcutUrl } from '../shortcut/payload';
import { closeAllSheets, editRecord, type App } from './app';
import { autoOpenLeft, cancelAutoOpen, scheduleAutoOpen } from './auto-open';
import { buildAutoRecords } from './autosave';
import { h } from './dom';
import { intakeText } from './intake';
import { paintCountdown, renderLastCard } from './last-card';
import { openShortcut } from './remind';
import { alreadyText, savedText } from './saved-text';
import { dismissToast, showToast } from './toast';

/** What «the last wallet» was before this phrase named another one, so «Отменить» can put it back. */
type WalletBefore = { changed: false } | { changed: true; value: string | undefined };
const UNCHANGED: WalletBefore = { changed: false };

/** The phrase on the «Последняя запись» card: its record ids (one phrase may give several). */
interface Last {
  ids: string[];
  rawText: string;
  walletBefore: WalletBefore;
}

export interface NewScreen {
  /** Text from the link or from the box: saved at once. `repeat` = the same opening of a link came back (reload). */
  openText: (text: string, fromLink: boolean, repeat?: boolean) => Promise<void>;
  /** After a reload: save the drafts a killed page left behind (no automatic reminder). */
  restoreDraft: () => Promise<void>;
  /** After every refresh: «Последняя запись» follows edits made elsewhere and goes away when its records are deleted. */
  sync: () => void;
}

export function createNewScreen(app: App, root: HTMLElement): NewScreen {
  let last: Last | null = null;
  /** Calls run one after another, so two quick events never race. */
  let queue: Promise<void> = Promise.resolve();
  const lastBox = h('div', { class: 'last-box' });
  const problem = h('p', { class: 'error', role: 'alert' });
  const area = h('textarea', {
    id: 'new-text', rows: '2', placeholder: 'Например: напомни завтра в 19:00 позвонить маме', autocomplete: 'off', enterkeyhint: 'done',
  });
  const go = h('button', { type: 'button', class: 'btn primary', 'data-action': 'parse' }, 'Записать');

  const enqueue = (job: () => Promise<void>): Promise<void> => {
    queue = queue.then(job, job);
    return queue;
  };

  /** A newer phrase cancels the pending toast and the automatic reminder at once, before anything is awaited. */
  const submit = (text: string, fromLink: boolean, repeat = false): Promise<void> => {
    dismissToast();
    cancelAutoOpen();
    return enqueue(() => open(text, fromLink, repeat));
  };

  const unlockBox = (text: string, error = ''): void => {
    go.disabled = false;
    area.readOnly = false;
    area.value = text;
    problem.textContent = error;
  };

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

  const liveRecords = (): RecordRow[] => (last ? last.ids.map((id) => app.records.find((r) => r.id === id)).filter((r): r is RecordRow => !!r) : []);

  const renderLast = (): void => {
    const recs = liveRecords();
    if (recs.length === 0) {
      last = null;
      lastBox.replaceChildren();
      return;
    }
    lastBox.replaceChildren(
      renderLastCard({
        app,
        records: recs,
        countdown: autoOpenLeft(),
        onEdit: (r) => {
          cancelAutoOpen();
          editRecord(app, r);
        },
        onDelete: () => {
          if (last) void remove(last, 'Удалено');
        },
        onRemindTap: cancelAutoOpen,
        onStopAuto: cancelAutoOpen,
      }),
    );
  };

  /**
   * «Отменить» / «Удалить»: the records go away and the wallet the phrase named stops being «the last one». The text
   * comes back into the box (it is never lost) — unless the owner has already started typing something else there.
   */
  const remove = async (phrase: Last, said: string): Promise<void> => {
    cancelAutoOpen();
    dismissToast();
    await app.db.softDeleteMany(phrase.ids, app.now().toISOString());
    if (phrase.walletBefore.changed) await app.db.setSetting(LAST_WALLET_KEY, phrase.walletBefore.value);
    await app.refresh();
    if (area.value.trim() === '' && !area.readOnly) unlockBox(phrase.rawText);
    showToast({ text: said, ms: TOAST_SHORT_MS });
  };

  /** The reminder opens by itself only if the record is still there exactly as saved (not undone, not edited meanwhile). */
  const autoOpenShortcut = async (rec: RecordRow): Promise<void> => {
    const fresh = await app.db.getRecord(rec.id);
    if (!fresh || fresh.deleted || fresh.updated_utc !== rec.updated_utc) return;
    const payload = buildPayload(fresh, app.now());
    if (payload) openShortcut(buildShortcutUrl(payload));
  };

  /**
   * One phrase may give several records («кофе 300 и круассан 250»): one toast, «Отменить» removes them all.
   * Only a dictated reminder opens by itself — never a subscription (DECISIONS stage 7, item 12).
   */
  const present = (recs: RecordRow[], autoOpen: boolean, walletBefore: WalletBefore = UNCHANGED): void => {
    const rec = recs[0];
    const single = recs.length === 1;
    const phrase: Last = { ids: recs.map((r) => r.id), rawText: rec.raw_text, walletBefore };
    last = phrase;
    const edit = (): void => {
      cancelAutoOpen();
      editRecord(app, rec);
    };
    showToast({
      text: savedText(recs, app.wallets, { now: app.now() }),
      ms: UNDO_MS,
      actions: [
        { label: 'Отменить', action: 'undo', run: () => void remove(phrase, 'Отменено') },
        // Several records are edited one by one from «Последняя запись».
        ...(single ? [{ label: 'Изменить', action: 'edit', run: edit }] : []),
      ],
    });
    if (single && autoOpen && rec.kind === 'reminder' && buildPayload(rec, app.now())) {
      scheduleAutoOpen({
        seconds: Math.round(UNDO_MS / 1000),
        onTick: (left) => paintCountdown(lastBox.querySelector('[data-testid="countdown"]'), left),
        onFire: () => void autoOpenShortcut(rec),
      });
    }
    problem.textContent = '';
    renderLast();
  };

  /** The same link again: nothing new is written, nothing opens by itself. */
  const presentAlready = (rec: RecordRow): void => {
    last = { ids: [rec.id], rawText: rec.raw_text, walletBefore: UNCHANGED };
    renderLast();
    showToast({
      text: alreadyText(rec, app.wallets, { now: app.now() }),
      ms: UNDO_MS,
      actions: [{ label: 'Изменить', action: 'edit', run: () => editRecord(app, rec) }],
    });
  };

  /** Draft -> record. Settings first (the record write triggers the backup), then ONE transaction: record + draft removal. */
  async function saveDraft(draft: DraftRow): Promise<{ records: RecordRow[]; walletBefore: WalletBefore }> {
    const [lastId, learned] = await Promise.all([app.db.getSetting<string>(LAST_WALLET_KEY), app.db.getSetting<unknown>(LEARNED_KEY)]);
    const { records, namedWalletId, newWallets } = buildAutoRecords({
      draft, wallets: app.wallets, lastWalletId: lastId, learned: sanitizeLearned(learned), now: app.now(), records: app.records,
    });
    const walletBefore: WalletBefore = namedWalletId && namedWalletId !== lastId ? { changed: true, value: lastId } : UNCHANGED;
    if (walletBefore.changed) await app.db.setSetting(LAST_WALLET_KEY, namedWalletId);
    await app.db.saveManyFromDraft(records, draft.id, newWallets);
    return { records, walletBefore };
  }

  async function open(text: string, fromLink: boolean, repeat: boolean): Promise<void> {
    closeAllSheets();
    app.showTab('new');
    let saved: Awaited<ReturnType<typeof saveDraft>>;
    let draftId: string | null = null;
    try {
      const result = await intakeText(app.db, text, app.now(), { link: fromLink, repeat: fromLink && repeat });
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
      unlockBox(text, 'Не получилось записать. Текст сохранён здесь — нажми «Записать» ещё раз.');
      return;
    }
    // Saved: whatever fails from here on must not invite a second save of the same phrase.
    await app.refresh().catch((err: unknown) => console.error('refresh failed', err instanceof Error ? err.name : 'error'));
    if (!fromLink) unlockBox('');
    present(saved.records, true, saved.walletBefore);
  }

  async function restore(): Promise<void> {
    const drafts = (await app.db.listDrafts()).reverse(); // oldest first
    let lastSaved: RecordRow[] | null = null;
    for (const draft of drafts) {
      try {
        lastSaved = (await saveDraft(draft)).records;
      } catch (err) {
        console.error('draft restore failed', err instanceof Error ? err.name : 'error');
      }
    }
    if (!lastSaved) return;
    await app.refresh();
    present(lastSaved, false);
  }

  root.replaceChildren(
    h('h1', {}, 'Новое'),
    lastBox,
    h('label', { for: 'new-text', class: 'hint' }, 'Скажи или напиши, что запомнить'),
    area,
    problem,
    go,
  );
  return {
    openText: (text, fromLink, repeat) => submit(text, fromLink, repeat),
    restoreDraft: () => enqueue(restore),
    sync: () => {
      if (last) renderLast();
    },
  };
}
