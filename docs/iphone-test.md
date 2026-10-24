# Тест телефона (страница `/pocket-brain/test/`)

Источник спецификации: исследование архитектора `research/round2/safari-compute.md` §9 (адаптировано: шаг 5 — wllama-compat и две модели Qwen, а не e5/gemma).

Принцип: iOS убивает вкладку без ошибки, поэтому каждый шаг записывает «начал» в localStorage ДО выделения памяти и результат после. Таблица «шаг — число — итог» восстанавливается после перезагрузки; строка, оставшаяся в состоянии «начал», показывается как «упало (страница закрылась)».

1. WebGPU: `maxBufferSize`, `maxStorageBufferBindingSize`, `maxComputeWorkgroupStorageSize`, `shader-f16`, `subgroups`, `adapter.info` (только информация; нет WebGPU — «нет»).
2. `crossOriginIsolated`, `typeof SharedArrayBuffer` (на GitHub Pages ожидаемо false — поэтому модель однопоточная).
3. `navigator.storage.estimate()` и `navigator.storage.persist()`.
4. Максимальная аллокация: ArrayBuffer по 128 МБ, каждый кусок заполняется `fill(1)`, ссылки держатся; шаг пишется до выделения. Верхняя граница 4 ГБ (`?cap=` в МБ — для ноутбука).
5. wllama-compat, 1 поток: загрузка модели с Hugging Face и скорость (ток/с) на фиксированном промпте «JSON-напоминание»:
   - 5а Qwen2.5-0.5B-Instruct Q4_K_M — https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf (491 МБ, Apache-2.0)
   - 5б Qwen3-0.6B Q4_K_M — https://huggingface.co/unsloth/Qwen3-0.6B-GGUF/resolve/main/Qwen3-0.6B-Q4_K_M.gguf (397 МБ, Apache-2.0)

## Правило решения (записать в DECISIONS.md после скриншота владельца)
Потолок аллокации < 0,8 ГБ или загрузка модели роняет вкладку → этап 5 = «только правила, модель выключена». Иначе этап 5 как в плане.
