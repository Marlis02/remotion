# SPINE DRAFT (черновик ядра A1) — вход для критики

Это ЧЕРНОВИК решений Principal Architect'а по A1. Он ещё не документ, а спина,
которую надо сломать. Читать вместе с PROJECT_CHARTER.md и docs/research/r1,r2,r3.

Обозначения: V1..V11 — валидированные решения Charter. AC1..AC6 — acceptance criteria.

---

## S0. Общая форма пайплайна

```
source/*.md (git, человек/ИИ)
  │ parse (span-aware лексер маркеров)
  ▼
ScriptAST (в памяти; дампится для отладки, НЕ артефакт)
  │ normalize (V5) + токенизация слов → WordAnchors
  ▼
SpeechPlan (чанки нормализованного текста + таблица якорей)   [кэш]
  │ TTS (сеть, НЕдетерминирован) → PCM + посимвольные тайминги
  ▼
VoiceTake[] (audio.flac + alignment.json)  [КОММИТИТСЯ в репо, voice.lock.json]
  │ merge overrides (V2) + assets.lock + provenance
  ▼
Timeline (Project Model): сцены/главы, треки, template-вызовы, время в СЭМПЛАХ [артефакт build/]
  │ Policy Guard (R3) читает Timeline → policy-report.json
  │ compile(fps, renderProfile) → квантование в КАДРЫ, валидация V4
  ▼
RenderIR по главам (chapter-relative, целочисленный, renderer-agnostic) [артефакт + ключ кэша]
  │ adapt
  ▼
RemotionAdapter → немые сегменты chapter-NN.ts   [кэш по segmentKey]
                                                  +
AudioIR → сплошная PCM/FLAC дорожка на весь ролик (V6)
  ▼
ffmpeg concat -c copy + mux + единственное кодирование → final.mp4
```

Уровни, которые ПЕРСИСТЯТСЯ: VoiceTake, Timeline, RenderIR, сегменты, аудио-дорожка, final.
Уровень, который НЕ персистится: ScriptAST (только дамп по флагу).

---

## S1. Domain model (D1)

Сущности и «чего не должна знать»:

- **Project** — id, schemaVersion, fps, width/height, sampleRate, seedRoot, дефолты голоса,
  ссылка на renderProfile. НЕ знает: рендерер, конкретного TTS-провайдера, раскладку кэша.
- **Chapter** — единица рендера/кэша/параллелизма (V4). Упорядоченные сцены.
  НЕ знает: абсолютное время проекта, содержимое соседних глав.
- **Scene** — единица авторства и **scope якорей**. Прозаический блок + директивы.
  НЕ знает: кадры, сэмплы.
- **Anchor** — стабильный id + kind (w|s|b|m|sc|ch) + scope + порядковый номер. НЕ знает: время.
- **AnchorBinding** — anchorId → [startSample, endSample). Производится компилятором Timeline из VoiceTake.
- **SpeechChunk** — единица TTS-запроса (обычно абзац). Знает нормализованный текст и контекст. НЕ знает: аудио.
- **VoiceTake** — иммутабельный артефакт TTS: pcm/flac ref + alignment + provenance + fingerprint запроса.
  НЕ знает: где он стоит на таймлайне.
- **Track** — типизированная дорожка: speech | music | sfx | caption | visual | effect. НЕ знает: рендеринг.
- **Clip** — размещение элемента на треке в анкоро-относительном интервале.
- **Asset** — content-addressed файл + kind + интринсики (w/h/duration). НЕ знает: где используется.
- **Provenance** — юридическая запись об Asset (поля из r3 §3.4). НЕ знает: пиксели.
- **Caption** — производный трек: токены со ссылкой на anchorId. НЕ знает: шрифты/раскладку.
- **Marker** — авторская инструкция в исходнике со span'ом и целевым якорем.
  `[img: id]`, `[beat: name]`, `[chapter: id]`, `[pause: 400ms]`, `[emph]`, `[tpl: id{...}]`.
  НЕ знает: как реализуется.
- **TemplateCall** — {templateId, templateVersion, params} (V3). НЕ знает свою визуальную реализацию.
- **Override** — типизированная запись правки, ключ = id сущности/якоря, + `boundTo` fingerprint + reason.
  НЕ знает: структуру generated-файла.
