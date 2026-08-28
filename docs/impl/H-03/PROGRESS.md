# PROGRESS — IMPL-H-03 `engineFingerprint` · старт 2026-08-28T05:39:49Z
Якорь (измерено ДО чтения): node v25.6.1 · HEAD 2d2a04d · cwd /home/ct/Desktop/remotion · TZ=UTC LC_ALL=C
- `05:39` [0/N] якорь снят; читаю roadmap H-03, ADR-0006, invariants R14/K6, sp3c/lib/versions.mjs, renderer-hyperframes/src, media/encode.ts
- `05:44` [0/6] чтение закончено (~28 мин): roadmap §3/§4.9 H-03, ADR-0006 §2/§3/§4/§5, invariants R14/K6/D4, sp3c/versions.mjs, run.ts/argv.ts/contract.ts, media/encode.ts, views/segment.json, DEBTS 115/149/154/155/156
- `05:44` ИЗМЕРЕНО до плана: node_modules НЕ материализованы — `hyperframes`/`gsap` в локе есть, в `node_modules/.pnpm` (277 пакетов) НЕТ; store `/home/ct/snap/code/258/.local/share/pnpm/store/v11`
- `05:44` ИЗМЕРЕНО: ffmpeg/ffprobe = `/usr/bin/{ffmpeg,ffprobe}` `6.1.1-3ubuntu5`; `/usr/local/bin/ffmpeg` НЕТ (отчёт H-01 §4 называет `7.0.2-static` из `/usr/local/bin` — расхождение)
- `05:44` ИЗМЕРЕНО: Chrome НА МЕСТЕ — `~/.cache/hyperframes/chrome/chrome-headless-shell/linux-152.0.7928.2`; платформа linux/x86_64, nproc 12
- `05:44` ИЗМЕРЕНО (снимает вопрос §4 п. 1): `@vpe/core-model` РЕЭКСПОРТИРУЕТ `blake3`/`canonicalJson` (src/index.ts:41, второй адресный блок) — прод-зависимость рендерера, стрелка не нужна
- `05:44` ИЗМЕРЕНО (ответ на вопрос §4 п. 4): `pixelProfile.encoder.{threads,preset,tune,rcLookahead,aqMode,psy,bitexact}` + `codec/crf/gopSize/pixelFormat/colorSpace` УЖЕ в `views/segment.json` — строка энкодера есть функция полей, уже входящих в ключ
- `05:44` ИЗМЕРЕНО (блокирующее, №154): схема `render-profile/1` ЗАПРЕЩАЕТ `jpegQuality` при `imageFormat: png` (render-profile.ts:103-107) — правка №154 «как написана» роняет `schema/test/render-profile.test.ts`
- `05:44` ЖДУ ВЛАДЕЛЬЦА: план ниже черты + пять вопросов

---

## ПЛАН (6 шагов) — жду «ок»

**Ш0. Материализация дерева.** `pnpm install` (лок не трогается; при отказе сети — `--offline`
из store). Без него нет ни `hyperframes`, ни `gsap`, ни живой пробы, ни зелёного теста.
Измеряю и записываю: сколько скачано, сколько из store.

**Ш1. `packages/renderer-hyperframes/src/fingerprint.ts`** — пять экспортов, ноль `fs` вне
первого:
* `collectEngineProbe(input) → EngineProbe` — ЕДИНСТВЕННОЕ место `fs`/`execFileSync`.
  Вход: `{parentEnv, cliPath?, ffmpegPath?, ffprobePath?, packageDir?}` — ПУТИ И ОКРУЖЕНИЕ,
  **ни одного профиля** (K6, вторая половина). Chrome ищется тем же `browserPath(cliPath,
  parentEnv)`, что и рендер; ffmpeg/ffprobe — тем же `resolveOnPath`. Никакого
  `sort().at(-1)` по кэшу. Отказ различается по классу: `{state:'absent', reason}` (бинаря
  нет — отпечаток считается) против **броска** `RenderAdapterError` (бинарь есть, но не
  отвечает / не разбирается — это поломка окружения, а не его отсутствие).
* `computeEngineFingerprint(probe) → {fingerprint, canonical}` — ЧИСТАЯ. `canonical =
  canonicalJson(поля)`, `fingerprint = blake3(canonical)` — обе функции из `@vpe/core-model`
  (измерено: реэкспорт уже есть, стрелки не заводятся, второй функции хэша не появляется).
* `assertEngineMatches(recorded, actual)` — сравнение ПО ПОЛЯМ, список всех расхождений
  «ожидалось/фактически»; расхождение **состава** (набор ключей не совпал) — отдельная
  первая ошибка «состав отпечатка изменился», не сравнение пересечения. Падение —
  `RenderAdapterError('R14', …)`.
