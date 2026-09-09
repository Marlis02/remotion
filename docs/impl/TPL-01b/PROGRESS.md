# PROGRESS — TPL-01b (пресеты шаблонов; gate-case в папке; снимок spec export) · старт 2026-09-10T?? (заход 1)
План: 9 шагов. Бюджет: 90 минут чистой работы заход 2. Прогоны — только через ./scripts/vpe-docker.
- `з1` заход 1: чтение §1 закончено — contract.ts, direction.ts, seed.ts, keys.ts, materialize.ts, fingerprint.ts, library.ts, gates-file.ts, spec.ts, fixture.ts, spec-export.ts, cp07-lint, DEBTS/roadmap, живые режиссуры
- `з1` FACT: preset не может войти ни в seed (4 входа seedOf + линт d2), ни в segmentKey (7 слагаемых, текста режиссуры среди них нет), ни в compositionHash (перечень каталога композиции), ни в engineFingerprint (версии не-@vpe пакетов)
- `з1` FACT: zod 4.4.3 допускает `.refine()` у члена `discriminatedUnion` — проверено прогоном
- `з1` FACT: migrate.ts про `direction` не знает, canonical/json.ts — общий писатель; правка схемы миграции не тянет
- `з1` НАХОДКА B1: `work/ct-test-1` НА ДИСКЕ НЕТ (`work/` в .gitignore; лежат только env-02/ и spec.md) — охранник §3.1 как написан неисполним
- `з1` НАХОДКА B2: `renderer-hyperframes` не может читать YAML (нет зависимости `yaml`, импорт `@vpe/schema` запрещён охранником boundaries.test.ts:65) — `presets/*.yaml` в library.ts неисполним без новой зависимости
- `з1` НАХОДКА B3: вторая копия случаев гейта — `CASES` в `renderer-hyperframes/test/templates-gate.test.ts`, а не в `cli/test/gate-requests-cli.test.ts` (там был `CALLS`, №228 закрыт)
- `з1` ЖДУ ВЛАДЕЛЬЦА: три вопроса (B1 — чем доказывать §3.1; B2 — формат файла пресета; B4 — источник пресетов для still@1/bed@1/grade@1)
- `з2` [0/9] БАЗА на ноуте, до правок: `ai-test-1 --profile final` холодная **221.8 с / 3 промаха** → прогретая **1.65 с / 3 попадания** (×134), sha256 final.mp4 равен `83799253fa9a…`, `.cache/segment/final` = 39 MiB
- `з2` [5/9] **ОХРАННИК §3.1 ДОКАЗАН НА ЖИВОМ ПРОЕКТЕ.** `ai-test-1` переведён на пресеты (7 записей из 7, `params` не осталось ни одного) → сборка `final`: **3/3 попадания** кэша, значения те же (`8bd8d24c0a25…`/`d4de25109fd6…`/`92eafa8b40cc…`), `bundle.hash` те же, sha256 `final.mp4` = `83799253fa9a…` — равен обеим сборкам до правки. FACT: `segmentIrHash` не сдвинулся ⇒ IR пресета не видит
- `з2` [6/9] запросы гейта перегенерированы **побайтно**: `gate-requests.test.ts` без VPE_GATE_REQUESTS_UPDATE — 44/44, 12 файлов и 12 `bundle.hash` те же
- `з2` [7/9] охранники: `compile/test/template-presets.test.ts` 6/6, `templates-spec/test/presets.test.ts` 9/9, `schema/test/direction-preset.test.ts` 6/6; транскрипт трёх проб на живом проекте — `violation-transcript.txt`
- `з2` [8/9] `spec export` печатает пресеты числами, `template list` — колонкой; снимок перегенерирован 445 → 523 строки (№250 закрыт)
- `з2` [9/9] **ПОЛНЫЙ ПРОГОН НА ХОСТЕ: 2575 passed / 3 skipped / 0 failed** (622.8 с, один процесс vitest). Норма после `TPL-01a` — 2554/3/0; прирост ровно +21 = 6 + 9 + 6 новых тестов. Живые браузерные гейты (`templates-gate`, `templates-gate-final`) входят в это число и зелёные
**Итог:** пресеты — файлы папки шаблона, разворачивание в компиляторе до схемы; `ai-test-1` на пресетах даёт 3/3 попадания кэша и тот же sha `final.mp4` (FACT); случай гейта в папке, 12 запросов побайтно (№193 закрыт); снимок перегенерирован (№250); образ/хост 2575/3/0. Не сделано: `vertical-v1` на пресеты — долг №253. Детали — docs/impl/TPL-01b/report.md.