- **RenderProfile** — всё, что влияет на пиксели/байты (r2 §8.4) + версии ассет-пайплайна и шрифтов.
  НЕ знает: содержание.
- **BuildRecord** — входы, ключи, версии, `now` (подан снаружи), время стадий.
- **PolicyReport** — generated-артефакт Policy Guard.

---

## S2. Source format (D2)

**Markdown + YAML frontmatter + ЗАКРЫТЫЙ набор inline-маркеров.** Не свой DSL.

Причины: контент — это произносимый текст; LLM пишет драфты в markdown; правка в любом редакторе;
git-diff по словам. Свой DSL = грамматика + сообщения об ошибках + подсветка + миграции синтаксиса —
это отдельный продукт, недоступный одному разработчику.

НО: маркеры парсятся честным span-aware лексером (не регекспами), потому что V5 требует точного
соответствия «символ исходника ↔ символ, ушедший в TTS».

**Нужен ли AST?** ДА. Доказательство: (а) V5 требует span'ов; (б) вырезание маркеров с сохранением
позиций = построение span-map; (в) сообщения об ошибках «файл:строка:колонка»; (г) детерминированная
токенизация слов → якоря. Регекс-подход теряет позиции и не тестируем.
AST при этом НЕ артефакт (не персистится) — он вырожден в две вещи: Timeline и span-map.

**Нужен ли IR?** ДА, и это ДРУГОЙ уровень: Timeline (время в сэмплах, анкоро-относительное,
renderer-agnostic, диффится) → RenderIR (время в кадрах, chapter-relative, целочисленный, хэшируется).
Обоснование разделения: Timeline не зависит от fps/renderProfile, RenderIR зависит.
Один уровень вместо двух означал бы, что смена fps инвалидирует то, к чему привязаны overrides.

**Уточняю V5 (частично оспариваю формулировку):** нужен не «алигнер original↔normalized»
(fuzzy sequence alignment), а **нормализатор-трансдьюсер**, который вместе с нормализованным текстом
выдаёт span-map original→normalized, и `apply_text_normalization: "off"` у провайдера (r1 §1.5).
Тогда соответствие — тождество по построению и покрывается unit-тестами.
Fuzzy-алигнер остаётся fallback'ом для провайдеров без capability `canDisableNormalization`.

---

## S3. Модель таймлайна (D3)

Три домена времени:
1. **Текстовый (порядковый):** слово → предложение → бит → сцена → глава. Физического времени нет.
2. **Сэмплы (физический, целые, sampleRate):** единственный источник истины физического времени.
3. **Кадры (целые, fps):** производится ровно один раз, в компиляторе RenderIR.

Правила против дрейфа:
- **R1. Секунды нигде не хранятся.** Только сэмплы (целые). Секунды — только на экран.
- **R2. Инвариант `sampleRate % fps == 0`**, fps — целое (29.97 запрещён). Тогда
  `samplesPerFrame S = sampleRate/fps` — целое, границы кадров точны в сэмплах.
- **R3. Квантуются ПОЗИЦИИ, не длительности.** `frame(sample) = (2*sample + S) div (2*S)`
  (round-half-up, целочисленная арифметика). Длительность = `frameEnd - frameStart`.
  Ошибка ограничена ±½ кадра и НЕ накапливается.
- **R4. Смещения чанков считаются суммой numSamples реально склеенного PCM** (r1 §3.3), не пересчётом из секунд.
- **R5. Схлопывание при квантовании чинится СЛИЯНИЕМ, не сдвигом.** Если два слова попали в один кадр,
  они становятся одним caption-токеном. Сдвиг = дрейф.
- **R6. Граница главы всегда кратна S.** Хвост главы добивается тишиной до целого кадра.
  Следствие: `durationInFrames = totalSamples / S` точно, видео и аудио не расходятся на стыках.
- **R7. Границы глав только на границе предложения** (валидируется компилятором).

