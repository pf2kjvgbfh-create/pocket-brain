# CHANGE 2026-10-24 — no confirmation, autosave, local AI as fallback (owner decision)

Owner feedback (verbatim gist): "the «Понял так» confirm card and choosing a wallet is inconvenient; everything must be automatic; make it smarter, add local AI used only when needed, must work ideally; want the app as an icon on the home screen."

Do this as its own stage **2b**, AFTER stage 4 is committed and BEFORE stage 5. Tests first. You update ACCEPTANCE.md, SETUP.md, HANDOFF.md, CLAUDE.md yourself.

## New invariant (add to CLAUDE.md + ACCEPTANCE.md)
**NO CONFIRMATION CARDS.** A phrase from `#t=` (or typed) is saved immediately. The owner never has to pick kind/wallet/date before saving.

## 1. Autosave + undo
- On load with `#t=`: parse → save at once → bottom toast for ~5 s: «Записал: расход 500 ₽, Золотая карта» + «Отменить» (undo deletes the record) + «Изменить» (opens the record editor). Editing is always possible later from the lists.
- Typed text: same flow on Enter / «Готово».

## 2. Wallet when not named
- Use the **last used wallet** (stored in settings, updated on each save that names a wallet or after manual edit). First ever default: «Наличные».

## 3. Corrections memory (cheap smartness, no AI)
- When the owner edits a record's kind or wallet, remember the mapping for its key words (e.g. "кофе" → Золотая карта; "яндекс" → subscription) in a `learned` store; the parser consults it first. Unit-tested.

## 4. Reminder goes to «Напоминания» by itself
- After the undo window closes (5 s, not cancelled) the page opens `shortcuts://run-shortcut?name=Мозг-напомнить…` automatically. Keep the «Поставить напоминание» button as fallback (if Safari blocks the automatic open or the owner left the page). CHECK ON PHONE: whether Safari opens it without a tap.
- Reminder title must include Moscow time: «позвонить маме — 14:00 МСК». The `due` stays with `+03:00`, so iPhone «Напоминания» shows the phone's local time (e.g. 07:00) and rings at the right moment = 14:00 MSK.
- Test across DST: owner's phone is America/New_York-like (EDT now, EST from 2026-11-01). Created 2026-10-30, «напомни 5 ноября в 19:00» → `due` 2026-11-05T19:00+03:00, `due_local` 11:00 (not 12:00). No hard-coded hour offsets anywhere.

## 5. Local AI as fallback only
- Parser returns a confidence (e.g. kind unknown, amount missing for money words, date words not resolved). High confidence → rules only, instant.
- Low confidence → save at once as «мысль» marked «уточняю…»; the local model (stage 5) re-sorts it in the background and updates the record + a toast «Уточнил: …». If it becomes a reminder after the owner left the page, it shows in «Дела» with the «Поставить напоминание» button (state this limitation in HANDOFF).
- Model loads only on Wi-Fi in the background, never blocks saving. Measure SEPARATELY and record in STATUS: first download time, load-from-cache time, tokens/s, time to classify one phrase. If load-from-cache > ~20 s on the laptop, say so plainly in the report: the fallback then only helps when the app stays open.

## 6. Icon on the Home Screen (same data as the Shortcut)
- The Shortcut opens a Safari tab; an installed «web app» has SEPARATE empty storage. So SETUP must say: Safari → Share → «На экран Домой» → switch **«Открыть как веб-приложение» OFF** → «Добавить». Fallback if that toggle still opens a separate app: a Shortcut «Открыть Мозг» (one action «Открыть URL» with the link) added to the Home Screen. CHECK ON PHONE: the icon shows the same records as voice input.
- Remove/ignore the test-page text «запусти с иконки Домой».

## Done when
Unit tests (autosave, last wallet, corrections memory, confidence, MSK title, DST case) green; live link: open `#t=купил воду за 500` → record saved without any tap, toast visible, «Деньги» updated; `#t=напомни завтра в 19:00 позвонить маме` → after 5 s an attempt to open `shortcuts://` with title containing «19:00 МСК»; WebKit + Chromium 375 px; commit `stage 2b: autosave…`; STATUS updated.
