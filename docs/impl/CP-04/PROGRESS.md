# PROGRESS — IMPL-CP-04 (compileIr → RenderIrSegment[] + AssemblyManifest) · старт 2026-08-26T23:25:48+06:00
План: пока не утверждён — сначала чтение (§1 промпта), затем план 3–7 шагов ниже черты и ожидание «ок» владельца.
Стоп-правило: 90 минут по стенке без зелёного теста.
- `23:25` [0/N] якорь снят до чтения (`date -Iseconds` = 2026-08-26T23:25:48+06:00)
- `23:28` [0/N] чтение: Charter, 00-PROCESS, roadmap CP-04/05, ADR-0003 T1–T6/Субтитры/T9, ADR-0007 §1/§3/§4/§5, ADR-0006 §2, ADR-0008 Контракт, ADR-0001 таблица, ADR-0009 зоны, invariants K4/T3/T4/T6a/T6b/D1/D2/D7, DEBTS 1/7/38/114/115/131/132, код core-model/time+seed, compile/timeline/types.ts, eslint M5 — прочитано
- `23:36` [0/N] базовый прогон ДО правок: `pnpm test` — **98 файлов / 1611 тестов зелёные, 70.18 с** (node 25.6.1 через nvm; `npm` в PATH нет)
- `23:31` [0/N] зонд дампа Timeline на `fixtures/minimal` (временный тест, удалю): 2 сегмента, `L_1 = 551760`, `L_2 = 625680`, `S = 800` — числа §Б ниже посчитаны на них

---

# ПЛАН (7 шагов) — жду «ок» владельца до первой строки кода

Стоп-правило: 90 минут по стенке без зелёного теста. Отступление от плана — стоп и вопрос.

1. **Каркас: типы в `core-model` + зона `render-ir/` + зонд долга №1.**
   Новый файл `packages/core-model/src/model/render-ir.ts` (ТОЛЬКО типы, ни одной функции) +
   адресный блок реэкспорта в `src/index.ts` — форма в §А ниже. Каркас
   `packages/compile/src/render-ir/{types.ts,quantize.ts,seeds.ts,hash.ts,dump.ts}` (зона M5).
   Зонд №1: в `tests/boundaries/m5-internal-boundaries.test.ts` случаи используют спецификатор
   БЕЗ расширения (`'../timeline/x'`); повторяю зонд `M-03` со спецификатором `'../timeline/x.js'`
   на своих зонах. Ноль ошибок ⇒ ставлю `eslint-import-resolver-typescript`, ≤ 15 минут по
   стенке на установку+конфиг+повторный замер, иначе откат и долг остаётся с новым измерением.
2. **Квантование T3 и арифметика T6** (`render-ir/quantize.ts`, `metrics.ts`).
   `localFrame(x) = frameOfSample(x − segmentStart)`; укладка клипа по решению вопроса 2;
   `clipDurationInFrames = frameEnd − frameStart`, 0 ⇒ 1 кадр с записью; `d_i = ceilDiv(L_i·fpsNum,
   sampleRate·fpsDen)`, `A_i = frameStartSample(d_i)`, `δ_i = A_i − L_i`, `f_i`, `a_i`, `F = Σ d_i`.
   Ассерты: `δ_i ∈ [0, S)`, `Σ d_i = F`, `f_{i+1} = f_i + d_i`, `a_{i+1} = a_i + A_i`,
   `Σ A_i ≤ frameStartSample(F)` (разница `< n` — печатаю числом, падение за `CP-05`), `assertT4`
   на всех сегментах, `d_i ≥ minSegmentDurationFrames` (№132, исключения — вопрос 9).
   Ни одной формулы на месте: всё из `core-model/time`.
3. **Seed'ы, субтитры в кадрах, `segmentIrHash`** (`render-ir/seeds.ts`, `captions.ts`, `hash.ts`).
   `seedOf(seedRoot, {chapterId, sceneId, recordId, purpose})` → hex-строка (не `bigint`: JSON);
   `segmentId` в `SeedNode` не попадает — доказательство типом. Группы субтитров ⇒ диапазоны
   кадров segment-relative, подсветка токена по решению вопроса 3.
   `segmentIrHash = blake3(canonicalJson(RenderIrSegment))` — форма ОДНА на репозиторий
   (`canonicalJson` уже реэкспортирован `core-model`, измерено, §Г).
4. **Стадия `compileIr` ВНЕ обеих зон** — `packages/compile/src/compile-ir.ts`:
   `compileIr(timeline, compileProfile, seedRoot) → { segments, manifest, records }`, чистая
   функция; экспорт из `src/index.ts`. Детерминированный дамп IR (`dumpIr`) — зонд владельца.