**Уточняю V1:** «никогда к абсолютным секундам» относится к речевому таймлайну.
У ассетов с собственным временем (музыка, видео-вставка) есть внутреннее время в сэмплах
относительно НАЧАЛА САМОГО АССЕТА; их *размещение* всё равно анкоро-привязано.

**Биты** — именованные псевдонимы над word-anchor'ами (`[beat: reveal]`), семантические ручки
для шаблонов и правок.

---

## S4. Якоря (ключевое решение, часть D3)

`anchorId = base32(blake3(scopeId ‖ 0x00 ‖ normalizedWordForm ‖ 0x00 ‖ occurrenceIndexInScope))[:10]`,
префикс по виду: `w:`, `s:`, `b:`, `m:`, `sc:`, `ch:`.

scope = **сцена**; id сцены/главы — **явные в исходнике** (`## scene: intro`), дубликаты = ошибка компиляции.

Ключевое свойство: **регенерация TTS не меняет текст ⇒ не меняет якоря.** Секунды меняются, идентичность
слова — нет. Это и есть механизм, которым V1 переживает V2.

Известная слабость (см. САМОКРИТИКУ): правка слова меняет его якорь, и правка количества повторов
слова в сцене сдвигает occurrenceIndex у последующих одинаковых слов.

---

## S5. Формат проекта на диске (D4)

```
project.yaml            git  schemaVersion, fps, res, sampleRate, seedRoot, voice-дефолты, renderProfileRef
source/NN-name.md       git  проза + маркеры + frontmatter
overrides/*.yaml        git  типизированные записи правок (V2)
assets/assets.lock.json git  sha256 → provenance (r3 §3.4)
assets/store/ab/cd/<sha256>.<ext>   content-addressed (LFS или re-fetchable)
voice/voice.lock.json   git  chunkKey → {sha256, provider, model, voice, seed, generatedAt, billedUnits}
voice/<sha256>.flac     git-LFS  lossless ⇒ побитово равный PCM после декода
voice/<sha256>.align.json git  тайминги в сэмплах
fonts/                  git  + provenance (шрифты тоже ассеты, V10)
build/                  ignored  timeline.json, ir/*.json, segments/*.ts, audio/track.flac, final.mp4, reports/
.cache/                 ignored  CAS по ключам + index.sqlite (перестраиваемый)
```

**SQLite — только перестраиваемый локальный индекс кэша, НИКОГДА не источник истины.**
Причина: git-мержи, диффы, ревью правок (V2) требуют текстовых файлов.

**schemaVersion** — один на проект в project.yaml (диалект исходников + схемы overrides/lock-файлов);
у каждого generated-артефакта своя `irVersion`/`timelineVersion`.
Миграции: упорядоченные чистые функции vN→vN+1, у каждой пара фикстур (до/после) в тестах (AC6).
Миграция при открытии: бэкап + запись + отчёт diff; идемпотентна.

**Overrides (V2) — типизированные записи с ключом-идентификатором, НЕ JSON Patch.**
JSON Patch по указателям ломается при сдвиге индексов массивов (вставили слово — поехали все указатели).
Схема overrides физически НЕ УМЕЕТ выразить абсолютные секунды (только `{anchor, offsetMs}`) —
V1 обеспечивается типами, а не дисциплиной.
У каждой записи: `id`, `target`, `op`, `value`, `reason`, `createdAt`, `boundTo` (fingerprint того,
к чему привязались). Несовпадение fingerprint ⇒ статус **stale**, громкий WARN, никогда не тихое применение.

---

## S6. Кэш по содержимому (D5)

Стадии и ключи (blake3 от канонического JSON входов + `stageVersion`):
- `parse(sourceBytes, parserVersion)`
- `speechPlan(sceneAst, normalizerVersion, ttsSettings)`
- `voice(chunkRequest ⊕ stitchContext, providerId, modelId, voiceId, seed, providerOpts)` — **мемо эффекта, не чистой функции**
- `timeline(ast, voiceTakes, overrides, assetsLock, compilerVersion)`
- `renderIr(timelineChapter, fps, renderProfile, templateRegistryVersion)`
- `segment(renderIrChapterHash, renderProfile, assetChecksums, fontChecksums)`   ← r2 §8.3
- `audioTrack(voiceTakes, musicAssets, mixSettings, overrides, audioPipelineVersion)`
- `final(segmentHashes[], audioTrackHash, muxProfile)`