* `formatEngineProbe(probe) → string` — таблица «поле → значение» для отчёта сборки (`L-01`).
* Состав полей (⊕-список ADR-0006 §3, с решениями вопросов ниже):
  `hyperframes`, `@hyperframes/{core,engine,producer}` и `three` — **только если в дереве**
  (сегодня измеренно нет ⇒ ключа нет вовсе, не `null`); `gsap` + плагины — перечень берётся
  из `dependencies` package.json рендерера по маске, не литеральным списком;
  `chromeVersion` (из бинаря `--version`) + `chromePath`-класс; `ffmpeg`/`ffprobe` — первая
  строка `-version`; `node`; `platform`/`arch`; `hostClass: 'local'` (ADR-0006 §4, v1 —
  константа, определение ЕСТЬ); `browserLaunch` — НАШИ флаги + версия CLI (вопрос 3).

**Ш2. Вызов в `renderSegment`** — сразу после preflight, ДО материализации. `recorded`
приходит `options.recordedEngineFingerprint?`; при её отсутствии отпечаток считается и
возвращается новым полем `RenderResponse.engineFingerprint` (аддитивная правка `contract.ts`,
как `engineCompositionHash` в `H-01`). При `spawnRenderer` (тесты R2/R3) — не считается, как
и preflight.

**Ш3. Тесты — четыре файла.**
* `test/fingerprint.test.ts` — синтетическая проба: детерминизм (два вызова — одна строка);
  смена любого поля — другая строка (по полю на утверждение); перестановка ключей пробы — та
  же строка; `absent`-Chrome — отпечаток считается, `assertEngineMatches` падает со списком;
  одно расхождение — падение с именем поля; равенство — тишина; `recorded` с меньшим набором
  полей — падение «состав изменился».
* `test/fingerprint-live.test.ts` — живая проба БЕЗ браузера: версии пакетов из
  `node_modules` == `dependencies` package.json рендерера (это и есть «`npm ls` совпадает»,
  без `npm`); ffmpeg-строка начинается с `ffmpeg version`; `execFileSync` с явным таймаутом.
* `test/fingerprint-browser.test.ts` — ОТДЕЛЬНЫЙ файл: версия Chrome из бинаря стабильна
  между двумя вызовами и равна `pinnedChrome`, если тот читается законно (вопрос 2).
* `tests/lints/k6-fingerprint.test.ts` — греп: в `fingerprint.ts` нет `yaml`/`Profile`-входов;
  `collectEngineProbe` не принимает профилей (проверка по сигнатуре + греп по `.yaml`).

**Ш4. Фикстура №154** — одна строка `imageFormat: png` + комментарий. **Форма зависит от
ответа на вопрос 5** (схема запрещает соседнее поле).

**Ш5. Протокол нарушений** (`cp`-резерв, откат): (Н1) версия Chrome из константы пакета
вместо бинаря; (Н2) возвращён `sort().at(-1)` по кэшу; (Н3) расхождение версий понижено до
`console.warn`; (Н4) строка запуска Chrome сведена к одному флагу. Каждое — показано красным.

**Ш6. Доки и сдача** — `docs/impl/H-03/{report.md, PROGRESS.md, violation-transcript.txt}`,
`invariants.md` (R14/K6 по факту), `DEBTS.md` (№156 закрыт кандидатом, №115 сужен, новые
с №159), кандидаты в ADR-0006 §2/§3 и roadmap §4.9 — в отчёт, ADR не правится.