5. **Тесты** (`packages/compile/test/compile-ir.test.ts` и соседи): K4-матрица (все поля
   `compileProfile` + доказательство типом для `pixelProfile`); T3/AC4-b — побайтовое равенство
   IR `seg:intro`/`seg:turn` в `minimal` и в «minimal + сцена ВЫШЕ intro» (закрывает №38); D1/D2;
   T6a property (перебор `L_1` по диапазону кадра); T6b на границах; T4 property с наивным
   round-half-up; D7 (правка слова ⇒ тот же порядок слоёв); JSON round-trip; №132; расширение
   грепа `tests/lints/d2-seed-inputs.test.ts` на новый вызывающий код.
6. **Протокол нарушений** (6 внесений, откат `cp`-резервом): квантование от начала ролика;
   `roundHalfUp` вместо `ceil` в `d_i`; `segmentId` подмешан в `SeedNode` вызывающим кодом (греп
   D2 обязан покраснеть); поле `pixelProfile` во входе; абсолютный ординал в IR; `Map` в IR.
   Затем полный `pnpm test` + `pnpm lint` + `pnpm typecheck`.
7. **Доки и сдача:** `docs/impl/CP-04/{report.md, PROGRESS.md, violation-transcript.txt}` — дамп IR
   `fixtures/minimal` целиком, K4-матрица, таблица правок закрытых зон; `docs/invariants.md`
   (K4/T3/T4/T6a/T6b/D1/D2/D7 по факту + счёт); `docs/DEBTS.md` (№1/7/38/114/115/131/132 со
   статусами, новые с №135); кандидаты в правку ADR — в отчёт, ADR не править.

## §А. Форма типов в `core-model/src/model/render-ir.ts` (вопрос 5)

```ts
type SeedHex = string;                       // 16 hex, big-endian первые 8 байт (ADR-0007 §1)

interface IrFrameSpan { readonly frameStart: Frames; readonly frameEnd: Frames; }  // T4, [start,end)

interface IrAssetRef { readonly sha256: Sha256; readonly role: string; }           // как в SegmentRenderRequest.assets

interface IrClip {
  readonly clipId: string;                   // `r:<recordId>` | `img:<b:...>` — авторский, не позиционный
  readonly track: TrackKind;
  readonly z: number;                        // авторское поле сортировки (ADR-0007 §5)
  readonly frames: IrFrameSpan;              // segment-relative, T3
  readonly template: string;                 // `kenburns@1` — данные
  readonly params: TemplateParams;           // данные, контракт — TS-01
  readonly assets: readonly IrAssetRef[];    // сегодня непусто только у порождённой `[img:]`
  readonly seeds: Readonly<Record<string, SeedHex>>;   // purpose → seed; см. вопрос 1
}

interface IrCaptionToken { readonly text: string; readonly highlight: IrFrameSpan | null; }  // вопрос 3
interface IrCaptionGroup { readonly frames: IrFrameSpan; readonly text: string;
                           readonly tokens: readonly IrCaptionToken[]; }

interface RenderIrSegment {
  readonly segmentId: string;
  readonly segmentDurationInFrames: Frames;  // d_i
  readonly clips: readonly IrClip[];         // порядок = РАНГ внутри сегмента по (z, sourceOrdinal, clipId)
  readonly captions: readonly IrCaptionGroup[];
  readonly fonts: readonly never[];          // пусто до TS-01 (declareFonts) — пометка в типе
}

interface AssemblySegment { readonly segmentId: string; readonly segmentDurationInFrames: Frames;
                            readonly nominalSamples: Samples; readonly alignedSamples: Samples;
                            readonly correctionSamples: Samples; readonly firstFrame: Frames;
                            readonly firstSample: Samples; }        // d_i, L_i, A_i, δ_i, f_i, a_i

interface AssemblyManifest {
  readonly segments: readonly AssemblySegment[];        // порядок сегментов
  readonly totalFrames: Frames;                         // F = Σ d_i
  readonly totalCorrectionSamples: Samples;             // Σ δ_i — «цена, принимаемая явно»
  readonly audioTrack: null;                            // AudioTrackRef приезжает с CP-05 (вопрос 6)
}
```

Ни `Map`/`Set`/`bigint`, ни сэмплов внутри `RenderIrSegment`, ни ссылок на типы `compile`.
Сэмплы есть только в манифесте (`L_i/A_i/δ_i/a_i` — они по определению T6 в сэмплах).

## §Б. Числа `fixtures/minimal`, посчитанные по T6 на измеренном дампе (проверю тестом)