**Ключевое следствие для AC3:** RenderIR главы — **chapter-relative**; абсолютное положение главы
в проекте в IR НЕ ВХОДИТ (оно в assembly-манифесте). Поэтому изменение длительности главы 1
не инвалидирует сегменты глав 2..N. Именно это делает AC3 достижимым.

Следствие-ограничение: ничто внутри главы не может зависеть от абсолютного времени проекта.
Шаблон, которому это нужно (прогресс-бар «3:45 / 10:00»), помечается `globalTimeDependency: true`,
компилятор добавляет projectDuration в IR главы — и такая глава честно становится cache-hostile.

**voice-кэш — особый:** промах ключа НЕ приводит к молчаливому вызову сети. Сборка падает с
«запусти `vpe voice sync`», если не передан `--allow-tts`. Причина: TTS недетерминирован (r1 §2.3),
стоит денег, и его выход — коммитимый артефакт.

Инвалидация — только по ключу (никаких mtime). GC — LRU + пины.
`stageVersion` — константа на пакет; тест падает, если хэш исходников пакета изменился без бампа.

---

## S7. Детерминизм и seed'ы (D6)

- `seedRoot: uint32` в project.yaml (коммитится).
- `seed(node) = uint64(blake3(seedRoot ‖ chapterId ‖ sceneId ‖ layerId ‖ templateInstanceId ‖ purpose))`.
- **Seed'ы материализуются в RenderIR на этапе компиляции.** Рендерер seed'ы не выводит.
  Отсюда: рендер одной главы отдельно == рендер её же в составе всего — идентичные пиксели.
- **RenderIR целочисленный.** Никаких float. Дроби — фиксированной точкой (`scaleMilli: 1250`).
  Убирает класс проблем с канонизацией JSON и FP.
- Канонический JSON для хэширования: сортированные ключи, без незначимых пробелов, UTF-8, только целые.
- Линтер (V8): запрет `Math.random`, `Date.now`, `new Date()`, `performance.now()`, `toLocaleString`
  в пакетах compile/render-пути. Плюс runtime-guard в entry рендера (заморозка глобалей).
- `now` — вход сборки, попадает в BuildRecord; внутри compile его нет.
- `TZ=UTC`, `LC_ALL=C` в рендер-процессе.
- Сортировки: явный тотальный порядок с тай-брейком по id. Тест «shuffle»: перемешать входные массивы,
  хэш выхода обязан совпасть.
- **AC4 = равенство КАДРОВ, не файлов** (r2 §8.7): декодировать в rawvideo, sha256 по кадру.
- **AC4-b (новый тест, которого нет в Charter, но которого требует приёмочный вопрос №3):
  сегментная эквивалентность** — рендер целиком == рендер по главам + конкат, покадрово.

---

## S8. Граница рендерера (D7)

```ts
interface SegmentRenderRequest {
  readonly ir: RenderIrChapter;            // JSON, целые числа, chapter-relative
  readonly profile: RenderProfile;         // всё, что влияет на пиксели
  readonly assetPaths: ReadonlyMap<string /*sha256*/, string /*локальный путь*/>;
  readonly outputPath: string;
}
interface SegmentArtifact {
  readonly path: string; readonly sha256: string;
  readonly frameCount: number;             // сверяется ffprobe
  readonly profileEcho: RenderProfile;
}
type RenderSegment = (req: SegmentRenderRequest, signal?: AbortSignal) => Promise<SegmentArtifact>;
```

Гарантии ВХОДА (что рендерер получает): всё по значению или по локальному content-addressed пути;
никаких URL; время в кадрах относительно главы; seed'ы материализованы; шрифты локальными файлами
с checksum; субтитры — готовый список токенов с диапазонами кадров.
Гарантии РЕНДЕРЕРА: чистая функция входа; нет сети (проверяется), нет TTS, нет поиска ассетов,
нет бизнес-логики (V9); не пишет вне outputPath.

