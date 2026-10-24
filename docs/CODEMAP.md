# CODEMAP — where things live

Updated: stage 2 (storage + UI).

## App
- `index.html`, `src/main.ts`, `src/style.css`: the app shell (tabs, service worker registration).
- `src/config.ts`: configurable defaults: wallets and their spoken aliases (stems), MSK offset, default hour (12:00 MSK).
- `src/parser/`: the rules parser for dictated Russian. Entry point `parse(text, now, wallets)` in `index.ts`.
  - `normalize.ts`: number words to digits («три тысячи двести» → 3200, «шесть с половиной» → 6,5, «двадцать пятого» → 25-го), «3 000» → 3000, «полтора часа» → 90 минут. `fold()` = lower-case + ё→е, same length.
  - `time.ts`: chrono-node `ru` with reference `{ instant: now, timezone: 180 }`, `forwardDate`; no hour → 12:00 MSK; own regex for «17-го (числа)» and «в 10:00»; `nextDayOfMonth()`. UTC getters on (instant + 3 h) only, never the device zone.
  - `money.ts`: amount → integer kopecks, rate «под 6,5%», term «на 6 месяцев / год / полгода».
  - `wallets.ts`: wallet mentions by alias stem, with the preposition before them (transfer direction).
  - `text.ts`: Cyrillic-safe word regex helper, title cutting.
  - `rules/<kind>.ts`: one file per kind. Priority order is the `RULES` array in `index.ts`: idea prefix → reminder («напомни») → transfer → held → deposit → subscription → income → expense → reminder (exact hour, no marker) → expense (amount + currency/wallet) → idea fallback (low confidence).
  - `types.ts`: `ParseResult { kind, confidence, fields, tags, raw_text }`, `ParsedFields`.
- `src/db/`: own IndexedDB wrapper. `idb.ts` (promisified requests, versioned `MIGRATIONS`; v1 creates the stores and seeds the default wallets), `db.ts` (`PocketDb`: records, wallets, settings, drafts; every write is an upsert by id; `saveFromDraft` writes the record and removes the draft in ONE transaction; `softDelete`), `wallets.ts` (`walletRefs` = wallet list for the parser: visible AND hidden wallets, current names + aliases by stable id; unique-name check), `types.ts`.
- `src/money/`: `format.ts` (own «1 234,50 ₽» formatter and ruble-string -> kopecks parser, no Intl), `totals.ts` (pure math, rules below).
- `src/time/format.ts`: the ONE `formatMsk(utcIso)` (big «23.10 19:00 МСК», small «у тебя 12:00» only when the device zone differs) + MSK helpers for the date-time input. All UI times go through it (`timeEl` in `ui/dom.ts`).
- `src/ui/`: `intake.ts` (`#t=` read once + `replaceState`, listeners for load / `hashchange` / `pageshow`, duplicate guard), `card-model.ts` (parser result / record <-> card state, «Понял так» sentence; pure), `card.ts` (the editable card), `new-screen.ts` («Новое»), `lists.ts` («Дела», «Мысли»), `money-screen.ts`, `wallet-editor.ts`, `rows.ts`, `settings-screen.ts` (version only), `app.ts` (shared context, sheet, edit-record), `dom.ts`.
- `test/index.html` + `src/test-*.ts`: the iPhone test page (`/pocket-brain/test/`).

## Money rules (src/money/totals.ts)
- Wallet balance = start balance + income - expense - transfers out + transfers in. Deleted records are excluded; hidden wallets are still counted (and shown under «Скрытые кошельки»). «Всего» on the wallets block = sum over ALL wallets, hidden too.
- held («чужие деньги»), deposit, subscription, reminder and idea records NEVER change a wallet balance. A record with no wallet (or an unknown wallet id) counts in no wallet.
- «Чужие деньги» total = sum of held amounts; «Вклады» = sum of deposit amounts; «Подписки» = sum of subscription amounts, every subscription is monthly. Missing amount counts as 0.
- Records store ids, not names: `wallet_id` and `fields.to_wallet_id`; the parser's wallet NAME is mapped to an id right after parsing, so renames never break totals.
- Subscription next date (shown in «Дела») = next `day` of the month at 12:00 MSK, recomputed at display time.

## Tests
- `tests/fixtures/phrases.ru.json`: the 50 reference phrases. This is the parser spec and the stage 5 model evaluation set. Fixed `now` = 2026-10-22T09:00:00Z.
- `tests/parser.test.ts`: one test per phrase, invariants (raw text kept, unknown → idea), timing (< 50 ms per phrase).
- `tests/sw-lib.test.ts`: service worker helpers. `tests/db.test.ts` (fake-indexeddb), `totals.test.ts`, `time-format.test.ts`, `money-format.test.ts`, `intake.test.ts` (hash, duplicate guard, card model).
- `e2e/shell.spec.ts`, `e2e/app.spec.ts`: Playwright (WebKit + Chromium); app flows: link -> card -> save, no duplicates, wallets, totals, ideas.
- `pnpm test`: unit tests. `pnpm test:tz`: the same tests under `TZ=UTC` and `TZ=America/New_York` (`scripts/test-tz.mjs`).

## Scripts
- `scripts/build-sw.mjs`, `sw-lib.mjs`, `sw.template.js`: service worker generation after `vite build`.
- `scripts/deploy.mjs`: build and push to the `gh-pages` branch.
- `scripts/test-tz.mjs`: the time zone test runner.

## Docs
- `docs/iphone-test.md`: the phone test spec. Decisions are in `DECISIONS.md` and status is in `STATUS.md` (root).