`S = 24000·1/30 = 800` ровно. `L_1 = 551760` ⇒ `d_1 = ceil(689.7) = 690`, `A_1 = 552000`, `δ_1 = 240`.
`L_2 = 625680` ⇒ `d_2 = ceil(782.1) = 783`, `A_2 = 626400`, `δ_2 = 720`.
`F = 1473` (≤ `maxDurationFrames` 1800), `Σδ = 960 сэмплов = 40 мс`,
`Σ A_i = 1178400 = frameStartSample(1473)` — разница **0**, `ε_1 = 0`.
Оба `d_i ≥ minSegmentDurationFrames = 45`.

## §В. Ранг слоёв внутри сегмента (проверка, что AC4-b не ложен)

`seg:intro`: `img:b:img-harbour-1` (z=0, ord=1) → `r:a3f19c2b` (z=10, ord=0) → `r:7b20de44` (z=20, ord=38).
`seg:turn`: `r:c81a05f7` (0,79) → `img:b:img-ledger-1` (0,80) → `img:b:img-sea-1` (0,156) →
`r:5d6e1130` (15,111) → `r:e40b7a92` (30,167).
В IR идёт ПОРЯДОК, ординал — нет: он сдвигается при вставке сцены выше и сделал бы AC4-b ложным.

## §Г. Измерения, снятые до плана (ответы на вопросы 7 и часть 8)

* **Вопрос 7 — каноническая форма.** `canonicalJson` живёт в `packages/schema/src/canonical/json.ts`
  и **уже реэкспортирован** `core-model/src/index.ts` (адресный блок `V-03`, вместе с `blake3`).
  Из `compile` потребляется как есть; вторая форма не заводится. `media/cache/canonical.ts` —
  нетстринг для КЛЮЧЕЙ, другая форма для другой цели. Побочно: `canonicalJson` сам отвергает
  `bigint`, `Map`/`Set`, `undefined`, `NaN`, `±Infinity`, `-0` — то есть запрет «никаких
  `Map`/`Set`/`bigint` в IR» охраняется хэшем, а не только тестом.
* **Вопрос 8 — вход измерения.** Матрица `CP-03` §11 («что двигает РАЗБИЕНИЕ») + K4-матрица шага 5
  («что двигает `segmentIrHash`») дадут пересечение. Рекомендацию по view `segment.json` пишу в
  отчёт; `media` в этой задаче не правлю.

---

# ВОПРОСЫ ВЛАДЕЛЬЦУ (плана без них нет; «ок» = принятие рекомендаций)

**1. Seed'ы без манифеста шаблонов.** Рекомендую **(а)**: один seed на клип, `purpose = templateId`
(`'kenburns@1'`), в IR `seeds: { 'kenburns@1': '<16 hex>' }`. `TS-01` объявит настоящие purposes,
карта вырастет без смены формулы. Цена: seed шаблона сменится при появлении purposes — кэш
сегментов инвалидируется один раз, до первого ролика. Долг на `TS-01`.
**1-bis (нашёл при чтении, промпт этого не называет).** У порождённой `[img:]`-записи **нет
`recordId`** — решение владельца `C-05` (долг №21, вариант «а»): она объект модели, а не запись
`direction/1`. Формула ADR-0007 §1 без `recordId` не записывается. Рекомендую: у порождённых
клипов **`seeds: {}`** (пусто) — ничего не выдумываем, `still@1` — статичная картинка, случайность
ей не нужна; настоящий ответ даёт `TS-01` вместе с манифестом шаблона. Тогда на `fixtures/minimal`
seed'ов ровно 5 (по числу клипов записей файла), и D1 проверяем на них. Альтернатива —
подставить в слот `recordId` id неявного бита (`b:img-harbour-1`); отвергаю: это изобретение
правила вывода `recordId`, запрещённое тем же решением `C-05`.

**2. Долг №7 — клип в последней полукадровой зоне** (`frameOfSample(start − segStart) == d_i`):
рекомендую **(а)** — прижать к `[d_i − 1, d_i)` (длительность 1 кадр) с записью; никогда молча,
никогда потеря клипа. Цена: кадр, которого автор «не просил».

**3. Подсветка 0 кадров против T4.** Рекомендую: токен с нулевой подсветкой получает
`highlight: null` + запись; интервалов нулевой длины в IR не существует. Кандидат в правку
ADR-0003 «Субтитры» — в отчёт.

**4. `boundary-correction` — числа или экземпляры.** Рекомендую: `CP-04` отдаёт `δ_i` числами в
манифесте; экземпляры `PlacedSilence(kind:'boundary-correction')` материализует `CP-05` (AudioPlan)
— там они и потребляются. №131 сужается с адресом `CP-05`. Возврат нового Timeline из `compileIr`
отвергаю: это IR, знающий Timeline, — M5 против.