**V3 vs V9 — разрешение противоречия:** «разворачивание шаблона» = чистая функция
(params, тайминги) → визуальные примитивы, исполняемая в адаптере. Это рендеринг, а не бизнес-логика.
Версия реестра шаблонов входит в renderProfile ⇒ в ключ кэша.

**V4 и стыки глав:** граница главы = редакторское решение «здесь жёсткая склейка».
Переходы (crossfade) живут ВНУТРИ главы, между сценами. Дверь: перекодирование одного шва
в assembly — отложено.
**V4 и звук:** V4 относится к видео-домену. Аудио-домен не сегментируется вообще (r2 §7.3),
поэтому сплошная фоновая музыка V4 не нарушает.

---

## S9. Монорепо (D8)

Стрелки только вниз, циклов нет:

```
schema  →  (никого)
core-model → schema
script → core-model
provenance → schema
assets → provenance, core-model
tts → core-model, provenance
audio → core-model
align → core-model                 (dev/верификация AC5)
templates-spec → core-model        (только схемы параметров, БЕЗ react)
timeline → script, core-model, assets, audio, templates-spec
render-ir → core-model             (БЕЗ remotion, БЕЗ react — проверяется тестом)
policy → core-model, provenance    (ruleset — данные, не код; r3 §6)
renderer-remotion → render-ir, templates-spec, remotion
assembly → core-model              (ffmpeg)
cache → schema
cli → всё
```

Тест зависимостей: никто, кроме `renderer-remotion` и `cli`, не импортирует `remotion`;
`render-ir` не импортирует react; `core-model` не импортирует node:fs.

---

## S10. Ответы на приёмочные вопросы (черновик)

**(1) Правка одного слова.** parse(файл) → новый AST; меняется якорь ТОЛЬКО этого слова;
speechPlan чанка меняется ⇒ TTS этого чанка + до 3 соседей (из-за stitch-контекста, r1 §3.1);
Timeline пересчитывается целиком (дёшево); RenderIR главы с правкой меняется; **сегменты
остальных глав берутся из кэша** (chapter-relative IR); аудио-дорожка пересобирается в PCM (дёшево);
final = concat -c copy + один mux. Ассеты, шрифты, кадры прочих глав — из кэша.

**(2) Регенерация TTS со всеми ручными правками.** Правки привязаны к текстовым якорям ⇒ переживают
по построению. Схема overrides не умеет выражать секунды ⇒ «сломаться в секунды» нельзя.
Правки, привязанные к содержимому конкретного дубля (ручная подкрутка тайминга слова), несут
`boundTo` fingerprint дубля ⇒ помечаются stale, выводятся списком, применяются только после review.
Старые VoiceTake не удаляются (A/B и откат).

**(3) Сегментный рендер и AC4.** seed'ы материализованы в IR; время chapter-relative; граница главы
кратна S; renderProfile зафиксирован и входит в ключ; `--gl=swangle`; шрифты и эмодзи файлами.
Тесты: AC4 (двойной рендер, равенство кадров) + AC4-b (целиком vs по главам, равенство кадров).

---

## S11. SPIKE LIST (черновик)

S1 Детерминизм и сегментная эквивалентность (блокирующий для AC4) — + rider: доживает ли C2PA до mp4 (r3 U5).
S2 Бюджет кадров/сек на swangle (блокирующий, решает fps 30/60) — r2 §10.1.
S3 Нормализатор-трансдьюсер + тождество alignment (r1 E1/E2/E4/E5) — решает, тождество V5 или fuzzy.
S4 Дрейф PCM vs mp3 + выбор контролёра AC5 (r1 E6/E7/E8) — решает измерительный прибор для 80 мс.
S5 Инкрементальная сборка «правка одного слова» на 2-главой фикстуре — валидирует AC3 и весь кэш.

---

## S12. Самокритика (черновик)

Если менять одно решение — **контент-производные id якорей (S4)**. Они элегантны, но правка слова
уничтожает якорь того самого слова, ради которого правка и делалась, а изменение числа повторов
слова сдвигает occurrenceIndex у последующих. Альтернатива — явные id, дописываемые форматтером
в исходник (`[#w7f2]`), уродливее, но строго стабильнее. Нужен замер частоты «churn» якорей
на реальном редактировании (рядом с S5).
