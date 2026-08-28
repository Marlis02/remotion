# PROGRESS — IMPL-E-00 · реестр эффектов и `vpe template gate` · старт 2026-08-28T23:37:04+06:00
План: якорь → чтение → план ниже черты → ожидание «ок». Бюджет: 60 минут без зелёного теста ⇒ стоп и отчёт.
- `23:37` [0/N] якорь снят до любого чтения
- `23:47` [0/7] чтение закончено (30 мин): roadmap §3/§4 `E-00`, ADR-0008 (классы, процедура, бюджет AC2), отчёт `H-04` §2–§7, DEBTS №169/170/171/161/164, `gate.ts`+`where.ts` (сигнатуры), `bin/render-segment.ts`, `templates-spec/{manifest,gate,registry,templates}.ts`, `cli/src/index.ts` (пуст), `sp3f/src/index.html` (структура), `tests/boundaries/templates-spec-imports.test.ts`
- `23:47` НАХОДКА, меняющая раскладку: `templates-spec/src/**` запрещён `node:fs`/`node:path` охранником `tests/boundaries/templates-spec-imports.test.ts` (обоснование — чистота `declareAssets`, R3) ⇒ чтение `gates.json` физически не может жить в `templates-spec`
- `23:47` НАХОДКА: переименование `FIXTURE_TEMPLATES` задевает `packages/compile/test/*` (4 файла) — ЗАКРЫТАЯ зона задания

---

## План (ждёт «ок» владельца; до него код не пишется)

**Шаг 1 — каталог версионированных единиц.** Пять спеков `TS-01` объявляются ПРОД-библиотекой:
новое имя `TEMPLATE_LIBRARY` в `templates-spec/src/templates/index.ts` (то же значение),
`FIXTURE_TEMPLATES` остаётся алиасом с комментарием «имя врёт, вызывающие — в закрытой зоне
`compile`» + долг на снятие алиаса. Вопрос 6 ниже.

**Шаг 2 — дом записей (№170), две половины по границе пакетов.**
`templates-spec/src/gates-file.ts` — ЧИСТАЯ половина: схема файла (`template-gates/1`),
слияние «спек в коде + записи из файла» → манифест с `gates`, отказ «файл без спека»,
`gatesFileName(id, version)`. `renderer-hyperframes/src/library.ts` — ДИСКОВАЯ половина
(≈40 строк: `readdirSync`/`readFileSync` → чистая половина → `createRegistry`), потому что
диск запрещён в `templates-spec` границей пакета. `bin/render-segment` переводится на неё же —
это №171.

**Шаг 3 — №169, склейка `GateMedia` одной функцией.** `renderer-hyperframes/src/gate-media.ts`:
`createGateMedia({buildSegmentArtifact, framemd5Of, pixelProfile, fps})` — обе функции `media`
приезжают ЗНАЧЕНИЕМ (стрелки `renderer → media` в карте ADR-0009 нет, приём тот же, что у
`pcmSource`/`clock`). Браузерный тест `H-04` переводится на неё, копия из теста удаляется.

**Шаг 4 — команда.** `packages/cli/src/`: `vpe template gate <id>@<N> --profile final|draftHalf
--request <файл> [--gates-dir <кат>]` (разбор argv руками по образцу `bin/render-segment`) и
`vpe template list`. Резолв по прод-библиотеке, `runGate`, печать `formatGateOutcome`, запись
PASS в `<id>@<n>.gates.json` рядом со спеком, коды выхода: **0** PASS · **1** договорный отказ
(нет спека, `ac4`, файл без спека, запрос зовёт другой шаблон) · **2** argv/JSON не разобрались
· **3** FLAKY · **4** FAIL · **5** `error` («гейта не было»).

**Шаг 5 — чистые функции для `L-01`.** (а) устаревание записи `gateStaleness(record, {profileId,
engineFingerprint, bundleHash?})` в `templates-spec/src/gate.ts`; `assertBuildMayStart`
переводится на неё же (поведение не меняется — одно правило в одном месте); (б)
`overlappingBudget(clips)` — сумма `msPerFrameBudget` по пересекающимся по кадрам клипам +
`formatBudgetReport` с отметкой порога 250 мс/кадр, БЕЗ падения (решение 9).

**Шаг 6 — тесты (юнит и браузер РАЗДЕЛЬНЫМИ файлами).** Юниты: `cli/test/argv.test.ts`,
`cli/test/template-gate.test.ts` (отказы, запись/чтение `gates.json` во tmp, «файл без спека»,
«FAIL не пишет»), `cli/test/budget.test.ts` (в т.ч. непересекающиеся клипы = суммы нет),
`templates-spec/test/gates-file.test.ts` (схема файла, слияние, устаревание),
`renderer-hyperframes/test/library.test.ts`. Браузерный — ОДИН: `cli/test/template-gate-render.test.ts`
(команда живьём на ТЕСТОВОМ реестре `solid@1`, запись во tmp) — он же **шестой браузерный файл**
нормы приёмной машины.

**Шаг 7 — доки и протокол.** DEBTS: №169/170/171 → `closed` в этой же сессии, новые со **№175**;
`invariants.md` — усиление **R12** (переходов нет, счёт `guarded` остаётся 64); `docs/impl/E-00/report.md`
(включая разбор `sp3f/src/index.html` с адресами строк и вывод «перенос нулевой»);
`docs/impl/E-00/violation-transcript.txt` (4 охранника, откат только `cp`); название коммита.