**5. Форма типов** — §А выше.

**6. `AssemblyManifest.audioTrack` до `CP-05`** — рекомендую `null` (поле есть, тип `null`, тип
`AudioTrackRef` заводит `CP-05`) + ассерт `Σ A_i ≤ frameStartSample(F)` уже сейчас.

**7. Каноническая форма** — §Г: измерено, потребляю существующую, вторую не завожу.

**8. №114** — §Г: рекомендация в отчёт, `media` не правлю.

**9. НОВЫЙ (№132 точнее, чем в промпте).** «`d_i ≥ minSegmentDurationFrames` для всех сегментов без
`chapter-forced`» ловит ложным один законный случай: ролик, у которого **вообще нет принятых
разрезов** (единственный сегмент короче порога). Порог — про оверхед старта процесса на сегмент;
у единственного сегмента объединять не с чем. Рекомендую формулировку: ассерт применяется к
сегменту, **обе границы которого — либо край ролика при наличии хотя бы одного принятого разреза,
либо принятый разрез с `reason === null`**; сегменты, у которых хотя бы одна граница —
`chapter-forced`, и случай «разрезов ноль» исключаются по таблице `cutTable`, а не молча.

**10. НОВЫЙ (расхождение промпта с кодом).** Промпт называет `BuildRecord` существующим типом
(`model/entities.ts`) — **его в репозитории нет**: `entities.ts` в шапке пишет «`BuildRecord`/
`PolicyReport` — `G-0x`», `grep 'interface BuildRecord'` по `packages/` пуст. Заводить его в
`core-model` я не вправе (разрешён один файл — `render-ir.ts` — и только типы IR), а выдумывать
форму сущности `G-0x` — проектирование за чужую задачу. Рекомендую: `compileIr` возвращает
`records: readonly IrBuildRecord[]`, тип — **в зоне `compile/src/render-ir/`**, назван как вклад в
будущий `BuildRecord` (`{ rule, segmentId, subject, message }`); долг с адресом `L-01`/`G-0x`.

