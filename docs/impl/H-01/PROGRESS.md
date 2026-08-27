# PROGRESS — IMPL-H-01 · адаптер-подпроцесс рендерера HyperFrames · старт 2026-08-27T23:50:06+06:00
План: пока не утверждён — сначала чтение, потом план 3–7 шагов ниже черты, жду «ок».
- `23:50` [0/N] якорь до чтения: `date -Iseconds` = 2026-08-27T23:50:06+06:00
- `23:55` [0/N] чтение закончено за 5 мин (Charter §6/§7, ADR-0008 «Контракт»/«Сборка»/«Параллелизм», ADR-0009 карта+«Расположение композиции», ADR-0006 §2, invariants R1–R14/D4/K6, roadmap §3+§4.9 H-01/H-02, sp3f/run-hf.mjs, sp3c/run-one.mjs+lib/hfprofiles.mjs+lib/versions.mjs, sp3f/lib/env.mjs, sp3f/src/index.html, media/assemble/*, core-model/render-ir.ts, templates-spec/spec.ts, eslint.config.js, tests/boundaries/adr0009-graph.test.ts)
- `23:55` ИЗМЕРЕНО ДО ПЛАНА (пять фактов, все меняют план):
  1. `hyperframes` пришпиливает Chrome САМ: `CHROME_VERSION = "152.0.7928.2"` литералом в `dist/cli.js` (`src/browser/manager.ts`), кэш `~/.cache/hyperframes/chrome`, фолбэк `~/.cache/puppeteer/chrome-headless-shell`, переопределение `HYPERFRAMES_BROWSER_PATH`. Preflight — штатная команда `hyperframes browser ensure` (+ `browser path` для скриптов). Измерено на **0.8.4** (в `docs/spikes/sp3c/node_modules` лежит 0.8.4, а не 0.8.5, как в его `package.json`) — перемерить после установки 0.8.5.
  2. `compositionHash` рендерера — **16 hex** (`5c05d8c4637e8a1c`, sp3c/results/summary.md), не sha256 и не blake3; приходит в трассе `[Render:trace] {phase:'compile',status:'checkpoint'}` — то есть ПОСЛЕ старта рендера, а `bundle.hash` — поле ВХОДА.
  3. `png-sequence` HyperFrames пишет `frame_000001.png` (1-based, `formatExportFrameName`); `encodeSegment` берёт `framePattern`+`startNumber` — совпадает без правок `media`.
  4. `tests/boundaries/adr0009-graph.test.ts` держит `renderer-hyperframes: ['core-model','templates-spec']` ДОСЛОВНО; `@vpe/media` в зависимостях красит его.
  5. D4-линт (`eslint.config.js`, `packages/*/src/**`) запрещает `Date.now`/`performance.now`/`Math.random` — `stats.wallMs`/`peakRssBytes` нельзя измерить внутри `src/**` без входа-часов.
- `23:55` машина: ffmpeg/ffprobe 7.0.2-static системные (`/usr/local/bin`), node v25.6.1 (nvm), pnpm 11.9.0, nproc 12, кэша Chrome нет ни в `~/.cache/hyperframes/chrome`, ни в `~/.cache/puppeteer/chrome-headless-shell` — браузер будет качаться.

---

## ПЛАН (жду «ок»; вопросы ниже плана — блокирующие помечены)

**Шаг 0 — зависимости и preflight (ОТДЕЛЬНЫЕ ЯКОРЯ, в 90 минут стоп-правила не входят).**
`pnpm add -F @vpe/renderer-hyperframes hyperframes@0.8.5 gsap@3.15.0`; измерить `pnpm why @hyperframes/core|engine|producer` — тянет ли CLI их сам (если нет — добавить явно той же версией); `ffmpeg-static`/`ffprobe-static` НЕ ставятся (M-03 п. 9, V6), пути ffmpeg уезжают в `HYPERFRAMES_FFMPEG_PATH`/`HYPERFRAMES_FFPROBE_PATH`. Скрипт пакета `"preflight": "hyperframes browser ensure"`. Записать: build id браузера (перемерить `CHROME_VERSION` у 0.8.5 и сверить с `hyperframes browser path`), лицензии из `node_modules/*/LICENSE` таблицей, КАЖДУЮ новую строку `pnpm-lock.yaml`.

**Шаг 1 — контракт и валидация; ПЕРВЫЙ ЗЕЛЁНЫЙ ТЕСТ (по нему считается стоп-правило).**
`src/contract.ts` — `SegmentRenderRequest`/`SegmentArtifact`/`StreamFingerprint`/`RenderResponse` по ADR-0008 без единого изменения поля; `Sha256` берётся у типов `core-model` (`IrAssetRef['sha256']`), а не импортом `@vpe/schema` — образец `compile/src/timeline/types.ts:44`, новой стрелки графа это не требует. `src/validate.ts` — форма (zod), `requestVersion`, все пути абсолютные, `bundle.path` внутри `tmpDir`, `outputPath` вне `tmpDir`, `ir.assets ⊆ assets` и `ir.fonts ⊆ fonts` по sha, **sha256 файла по `path` == заявленному** (это и есть R3-ассерт на байтах); ошибки списком, без первой попавшейся. Тест `test/contract.test.ts` — R4 round-trip через `canonicalJson` + пять отказов.

**Шаг 2 — материализация каталога композиции.**
`src/materialize.ts` → `tmpDir/composition/`: `index.html` (runtime), `ir.json` (канонический JSON), `assets/<sha256>.<ext>`, `fonts/<sha256>.<ext>` — ТОЛЬКО из `request.assets`/`fonts`, `vendor/gsap.min.js` из `node_modules` (код рендерера, не файл проекта — вне R3 по определению, назову в отчёте и в клетке R3). Расширение — по магическим байтам (§4 п. 6 вариант (а)), неизвестный формат = ошибка. `compositionHash` = хэш канонического перечня `(относительный путь, sha256 байт)`, отсортированного; сверка с `bundle.hash` — отказ при расхождении. Геометрия: `data-width/height = round(compileProfile.width|height × pixelProfile.scale)` + `transform: scale()` (ADR-0008 называет раскрытие `scale` обязанностью адаптера; ТЕСТ раскрытия — `H-02`, здесь только механизм, иначе композиции не существует). `src/composition/` — HTML+JS без сборщика, читает `ir.json`, слои по `z`, `data-start`/`data-duration` = `frameStart/fps`, `clipDurationInFrames/fps` (единственное место перевода), субтитры DOM-группами без стилей. Реестр реализаций `src/templates/index.ts` — **пустой в проде** (ассерт в тесте); шаблон без реализации ⇒ ошибка ДО браузера. Тест `test/materialize.test.ts`.

**Шаг 3 — аргументы и окружение.**
`src/argv.ts` — `hyperframes render <dir> -o <frames> --format png-sequence --fps <num> --workers <n> [--no-browser-gpu] --quiet`; ни одного литерала «по месту», всё из профилей; env: `TZ=UTC`, `LC_ALL=C`, четыре `HYPERFRAMES_NO_*`, два `HYPERFRAMES_*_PATH`. Тест `test/argv.test.ts` голден-вектором на массив целиком (образец `assemble-args.test.ts`).

**Шаг 4 — R2/R3 механизмом.**
`test/r2-r3.test.ts` без браузера: R2 — `chmod 0555` вокруг `tmpDir`/`outputPath`, адаптер проходит, запись мимо падает `EACCES`; R3 — перехват `fs.open*/read*` тест-хуком, список открытых ⊆ {пути запроса, `tmpDir`, `outputPath`, `node_modules` рендерера}; негативный контроль — чужой файл в IR ⇒ отказ валидации ДО открытия. Оговорка «полный ro/net-namespace — `H-05`» в обе клетки.

**Шаг 5 — запуск и точка входа подпроцесса.**
`src/run.ts` → `renderSegment(request, options)`: preflight (наличие бинаря + инструкция при отсутствии) → материализация → spawn с wall-clock kill по `segmentTimeoutMs` → разбор `[Render:trace]` → счёт PNG == `segmentDurationInFrames` → `encodeSegment` → `framemd5Of`/`probeStreamFingerprint`/`sha256Of`/`assertNoAudioTrack` → артефакт → очистка (`options.keepTmp`). **Часы — ВХОД** (`options.clock`), не `Date.now` внутри `src/**`: иначе D4-линт красный (образец «`RandomBytes` параметром» из `mint.ts`, roadmap `L-01` «`now` как вход»). `bin/render-segment.ts` (вне `src/`, поэтому вправе звать `Date.now`) — stdin JSON → stdout JSON → exit-код. Тесты `test/render.test.ts` и `test/subprocess.test.ts` — С БРАУЗЕРОМ, явный таймаут, отдельными файлами от юнит-части.

**Шаг 6 — границы, протокол нарушений, доки.**
`tests/boundaries` — пакет не импортирует `compile`/`voice`; D4-линт расширить на композицию (греп по `src/composition/**`); протокол нарушений шестью пунктами задания (падающим, откат `cp`); README пакета (preflight, переменные, что ждёт `H-05`); `docs/impl/H-01/{report.md, PROGRESS.md, violation-transcript.txt}`; `invariants.md` R2/R3/R4 по факту; `DEBTS.md` с №154.

## ВОПРОСЫ ВЛАДЕЛЬЦУ (плана без ответов нет)

**A. БЛОКИРУЮЩИЙ — стрелка `renderer-hyperframes → media`.** Задание §0 говорит «импортирует
`core-model`, `templates-spec`, `media`». Карта ADR-0009 говорит `renderer-hyperframes →
core-model, templates-spec, hyperframes, gsap`, README пакета говорит «**НЕ импортирует** …
`media`», и это НЕ соглашение: `tests/boundaries/adr0009-graph.test.ts` держит список
дословно и краснеет на `@vpe/media` в `dependencies`. Причина расхождения датируется: правка
DOC-04 (2026-08-25) внесла в ADR-0008 «рендерер отдаёт КАДРЫ, `media` их кодирует **и собирает
артефакт**», а карта ADR-0009 старше её и не пересматривалась. Варианты:
* **(а) добавить стрелку** — правка карты ADR-0009 + `ARROWS` в тесте + README пакета одним
  осознанным изменением. Тогда `renderSegment` возвращает `SegmentArtifact`, как требует
  ADR-0008 «Контракт» и критерий готовности `H-01`. Цена: у рендерера пять стрелок вместо
  четырёх; правка ADR (владелец), не моя.
* **(б) стрелку не добавлять** — адаптер отдаёт кадры и `stats`, а `encodeSegment` и сборку
  артефакта делает `cli` (`L-01`/`L-02`). Цена: `RenderResponse` перестаёт нести
  `SegmentArtifact`, то есть ответ подпроцесса `vpe render-segment` — уже не то, что описано
  в ADR-0008, и `render.test.ts` не может проверить `stream`/`framemd5Sha256` здесь.
**Рекомендую (а)** — ADR-0008 новее и называет `SegmentArtifact` выходом адаптера.
До ответа шаги 1–4 исполнимы целиком, шаг 5 — нет.

**B. БЛОКИРУЮЩИЙ (он же §4 п. 3) — `compositionHash`: sha256 или blake3.** Ответ, который
задание не предполагало: **величин две, и они разные.**
* `compositionHash` **рендерера** — 16 hex (`5c05d8c4637e8a1c`, ИЗМЕРЕНО SP-3c), приходит в
  трассе после старта рендера. Именно его имеют в виду ADR-0006 §2 и `verifyComposition`
  (`recorded`/`reported` — простые строки, тип не мешает).
* `bundle.hash` — поле **входа**, типизировано в ADR-0008 как `Sha256`, и посчитать в него
  16-hex-величину рендерера физически нельзя: её ещё не существует в момент валидации.
**Предлагаю:** `bundle.hash` = **sha256** канонического перечня каталога (тип поля ADR-0008
остаётся дословным — `blake3` пришлось бы менять тип, а это правка контракта, запрещённая
заданием), а `compositionHash` рендерера ловится из трассы и возвращается отдельным полем
`RenderResponse.compositionHash` — ровно то, что потребляет `verifyComposition` (долг №116).
Итого blake3 в пакете не появляется вовсе. Кандидат в правку ADR-0008 — назвать обе величины
разными именами; ADR не правлю, пишу в отчёт.

**C. (§4 п. 1) Пришпиливание браузера — ИЗМЕРЕНО, решение проще ожидаемого.** Версию
пришпиливает сам `hyperframes` (`CHROME_VERSION` литералом в его коде), а не puppeteer.
Значит: `pnpm preflight` = `hyperframes browser ensure`, «явный build id в `package.json`»
НЕ НУЖЕН (и был бы вторым источником правды), а `renderSegment` перед рендером проверяет
`hyperframes browser path` и падает с инструкцией. Побочно: это **противоречит** обоснованию
строки R14 и roadmap `H-03` («версия Chrome не пришпилена самим пакетом — её выбирает
puppeteer»); строка от этого не отменяется (сверять фактическое с отпечатком по-прежнему
надо), но её «почему» устарело — кандидат в правку, задача `H-03`. Подтверждаю после
установки 0.8.5.

**D. (§4 п. 2) Тесты с браузером обязательны?** Рекомендую **обязательны** (паритет с M-03
п. 9), skip по переменной отвергаю. Приёмка со стороны без доступа к хосту загрузки Chrome
увидит их красными — это свойство приёмки, и юнит-часть (шаги 1–4) отделена файлами, чтобы
было видно, что зелено без браузера.

**E. (§4 п. 4/5) Механизмы R2/R3** — `chmod 0555` и перехват `fs` + `file_server` с корнем
`tmpDir/composition`; `strace` отвергаю. Возражений не имею, беру как в задании.

**F. (§4 п. 6) Расширение ассета** — по магическим байтам, ошибка на неизвестном. Беру (а).

**G. (§4 п. 7) fps с `den ≠ 1`** — измерю на 0.8.5; если CLI дробь не принимает, это ошибка
адаптера «профиль не поддерживается рендерером» + долг, не округление. Фикстура — `30/1`.

**H. (§4 п. 8) `stats.peakRssBytes`** — перенос `sp3/lib/proctree.mjs`, если ≤ 15 минут;
иначе долг с адресом `H-05`. Часы для сэмплера — тот же вход `options.clock` (D4).

**I. Мелочь, но менять её мне нельзя молча:** `render.test.ts` по заданию идёт на профиле
`render.ac4.yaml` (270×480, `workers: 1`) — а `ac4` по решению владельца 12 (RM1) есть
ПОЛНЫЙ ПРОГОН ФИКСТУРЫ, а не профиль для дыма шаблона. Здесь он берётся только как дешёвый
набор пиксельных полей для синтетического сегмента, гейта V13 на нём нет и не заводится.
Если это чтение неверно — скажите, возьму `final` со `scale`, поставленным тестом.

---
- `00:06` РЕШЕНИЯ ВЛАДЕЛЬЦА (28.08) — план принят с поправками:
  * **A:** стрелку `renderer → media` НЕ добавлять. `renderSegment` → `RenderResponse {ok:true, frames:{dir,pattern,startNumber,frameCount}, engineCompositionHash, stats} | {ok:false, error}`. `SegmentArtifact` собирает **`media`**: новая аддитивная `buildSegmentArtifact(frames, pixelProfile, outputPath)` (композиция `encodeSegment`/`framemd5Of`/`probeStreamFingerprint`/`sha256Of`/`assertNoAudioTrack`). Тип `SegmentArtifact` — в `media`, `SegmentRenderRequest` — в рендерере. Сквозной тест «кадры → артефакт» — в `renderer-hyperframes/test/` с `@vpe/media` как **devDependency только тестов**; охранник графа читает `dependencies` и не меняется.
  * **B:** `bundle.hash: Sha256` = sha256 канонического перечня каталога (наш вход); величина рендерера из трассы — отдельным полем **`engineCompositionHash`** (не `compositionHash`: два имени на две величины). Blake3 в пакете нет. В отчёт — кандидат в ADR-0006 §2: какая из двух входит в `segmentKey`.
  * **П1 (D4):** часы — вход `renderSegment(request, {clock})`; `Date.now` ровно в одном файле — `bin/render-segment.ts`, «граница процесса», единственное исключение D4-линта, перечисленное тестом линта поимённо. Сэмплер RSS получает тот же `clock`.
  * **П2 (Chrome):** версию берёт `hyperframes`, второго источника не заводить; preflight = `hyperframes browser ensure`; `renderSegment` зовёт `browser path` и падает с инструкцией. Ставим **0.8.5** (как просит `sp3c/package.json`); не встанет — стоп и отчёт.
  * **П3:** пометка I принята (`render.ac4.yaml` — дешёвый набор пиксельных полей для синтетики, гейта V13 нет).
- `00:07` [0/6] ЯКОРЬ УСТАНОВКИ (в 90 мин стоп-правила НЕ входит): начата `pnpm add -F @vpe/renderer-hyperframes hyperframes@0.8.5 gsap@3.15.0` + devDep `@vpe/media`
- `00:08` [0/6] установка готова за 19 с. ИЗМЕРЕНО: `hyperframes` **0.8.5** (license `Apache-2.0` в package.json), `gsap` **3.15.0**; `pnpm why @hyperframes/core` — **пусто**, у 0.8.5 в `dependencies` НЕТ ни одного `@hyperframes/*` (CLI самодостаточен) ⇒ отдельно НЕ ставим (условие задания «если CLI их не тянет сам» измерено отрицательно). `CHROME_VERSION = "152.0.7928.2"` подтверждён и на 0.8.5. Лок: +1504/−30 строк. Предупреждение pnpm: пропущены build-скрипты `esbuild`/`onnxruntime-node`/`protobufjs`/`@google/genai` — платформенный `@esbuild/linux-x64@0.25.12` при этом установлен; проверю рендером.
- `00:08` [0/6] ЯКОРЬ PREFLIGHT (в 90 мин НЕ входит): начата `hyperframes browser ensure` — качает chrome-headless-shell (~260 МБ по SP-3c)
- `00:12` [0/6] ОШИБКА окружения и её причина: первый `hyperframes browser ensure` упал `ERR_MODULE_NOT_FOUND: tslib` — `pnpm add` оставил дерево ЧАСТИЧНО материализованным (`@swc/helpers@0.5.23` объявляет `tslib: ^2.8.0`, лок его знает, а линка в `.pnpm` не было). Лечится `pnpm install --force` (37 с, added 497). Это свойство pnpm 11.9.0, а не пакета — в отчёт.
- `00:12` [0/6] PREFLIGHT ГОТОВ за 16.7 с. ИЗМЕРЕНО: `Chrome Headless Shell v152.0.7928.2`, 114.8 МБ, кэш `~/.cache/hyperframes/chrome/chrome-headless-shell/linux-152.0.7928.2/chrome-headless-shell-linux64/chrome-headless-shell` (НЕ `~/.cache/puppeteer`, как было в SP-3c). Якоря установки+preflight закрыты; дальше идёт счёт 90 минут.
- `00:16` [1/6] ПЕРВЫЙ ЗЕЛЁНЫЙ ТЕСТ за 6 минут от начала счёта: `contract.test.ts` — **24 теста**, 441 мс, без браузера. R4 round-trip через `canonicalJson` (+ отказы `Map`/`Set`/`bigint` с путём), форма (7 отказов), R3-вход (`ir ⊆ request`, 3), R3-байты (sha файла, 3), `isInside` (5). Стоп-правило 90 минут выполнено.
- `00:16` РЕШЕНИЕ ПО ХОДУ (в отчёт): **`zod` в пакет НЕ добавлен.** Карта ADR-0009 называет внешние зависимости `renderer-hyperframes` поимённо — `hyperframes`, `gsap`; добавление `zod` было бы правкой карты того же класса, что отклонённая владельцем стрелка `→ media`. Валидация ручная, отдаёт список `RenderProblem` с адресами — форма, в которую ошибки zod пришлось бы переводить всё равно.
- `00:16` ИЗМЕРЕНО и стало отказом, а не подстановкой: `pixelProfile.imageFormat: jpeg` рендерером НЕ выражается — у `hyperframes@0.8.5` форматы вывода `mp4|webm|mov|png-sequence|gif`, JPEG-последовательности нет, mp4 запрещён R10. `render.final.yaml` несёт `imageFormat: jpeg` ⇒ на профиле `final` адаптер сегодня ПАДАЕТ по правилу «ADR-0008 профиль». Кандидат в долг (см. отчёт).
- `00:28` [2/6] `materialize.test.ts` — **20 тестов** зелёных, 560 мс, без браузера. Раскладка каталога (7 файлов ровно), имена по sha256, расширение из байтов, лишний файл рядом не попадает, остаток прошлого прогона затирается, `compositionHash` детерминирован/чувствителен к байту и к геометрии/не зависит от порядка обхода/NUL разводит склейку, `bundle.hash` сверяется в обе стороны, шаблон без реализации = `V3` ДО создания каталога, продакшн-реестр пуст, `scale` 0.25 → 270×480, `<` в субтитрах экранирован (`</script>` не закрывает тег).
- `00:28` НАЙДЕНО ПРИ ПРОГОНЕ (в отчёт): путь к `gsap.min.js` и `runtime.js` нельзя брать относительным от файла модуля — он живёт в ДВУХ раскладках (`src/` под vitest, `dist/src/` после `tsc --build`), и хардкод `../..` верен ровно в одной. Оба резолвятся подъёмом к `package.json` пакета (+ `require.resolve` первым путём для gsap). Ошибка проявилась бы только в подпроцессе, то есть позже всего.
- `00:30` [3/6] `argv.test.ts` + `r2-r3.test.ts` — **17 тестов** зелёных, 633 мс, без браузера. Голден-вектор аргументов целиком, `workers`/`browserGpu` из профиля, `png-sequence` всегда, `scale` в аргументы не уезжает, дробный fps = отказ; env: четыре `HYPERFRAMES_NO_*` + `TZ`/`LC_ALL` перебивают родителя. R2: `chmod 0555` вокруг + негативный контроль EACCES + «вне tmpDir/outputPath ни одного файла» + очистка композиции; R3: перехват `fs` (список ⊆ белого) + негативный контроль «чужой ассет в IR не открывался».
- `00:31` [5/6] ИЗМЕРЕНО на первом настоящем рендере: HyperFrames проверяет `HYPERFRAMES_FFMPEG_PATH`/`_FFPROBE_PATH` как ПУТЬ К СУЩЕСТВУЮЩЕМУ ФАЙЛУ и на голом имени `ffmpeg` падает ДО браузера («Configured path does not exist»). Добавлен `resolveOnPath` — обход `PATH` руками; системный ffmpeg 7.0.2 находится по `/usr/local/bin/ffmpeg`.
- `00:44` ОШИБКА: рендер идёт, но ПАТОЛОГИЧЕСКИ медленно — за 13 минут 0–2 PNG из 30 (сегмент 30 кадров, 270×480). Прогон убит, разбираюсь без `--quiet`.
- `00:49` [5/6] ПРИЧИНА НАЙДЕНА И ИЗМЕРЕНА (ключевая находка задачи): **компилятор HyperFrames читает композицию СТАТИЧЕСКИ, до запуска браузера.** Без `--quiet` он печатает `root_missing_composition_id`, `root_missing_dimensions`, `missing_timeline_registry` и «Continuing render despite lint issues», после чего идёт калибровать длительность браузером («root duration unknown», `staticDuration: 0`, `forceScreenshot: true`) — и рендер не падает, а идёт неограниченно долго (0–2 кадра из 30 за 13 минут). Правка: `data-composition-id`/`data-start`/`data-duration`/`data-width`/`data-height` пишет МАТЕРИАЛИЗАЦИЯ прямо в разметку, а `runtime.js` ВСТРАИВАЕТСЯ в `index.html` (отдельный `<script src>` компилятор не разворачивает). Перевод `n/fps` теперь есть по обе стороны границы — на Node при материализации и в браузере; runtime их СВЕРЯЕТ и падает при расхождении.
- `00:50` [5/6] `render.test.ts` — **5 тестов** ЗЕЛЁНЫХ С НАСТОЯЩИМ БРАУЗЕРОМ за 23.95 с (четыре рендера по 30 кадров 270×480). Сквозной путь сошёлся: 30 PNG → `buildSegmentArtifact` (`media`) → `.mts`; `stream` измерен 270×480 h264 yuv420p bt709 30/1; аудио нет (R5); подпись x264 несёт `crf=18`/`threads=1` (кодировал НАШ ffmpeg, не рендерер — R10); два прогона дали равные `framemd5Sha256` и sha256 (дым, не гейт); шаблон без реализации = `V3` без единого PNG.
- `00:50` ИЗМЕРЕНО: `compositionHash` рендерера у нашей композиции = `bdb0ce739ee61c35` — **16 hex**, подтверждено на 0.8.5 (SP-3c мерил ту же форму). Возвращается полем `engineCompositionHash`, с `bundle.hash` (64 hex) не смешивается.
- `00:58` [6/6] ВСЁ ЗЕЛЁНОЕ: `pnpm build` + `pnpm lint` чисто, `pnpm test` — **121 файл, 1986 тестов**, 134 с. Пакет `renderer-hyperframes`: 78 тестов в 7 файлах (5 без браузера, 2 с браузером). Новые линты: `tests/lints/d4-composition.test.ts` (4), `tests/lints/d4-clock-boundary.test.ts` (5).
- `00:58` НАЙДЕНО ЧУЖИМ ОХРАННИКОМ (в отчёт): греп **M4** идёт по СЫРОМУ тексту и покраснел на слове `fetch(` в моём КОММЕНТАРИИ. Охранник не ослаблялся — переформулирован комментарий: правило сильнее в том виде, в каком оно есть.
- `00:58` [7] начат протокол нарушений (шесть, откат `cp`)
- `01:05` [7] ПРОТОКОЛ НАРУШЕНИЙ ЗАКРЫТ — шесть нарушений, все шесть краснят названные тесты; откат `cp`. Два результата стоят отдельно: **Н5** (`Math.random` в runtime композиции) ESLint НЕ ЛОВИТ — зона правила `packages/*/src/**/*.ts`, а runtime это `.js`, и `mountSource` живёт в строковых литералах ⇒ заведён греп-охранник `d4-composition.test.ts`; **Н6** нашёл МОЙ ложно-зелёный тест — «`workers` из профиля» стоял на единственном значении `4` (числе из `render.final.yaml`) и остался зелёным при литерале `'4'`. Тест усилен тремя значениями (1, 2, 7); это единственная правка теста по итогам протокола.
- `01:05` [7] `allowBuilds`: четыре заглушки «set this to true or false», вписанные `pnpm add`, решены ИЗМЕРЕНИЕМ (образец `CP-04`) — все четыре `false`, сквозной рендер после этого зелёный; причины и условие пересмотра записаны в `pnpm-workspace.yaml`.
- `01:07` ЗАМЕРЫ ДЛЯ ОТЧЁТА (`FACT`, два прогона): `compositionHash` = `09bec003…e6c7` (6 файлов каталога); `engineCompositionHash` = `a3a5b27f50451f50` (16 hex), равен в обоих прогонах; `frameCount` 30/30; `sha256` и `framemd5Sha256` РАВНЫ между прогонами; `stream` = h264/High/21/yuv420p/bt709/1-90000/**270×480**/30-1; `wallMs` 5606 и 4130; `peakRssBytes` 682 и 707 МБ; `.mts` 10 716 Б в обоих.
- `01:15` [8] ДОКИ: `docs/impl/H-01/{report.md, violation-transcript.txt}`, README пакета; `invariants.md` — **R2/R3/R4 → `guarded`, счёт 56 → 59**, пометки без смены статуса у R1/R10/R13/R14/D4; `DEBTS.md` — №154–158 новые, №48 измерен, №115 сужен, №116 помечен.
**Итог:** адаптер границы рендерера написан и работает сквозным путём; контракт ADR-0008 не изменён ни одним полем; `SegmentArtifact` собирает `media` аддитивной функцией, стрелка `renderer → media` не заведена. Три инварианта переведены в `guarded` с честными оговорками «до `H-05`». Детали — `docs/impl/H-01/report.md`.
