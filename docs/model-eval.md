# Model evaluation (stage 5), 2026-10-25

Laptop: Ryzen 7 6800H, headless Chromium (Playwright), `@wllama/wllama` 3.8.1 compat build, 1 thread, CPU only
(`n_gpu_layers 0`: WebGPU aborted in headless Chromium, see DECISIONS). `n_ctx 1024`, temperature 0, JSON schema
grammar `{"kind": enum}`, `max_tokens 24`, prompt = `src/model/prompt.ts` (English instructions, ~230 tokens),
`cache_prompt: true`. Shards served locally (the same split files that go to Pages). Runner: `tools/model-eval/run.mjs`.

Two sets:
- **fixture** — the 50 phrases of `tests/fixtures/phrases.ru.json` (the rules already get 50/50; shown for reference);
- **unsure** — 21 phrases of `tests/fixtures/unsure.ru.json` that the stage-1 rules saved as an unsure idea. These are
  the only phrases the app sends to the model.

| | Qwen2.5-0.5B-Instruct Q4_K_M | Qwen3-0.6B Q4_K_M (thinking off) |
|---|---|---|
| Size (shards) | 434 MB (5 shards) | ~357 MB (4 shards) |
| Valid JSON | 71/71 | 71/71 |
| Kind correct, unsure set | **3/21** | **14/21** |
| Kind correct, fixture set | 22/50 | 39/50 |
| Seconds per phrase (median / max) | 7.3 / 41.4 | 4.4 / 20.2 |
| Generation | 3.1 tok/s | 5.8 tok/s |
| Prompt processing | 4.7 tok/s | 7.7 tok/s |
| First load (local server) | 6.0 s | 3.5 s |
| Load from cache | 2.6 s | 2.1 s |

The max is the first phrase (whole prompt processed); later phrases reuse the cached system prompt.

**Winner: Qwen3-0.6B** (higher accuracy, smaller, faster). Licence Apache-2.0.

Qwen2.5 answered «income» to almost everything: worse than leaving the record alone.

Qwen3 mistakes on the unsure set:
- «кофе с собой триста пятьдесят» → deposit;
- «продал велосипед за 15000» → expense;
- «сдал металлолом 1500» → expense;
- «маме на день рождения цветы» → reminder;
- «хорошо бы съездить летом на Байкал» → reminder.

Consequences for the app:
- The stage-5 rules now catch all 21 unsure phrases themselves (`tests/parser-short.test.ts`).
- What still reaches the model is mostly real thoughts, where Qwen3 tends to answer «reminder».
- So the model may only turn an idea into expense / income / reminder, and only when the rules find an amount or a date
  in the text (`src/model/refine.ts`). The model never supplies numbers or dates.
- The model is OFF by default (Settings).

Not measured here (phone only): speed and memory on the iPhone A19, the real download time over mobile/Wi-Fi.

## In the app (laptop, Chromium, `e2e/model.spec.ts` with `MODEL_E2E=1`, local preview)
- First load (download from the local server + load): ≈ 9–10 s; from the cache after a reload: 2.2–2.9 s (only HEAD checks, no download).
- First note after a load: ≈ 21 s (the model reads its instruction); every next note: 4.3–5.3 s.
- Saving a phrase while the model is busy: 62–80 ms.
- Offline: the page comes from the service worker, the model from its cache; a note is still processed.
- The model is not stable on long notes: «репетитор по английскому 2000 за урок» came back as subscription (ignored),
  idea and income in different runs. Another reason it stays OFF by default, and every change it makes has «Отменить».