**Стоп-правило:** 60 минут от «ок» без зелёного теста — стоп и отчёт.

---
- `23:52` «ОК» владельца с шестью развилками + П1–П5. Начинаю шаг 1/7 (каталог, переименование).
- `23:54` [1/7] шаг 1 готов: `FIXTURE_TEMPLATES` → `TEMPLATE_LIBRARY` целиком, без алиаса (11 файлов; `packages/compile/test/*` — ТРИ файла, 8 строк, только идентификатор; четвёртое упоминание — комментарий в `compile/src/timeline/compose.ts:71`, зона закрыта ⇒ долг)
- `23:54` [4/7] П4, счёт ДО перевода `assertBuildMayStart` на `gateStaleness`: `templates-spec/test/gate.test.ts` = **16 passed**; `renderer-hyperframes/test/gate.test.ts` = **14 passed**
- `23:54` [2/7] шаг 2: `templates-spec/src/gates-file.ts` написан (схема `template-gates/1`, `bundleHash` на уровне записи, `attachGates` с тремя отказами)
- `00:02` [4/7 частично] П4, счёт ПОСЛЕ перевода: `templates-spec` 16 + `renderer` 14 = **30 passed** — совпал с «до»; порядок проверок в `gateStaleness` сохранён исходным (профиль → окружение → класс), поэтому ни один текст отказа не изменился
- `00:02` [2/7] шаг 2 готов: `renderer-hyperframes/src/library.ts` (дисковая половина, `loadTemplateLibrary`); `bin/render-segment` переведён на прод-каталог — №171
- `00:02` [3/7] шаг 3 готов: `src/gate-media.ts` (`createGateMedia`), браузерный тест `H-04` переведён на неё, копия склейки из теста удалена — №169
- `00:10` [6/7] первый ЗЕЛЁНЫЙ тест новой задачи: `templates-spec/test/gates-file.test.ts` — **17 passed** (18 минут от «ок», стоп-правило соблюдено)
- `00:10` ВЫНУЖДЕННОЕ ОТСТУПЛЕНИЕ ОТ ПЛАНА (шаг 4), названо и исполнено: у команды ТРЕТИЙ обязательный вход `--render-profile <файл.yaml>`. Причина фактическая, не вкусовая: `SegmentRenderRequest.pixelProfile` несёт ТРИ поля адаптера (`browserGpu`/`scale`/`imageFormat`, K4), а `buildSegmentArtifact` кодирует ПОЛНЫМ профилем (кодек, crf, `encoder.*`) — плана «`--request` и всё» физически недостаточно, а выдумать энкодер нельзя (`FACT` SP-3 блок D: `threads=1` и `threads=4` дают разные битстримы). Побочно закрывает долг, который я сам записал в план: `--profile` теперь СВЕРЯЕТСЯ с `profileId` файла, а три поля профиля — с запросом. Откат — одна строка (флаг становится необязательным), вопрос владельцу в отчёте
- `00:16` [4/7 и 6/7] команда ЖИВЬЁМ: `runCli(template gate solid@1 --profile draftHalf)` — **PASS**, 1 sha256 и 1 framemd5 из 3, `wallMs` 2860/1382/1369, отпечаток `3217a4cf…3cb95c`, запись легла файлом во tmp. Юниты cli: **32 passed**; `library.test.ts`: 8; браузерный cli: 2
- `00:23` [7/7] полный прогон ПОСЛЕ задачи: `pnpm build` зелёный, `pnpm lint` — 0 ошибок, `pnpm test` — **141 файл, 2210 passed | 2 skipped, 302.6 s** (до задачи, по отчёту `TS-02`: 135 файлов / 2151). Прирост: +6 файлов тестов, +59 тестов
- `00:23` [7/7] протокол нарушений: начат
- `00:30` [7/7] протокол нарушений готов: пять охранников показаны падающими (Н1 FAIL пишет запись — 3 красных; Н2 файл без спека принят — 3; Н3 устаревшая запись пропущена — 5; Н4 сумма бюджета роняет — 1; Н5 (П5) чужой шаблон в запросе принят — 1). Откаты только `cp`, после каждого `git status --porcelain`; контроль после откатов — 63 passed. Транскрипт: `docs/impl/E-00/violation-transcript.txt`
- `00:35` [7/7] доки: DEBTS (№169/170/171 → `closed`, новые №175–№180), invariants (усиление R12, счёт `guarded` 64 без изменения), README трёх пакетов, `docs/impl/E-00/report.md`
- `00:36` [7/7] контрольный полный прогон ПОСЛЕ протокола нарушений: 141 файл / 2210 passed | 2 skipped / 301.8 s; build и lint чисты — откаты вернули дерево полностью
**Итог:** `E-00` выполнена. Записи гейта обрели дом (`template-gates/1` рядом со спеком, манифест из двух мест), команда `vpe template gate`/`vpe template list` написана и снята ЖИВЬЁМ на `solid@1` (PASS, 1 sha256 и 1 framemd5 из 3), склейка `GateMedia` стала одной функцией, `bin/render-segment` переведён на прод-каталог. Полный прогон: 141 файл / 2210 passed | 2 skipped; lint и build чисты. ОДИН вопрос владельцу — вынужденный третий вход команды `--render-profile` (§5 отчёта). Детали — `docs/impl/E-00/report.md`.