- `05:48` ВЛАДЕЛЕЦ: ок с поправками. 1(г), 2 принято, 3(а), 4 принято + долг обеими половинами, 5(а). П1: расхождение ffmpeg — в отчёт. П2: молчание согласием НЕ является впредь.
- `05:48` [1/6] начато: `pnpm install` (материализация дерева) — ожидаю ~1-3 мин
- `05:48` ИЗМЕРЕНО: `pnpm install` требует ПОКУПКИ node_modules — `.modules.yaml.storeDir` = `snap/code/**254**`, а разрешается `snap/code/**258**` (ревизия snap VSCode уехала). Дерево H-01 (hyperframes/gsap/puppeteer/esbuild/sharp) на диске ОТСУТСТВУЕТ: 277 пакетов `.pnpm` — это до-H-01 dev-дерево
- `05:48` решение: ставлю с `--store-dir` старого store (254), чтобы не покупать дерево и не тянуть лишнего
- `05:49` [1/6] готово за 40.3 с — дерево материализовано (403 пакета в `.pnpm`, было 277); hyperframes@0.8.5, gsap@3.15.0; store 254; сеть: 116 скачано, 10 из store
- `05:52` **НАХОДКА (R14 живьём).** `hyperframes browser path` отдаёт `~/.cache/**puppeteer**/chrome-headless-shell/linux-152.0.**7977.42**`, а НЕ свой `~/.cache/hyperframes/chrome/.../linux-152.0.**7928.2**`. Оба бинаря на диске. Бинарь `--version` → `Google Chrome for Testing 152.0.7977.42`. То есть пришпиливание `CHROME_VERSION` НЕ действует, когда есть puppeteer-кэш: рендерит другой растеризатор. Долг №156 («версию пришпиливает сам пакет») — неполон
- `05:52` ИЗМЕРЕНО (вопрос 2): у `hyperframes@0.8.5` НЕТ ни `exports`, ни `main` — только `bin`; подкоманды `browser` = ensure|path|clear, `version` среди них нет ⇒ законного канала к `CHROME_VERSION` НЕТ. Поля `pinnedChrome` не будет; тест №156 — «версия бинаря стабильна между двумя вызовами»
- `05:52` [2/6] начато: `src/fingerprint.ts` + `R14` в `RenderRule` + константы фиксированной части запуска в `argv.ts`
- `05:56` [2/6] код написан: fingerprint.ts (5 экспортов), argv.ts (2 константы), errors.ts (R14), contract.ts (2 поля ответа), run.ts (вызов), index.ts
- `05:57` [3/6] ЗЕЛЁНЫЙ ТЕСТ: `fingerprint.test.ts` 18/18 за 595 мс (синтетическая проба, без бинарей)
- `05:59` [3/6] ЗЕЛЁНЫЙ: `fingerprint-live.test.ts` 10/10 за 28.0 с (живая проба, без браузера)
- `06:01` [3/6] ЗЕЛЁНЫЕ: `fingerprint-browser.test.ts` 4 passed / 1 skipped за 14.6 с; `k6-fingerprint.test.ts` 6/6 за 333 мс
- `06:02` [4/6] фикстура №154 правлена (вариант (а)); начат ПОЛНЫЙ прогон `vitest run` — ожидаю ~5-10 мин
- `06:12` [4/6] ПОЛНЫЙ ПРОГОН: 1991 passed / 6 failed / 1 skipped за 238 с. Два отказа — мои (двойной spawn `browser path` в renderSegment ⇒ таймаут 5 с). Четыре — следствие правки №154 в ЗАКРЫТЫХ зонах: schema/test/render-profile.test.ts, media/test/{assemble-args,cache-matrix,cache-views-golden}.test.ts
- `06:14` [5/6] пакет рендерера ЗЕЛЁНЫЙ целиком: 115 passed / 1 skipped за 85.2 с. Начат протокол нарушений Н1-Н4
- `06:17` [5/6] протокол Н1-Н4: все четыре показаны КРАСНЫМИ, откат `cp`, зелёное подтверждено. Слабость Н1/Н2 записана честно
- `06:25` [6/6] доки: report.md, invariants.md (K6 → guarded, счёт 60; R14 пометка), DEBTS.md (№156 closed, №115 сужен, №159-163)
- `06:27` [6/6] `pnpm lint` чистый (0 errors, 0 warnings). Финал: `renderer-hyperframes` + `tests/lints` — 272 passed / 1 skipped за 97.7 с
- `06:27` ЖДУ ВЛАДЕЛЬЦА: долг №163 — правка четырёх тестов в закрытых зонах (schema/media), последствие №154
**Итог:** `fingerprint.ts` (сбор/вычисление/сверка/печать) + вызов в `renderSegment`; K6 → `guarded` (счёт 59 → 60), R14 — пометка без смены статуса (вызывающего с записью нет — `L-01`).
Измерено: browser path отдаёт puppeteer-кэш 152.0.7977.42 при пришпиленной 152.0.7928.2; ffmpeg 6.1.1 из /usr/bin вместо 7.0.2-static из H-01.
Четыре чужих теста красные — следствие №154, зона закрыта, вопрос владельцу. Детали — docs/impl/H-03/report.md.
- `09:00` ВЛАДЕЛЕЦ: вариант 1 с условием. Греп подтвердил: render.draft.yaml — живой jpeg (imageFormat: jpeg, jpegQuality: 80)
- `09:00` три места правлены + RENDER_DRAFT_FILE переехал в assemble-helpers (реэкспорт сохранён)
- `09:00` golden: cache-key-view.txt — РОВНО две строки диффа; cache-matrix.txt — НЕ изменился (третий образец вернул достижимость)
- `09:00` НАЙДЕНО СВЕРХ СПИСКА: два отказа R-02 в том же файле; один — смена ФОРМЫ ПРАВИЛА, названа вслух в отчёте §7
- `09:04` ПОЛНЫЙ ПРОГОН ЗЕЛЁНЫЙ: 125 файлов, 2029 passed / 1 skipped за 215.8 с; `pnpm lint` чист. №163 закрыт
