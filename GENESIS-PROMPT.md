# GENESIS PROMPT — POCKET-BRAIN («Карманный мозг»)

Today is 2026-10-22. You are the executing engineer. Build the product from this prompt and `IMPLEMENTATION-PLAN.md`.
Before starting read `CLAUDE.md`, `IMPLEMENTATION-PLAN.md`, `SETUP.md`, `ACCEPTANCE.md`. Do not ask permission for plan stages; ask only if blocked, in one batch.
Project folder: `C:\Users\Lenovo\Desktop\POCKET-BRAIN` (the pack files are already there). Run `git init` there. Reply to the owner in Russian.

## What we build
A one-page offline web app for one person (iPhone 17 Pro Max, Safari). The owner presses the Action Button, dictates in Russian ("напомни завтра в 19:00 позвонить маме", "купил воду за 500, золотая карта", "Иван отдал мне на хранение 3000, положил под 6,5%", "идея: ..."), the Shortcut «Мозг» opens `https://<gh-login>.github.io/pocket-brain/#t=<text>`. The app understands the text itself, shows a card «Понял так: ...», the owner taps «Сохранить». 5-minute magic: voice → card → saved → reminder set / money total updated. All data lives on the phone (IndexedDB) and is auto-copied to a private GitHub repo. Everything free, no accounts except GitHub.

## Stack (do not change without a line in DECISIONS.md)
TypeScript, Vite, no UI framework, hand-written service worker, IndexedDB (small own wrapper), `chrono-node` (locale `ru`), `@wllama/wllama` 3.8.1 + `@wllama/wllama-compat` (single thread, WASM), `llama-gguf-split`, Vitest, Playwright (WebKit + Chromium), `gh` CLI (already logged in), GitHub Pages. Check every library API through context7 before use; versions as of today.

## Hosting and repos
`gh` creates: PUBLIC repo `pocket-brain` (code + model shards only, Pages from it) and PRIVATE repo `pocket-brain-data` (initialised with a README; backup target). Tell the owner in the final report that the public repo publishes the code (never data). Pages cannot set COOP/COEP headers, so the model must run single-threaded.

## How it looks
Plain, light/dark by system, big text, thumb-reachable. Bottom tabs: «Новое», «Дела», «Деньги», «Мысли», «Настройки». Safe-area padding, no horizontal scroll at 375 px. Times: big in MSK, small local time.

## What the owner can do
1. Opens the link (from the Shortcut) → text is already in the input → card «Понял так» (editable kind, fields, wallet) → «Сохранить».
2. Reminder: «Поставить напоминание» opens `shortcuts://run-shortcut?name=<url-encoded Мозг-напомнить>&input=text&text=<url-encoded JSON>`.
3. Money: wallets (defaults: Наличные, Вклад, Золотая карта, Серебряная карта, Тинькофф — add/rename/hide), expenses/income/transfers, «чужие деньги» (who, how much, rate %), deposits (rate, term), subscriptions (amount, day of month), totals per wallet.
4. Ideas: saved with tags (graph is post-MVP).
5. Settings: GitHub token field, «последняя копия: <время МСК>», «Восстановить из GitHub», «Экспорт в Файлы», model on/off.

## Data
`records(id uuid, kind, raw_text, fields json, wallet_id, due_utc, created_utc, updated_utc, deleted)`, `wallets(id, name, hidden, start_balance_minor)`, `settings(...)`, `drafts(id, text)`. Kinds: reminder, expense, income, transfer, held, deposit, subscription, idea. Money in integer kopecks; time in UTC.

## Invariants (violation = stage not accepted; full list in IMPLEMENTATION-PLAN.md)
1. DO NOT FAKE INTEGRATIONS: no access → stub `TODO:INTEGRATION` + a line in STATUS.
2. NO USER DATA IN THE PUBLIC REPO (tests use invented names/amounts).
3. TOKEN ONLY TYPED BY OWNER; never in code, backup, export, logs, URL or chat.
4. RULES FIRST, MODEL NEVER BLOCKS SAVE.
5. ALL TIMES SHOWN IN MSK (+03:00); stored in UTC.
6. `#t=` READ ONCE, THEN `history.replaceState`; every record has an id (no duplicates).
7. Single-thread wllama compat; the app works fully without the model.

## Tools
context7, Playwright (WebKit + Chromium), `gh`, `llama-gguf-split`. Nothing else; other connectors off.

## How to work
- The owner wants a FINISHED product with minimum manual work: run stages 0→6 of `IMPLEMENTATION-PLAN.md` BACK TO BACK without waiting for him. Give each stage's implementation to a fresh subagent (model per `HANDOFF.md`) with a precise brief; YOU verify its «готово, когда» yourself before moving on. After each stage: commit `stage N: …`, update `STATUS.md`. Ask the owner for «/clear» + «продолжай POCKET-BRAIN» ONLY when the context guard fires or you are blocked.
- Do NOT wait for the phone test (stage 0): build stage 5 anyway, the model stays OFF until the owner taps «Скачать мозг»; when his screenshot arrives, apply the stage-0 decision rule.
- Tests first (parser, payloads, backup logic). Browser checks on WebKit and Chromium at 375 px; screenshots at `scale: 0.5`.
- Say plainly what is verified only on the phone («проверить на телефоне»). There is no iOS emulator.

## Finish only when
the Pages URL opens, works offline after first load, and all ACCEPTANCE items pass on laptop WebKit+Chromium at 375px, with screenshots; every phone-only item is listed as «проверить на телефоне» with exact owner steps.

## Final report (Russian)
The link to open on the iPhone · what you verified (facts, screenshots) · what you could NOT verify and why · the next manual step for the owner from `SETUP.md` · `STATUS.md` updated.
