# CODEMAP — where things live

Updated: stage 1 (rules parser).

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
- `test/index.html` + `src/test-*.ts`: the iPhone test page (`/pocket-brain/test/`).

## Tests
- `tests/fixtures/phrases.ru.json`: the 50 reference phrases. This is the parser spec and the stage 5 model evaluation set. Fixed `now` = 2026-10-22T09:00:00Z.
- `tests/parser.test.ts`: one test per phrase, invariants (raw text kept, unknown → idea), timing (< 50 ms per phrase).
- `tests/sw-lib.test.ts`: service worker helpers. `e2e/`: Playwright (WebKit + Chromium).
- `pnpm test`: unit tests. `pnpm test:tz`: the same tests under `TZ=UTC` and `TZ=America/New_York` (`scripts/test-tz.mjs`).

## Scripts
- `scripts/build-sw.mjs`, `sw-lib.mjs`, `sw.template.js`: service worker generation after `vite build`.
- `scripts/deploy.mjs`: build and push to the `gh-pages` branch.
- `scripts/test-tz.mjs`: the time zone test runner.

## Docs
- `docs/iphone-test.md`: the phone test spec. Decisions are in `DECISIONS.md` and status is in `STATUS.md` (root).
