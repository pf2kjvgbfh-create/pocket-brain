# CLAUDE.md — POCKET-BRAIN (offline voice-to-card web app for iPhone)

Reply to the owner in Russian. The owner does not read code and checks only what is on screen (iPhone Safari).

## Entry point
Every session: read `STATUS.md` (3–6 lines). «продолжай POCKET-BRAIN» = do the next item from STATUS, no re-asking. If `STATUS.md` does not exist yet, this is stage 0: create it.
Plan — `IMPLEMENTATION-PLAN.md`. Evolve — `DEVELOPMENT.md`. Owner's manual steps — `SETUP.md`. Acceptance — `ACCEPTANCE.md`.

## Owner
Manual actions: numbered, one step at a time, plain words, exact copy-paste commands, and what he should see after each step.
Plain language: no internal codes («этап 8а.1»), file names or jargon in owner-facing text — say what he will see on the phone.
Owner corrections («не так», «опять», «я же говорил», «плохо») → immediately into STATUS «Замечания владельца» and a `type: feedback` memory with Why/How to apply.
Hardware: ONLY a Windows laptop (Ryzen 7 6800H, 16 GB, no NVIDIA) + iPhone 17 Pro Max. No home PC, no Mac, no iOS emulator.

## Hard rules (invariants — full text in `IMPLEMENTATION-PLAN.md`)
- NEVER print env values, tokens or keys — names only. Never read or output `.env*`, `*.pem`, `*token*`, `*secret*`, `*.key`. The GitHub token is typed by the owner into the app's Settings only: never in code, URL, backup, export, logs, screenshots or chat. Test only with a fake value.
- DO NOT FAKE INTEGRATIONS: no access → stub `TODO:INTEGRATION` + a line in STATUS.
- NO USER DATA IN THE PUBLIC REPO (`pocket-brain`). Data goes only to the private `pocket-brain-data`. Test fixtures use invented names/amounts.
- NO CONFIRMATION CARDS (owner, 2026-10-24/25): a phrase from `#t=` or typed is saved at once; the owner never picks kind/wallet/date before saving. A toast «Отменить / Изменить» follows; editing stays possible from the lists.
- RULES FIRST, MODEL NEVER BLOCKS SAVE. ALL TIMES SHOWN IN MSK (+03:00), stored in UTC. `#t=` READ ONCE then `replaceState`, records have ids. Single-thread wllama compat (no COOP/COEP on Pages).
- Free only: no paid services, no paid API, no analytics, no CDN at runtime. Don't change stack/hosting without a line in `DECISIONS.md` and the owner's consent.
- Check library APIs (wllama, wllama-compat, chrono-node, Playwright) through context7 before using them; never from memory. Don't invent tools.
- No reports/audits/plans in the project root. Docs live in `STATUS.md`, `DECISIONS.md`, `docs/`.
- Nothing "just in case": no abstractions, settings or features outside the current stage.

## Stages, context and models
- A stage is closed only when its «готово, когда» is met and YOU ran the real thing (the live Pages URL, not just unit tests). The «готово» message carries proof: screenshot (`scale: 0.5`) of WebKit and Chromium at 375 px; the link for the iPhone; then «Проверь сам» ≤3 steps naming only things you saw exist.
- HONESTY ABOUT THE PHONE: the laptop cannot verify iOS Safari memory limits, model speed on the A19, real Shortcut execution, Dictate Text offline in Russian, whether Shortcuts honours the `+03:00` offset, the real GitHub upload with the owner's token, or iOS clearing the tab's data. Never write «работает» for these — write «проверить на телефоне» and put the exact steps in ACCEPTANCE/SETUP.
- Tests first for parser, payload and backup logic (Vitest), then code. Mid-stage only fast checks; `code-reviewer`/`typescript-reviewer` once per stage on the whole diff; `security-reviewer` at stage 4 (token, network).
- Stages run back to back (owner wants a finished product, not checkpoints): each stage's implementation goes to a fresh subagent; you verify and commit. After a stage: tests green, commit `stage N: …`, STATUS updated. Tell the owner «Сделай /clear и напиши «продолжай POCKET-BRAIN».» only when the context guard fires, after a pause of more than ~1 hour, or when blocked.
- Long or noisy work (test runs, the 50-phrase model evaluation, log digging, browser QA, broad searches, model conversion/splitting) → a subagent with a precise brief; keep only its conclusion in the main chat.
- Model per stage is in `HANDOFF.md` and STATUS «Дальше». If the current model does not match, say so in one line before starting.
- Same approach failed twice → STATUS «блокер: …», stop, don't change the stack.
- Files >300 lines: Grep, then Read with offset/limit. Don't Read model files or build output; screenshots at `scale: 0.5`; prefer `read_page`/`get_page_text` for text.
- Never commit model shards of the losing candidate, node_modules, test-result folders or any backup/export file.

## Compact instructions
When the context is compacted, the summary MUST keep, verbatim where possible: (1) the problems handled and how each was solved; (2) options tried and set aside, with why; (3) every decision, constraint and owner remark; (4) current status: what is done, what is in progress; (5) open items and the next step; (6) exact names, numbers, paths, commands, URLs and error texts that are hard to reconstruct. Before any compaction or `/clear`, write STATUS first. History is append-only; edit files with targeted edits, never rewrite them whole.

## Tools
- context7 (docs), Playwright (WebKit + Chromium, 375 px and 1280 px), `gh`, `llama-gguf-split`. Other connectors stay off for this project.
- Missing tool → tell the owner in one line what to install. Don't invent workarounds.

## Stack
TypeScript + Vite (no framework) · own service worker · IndexedDB · chrono-node `ru` · `@wllama/wllama` 3.8.1 + `@wllama/wllama-compat` (1 thread) · GGUF shards < 100 MB on GitHub Pages · Vitest · Playwright · repos `pocket-brain` (public), `pocket-brain-data` (private) · URL `https://<gh-login>.github.io/pocket-brain/` (login from `gh api user`; expected `pf2kjvgbfh-create`, verify).

## Names (keep identical everywhere)
Shortcuts «Мозг» and «Мозг-напомнить» · backup file `data/pocket-brain.json`, monthly `data/records-YYYY-MM.json` · test page `/pocket-brain/test/` · candidate models Qwen2.5-0.5B-Instruct Q4 and Qwen3-0.6B Q4.

## STATUS.md format (Russian)
```
Обновлено: <дата>
Сделано: …
Решено: …
Замечания владельца: …
Не работает / блокер: …
Проверить на телефоне: …
Дальше: <этап> — модель <Opus/Sonnet>
```