**11. НОВЫЙ (иначе шаг 3 невыполним).** Seed требует `chapterId`/`sceneId`, а `PlacedClip`
(`compile/src/timeline/types.ts`, `CP-01`) **scope не несёт**: он есть у `PlacedRecord.scope`
(`readDirection`, `C-05`) и теряется при укладке. `compileIr(timeline, …)` взять его неоткуда.
Три выхода: **(а)** добавить `scope: { chapterId, sceneId }` в вариант `ClipFill.kind === 'record'`
— две строки в зоне `timeline` (`types.ts` + `records.ts`, где `record.scope` УЖЕ в руках);
**(б)** расширить сигнатуру `compileIr` входом `records: readonly PlacedRecord[]` — расхождение с
формой, названной в задании; **(в)** выводить scope из `timeline.anchors` — вторая копия резолва
scope, отвергаю. Рекомендую **(а)**: scope — часть идентичности ЗАПИСИ (ADR-0007 §1 берёт его во
вход seed'а), и его потеря в Timeline — потеря, а не решение. Дамп Timeline при этом не меняю.
- `23:36` ЖДУ ВЛАДЕЛЬЦА: план 7 шагов и 11 вопросов записаны ниже черты. Кода не начинаю до «ок». Чтение+зонды заняли 11 минут по стенке

---

- `23:51` [1/7] «ок с поправками» получено. Решения: 1(а) `purpose = templateId`; 1-bis `seeds:{}` у порождённых; 2(а); 3 `highlight:null`+запись; 4 числа в манифесте; 5 §А с П1; 6 `null`+ассерт с печатью разности; 7/8 приняты; 9 №132 через `cutTable`; 10 `IrBuildRecord` в `render-ir/`; 11(а) `scope` в `ClipFill`. Поправки П1–П4 приняты
- `23:51` [1/7] начато: типы `core-model/src/model/render-ir.ts` + реэкспорт, каркас зоны `render-ir/`, зонд долга №1 — ожидаю ~25 мин
- `23:53` [1/7] зонд долга №1 на СВОИХ зонах: `render-ir → timeline` со спецификатором `'../timeline/__probe_target__.js'` — **0 ошибок**; тот же импорт без расширения — **1 ошибка M5**. Долг №1 воспроизведён на паре зон, ради которой правило написано. Начинаю установку резолвера, таймбокс 15 мин
- `00:06` [1/7] готово за 15 мин — типы `render-ir.ts` + реэкспорт; зона `render-ir/` (errors/types/records/metrics/quantize/seeds/hash/build/dump/index); стадия `compile-ir.ts` вне зон; `scope` в `ClipFill` (решение 11). **Долг №1 ЗАКРЫТ:** `eslint-import-resolver-typescript@4.4.5` (версия пришпилена как у остальных devDeps), в `eslint.config.js` — `import/resolver.typescript` первым, node вторым; повторный замер: `.js`-зонд **1 ошибка M5** (было 0), без расширения — 1. Установка+конфиг+замер = **~1.5 мин** из 15 отведённых. Тест M5 расширен на обе формы спецификатора: 6 тестов → 10, зелёные. `typecheck` и `lint` зелёные
- `00:06` [2/7] начато: прогон `compileIr` на `fixtures/minimal`, сверка чисел T6 с расчётными — ожидаю ~10 мин
- `00:11` [2/7] готово за 5 мин — ПЕРВЫЙ ЗЕЛЁНЫЙ ТЕСТ: `render-ir.test.ts` 27/27. Числа T6 на `fixtures/minimal` СОВПАЛИ с расчётными до сэмпла: d=690/783, A=552000/626400, δ=240/720, F=1473, Σδ=960, tail=0, ε_1=0. Расхождение с оценкой: seed'ов **4, а не 5** — клип `bed@1` (трек `music`) в видео-IR не идёт, аудио не сегментируется (ADR-0008, `CROSSING_TRACKS` = caption/visual/effect). D1 проверяется на четырёх
- `00:16` [3/7] готово за 5 мин — `compile-ir.test.ts` 28/28 зелёные (K4-матрица, AC4-b, D1/D2, D7, №132). Измерено попутно: `F` при ДВУХ сегментах = 1473, при одном = 1472 — цена разреза ровно кадр, Σδ 960 против 160
- `00:18` [4/7] и [5/7] готово — греп D2 расширен на второй файл (`render-ir/seeds.ts`) плюс проверка «список файлов полон: другого продакшн-вызывающего `seedOf` нет»: 5 тестов → 8. ПОЛНЫЙ прогон: **100 файлов / 1673 теста зелёные, 90.03 с** (было 98/1611/70.18)
- `00:18` [6/7] начато: протокол нарушений, 6 внесений с откатом из `cp`-резерва — ожидаю ~25 мин
- `00:25` [6/7] готово за 7 мин — протокол нарушений: 6 внесений, все шесть покраснели адресно; `diff -r` резерва с деревом пуст. ГЛАВНОЕ: нарушение 3 (`segmentId` подмешан вызывающим) **покраснело у грепа D2** — в протоколе `C-05` тот же обход оставался зелёным. Заведён третий охранник K4: `tests/lints/k4-pixel-profile.test.ts` (греп по зоне производства IR) — без него нарушение 4 не ловилось ничем, кроме сигнатуры. `typecheck`/`lint`/`test` зелёные: **101 файл / 1676 тестов**
- `00:25` [7/7] начато: отчёт, invariants, DEBTS, перенос журнала — ожидаю ~30 мин
- `00:33` [7/7] готово — отчёт (§1–§12, дамп IR фикстуры целиком), `invariants.md` (шапка + восемь клеток + M5, счёт 44 → 52, проверен грепом), `DEBTS.md` (№1/7/131/132 → `closed`, №38/114/115 сужены измерением, новые №135–139; всего 139 строк), протокол нарушений, журнал перенесён в `docs/impl/CP-04/PROGRESS.md`, корневой очищен
**Итог:** `compileIr` есть; `d_i/A_i/δ_i` на `fixtures/minimal` = 690/552000/240 и 783/626400/720, `F = 1473`, `Σδ = 960` сэмплов (40 мс), хвост 0.
Восемь инвариантов переведены в `guarded` (44 → 52), долг №1 закрыт установкой резолвера, №7/131/132 закрыты, №38/114/115 сужены измерением.
Полный прогон: **101 файл / 1676 тестов зелёные**; `lint` и `typecheck` зелёные. Время по стенке 23:25 → 00:33, первый зелёный тест на 46-й минуте при стоп-правиле 90.
Детали — `docs/impl/CP-04/{report.md, violation-transcript.txt}`.
- `00:36` [7/7] побочный артефакт установки разобран: `pnpm add` вписал в `pnpm-workspace.yaml` заглушку `allowBuilds: unrs-resolver: set this to true or false`. Заглушка не значение — решено измерением: prebuilt подхватывается без postinstall ⇒ `false`, условие пересмотра записано в файле
