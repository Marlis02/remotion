# `@vpe/core-model`

**Ответственность (карта ADR-0009):** сущности ADR-0001, типы времени, лексер/линт/span-map,
ledger якорей.

**Импортирует:** `@vpe/schema`.
**НЕ импортирует:** `node:fs`/`fs`/`fs/promises` — модель не умеет читать диск (**M3**);
сеть (**M4**); `hyperframes`/`@hyperframes/*` (**M1**); `gsap` (**M6**);
`react`/`react-dom` (**M2**); `media`, `voice`, `templates-spec`, `compile`, `renderer-hyperframes`, `cli`.

---

## Модель времени: что здесь, чего здесь нет

Задача `C-01` (roadmap §4.3). Исполнимая форма правил **T1, T2, T4** ADR-0003 и типов времени
авторского слоя ADR-0001.

### Что здесь

| модуль | что даёт |
|---|---|
| `src/time/integer.ts` | `floorDiv`, `ceilDiv` (точные, знак любой), `mulExact`, `addExact`, `assertSafeInteger` |
| `src/time/rational.ts` | `Rational {num, den}` — сокращённая дробь, `den > 0` |
| `src/time/grid.ts` | `Fps {num, den}`, `TimeGrid {sampleRate, fps}`, `timeGrid()`, `assertTimeGrid()` |
| `src/time/ms.ts` | `msToSamples(ms, sampleRate)` — **единственная** функция перевода (T1) |
| `src/time/frames.ts` | `samplesPerFrame`, `frameStartSample`, `frameLengthInSamples`, `frameOfSample`, `clipDurationInFrames` (T2, T3) |
| `src/time/interval.ts` | `SampleInterval`/`FrameInterval` как `[start, end)`, `assertClipWithinSegment`, `assertT4` (T4) |
| `src/time/timepoint.ts` | `TimePoint` (три варианта), `Duration`, `assertRealizable` (ADR-0001) |
| `src/time/errors.ts` | `TimeModelError` — ошибка называет ПРАВИЛО, а не следствие |

Три вещи, которые стоит знать до чтения кода:

* **Секунд в API нет.** Ни на входе, ни на выходе, ни в имени. Миллисекунды — сахар авторского
  слоя и живут ровно в `msToSamples`; всё остальное — сэмплы и кадры, оба брендированы.
* **Умножение — вызов, а не оператор.** T2 требует проверять `Number.isSafeInteger` на каждом
  промежуточном произведении, а у оператора `*` нет места, куда встроить проверку. Поэтому
  `mulExact(a, b, 'f · sampleRate')`, и поэтому в сообщении об ошибке стоит **имя величины**.
* **Умолчаний нет.** `fps = {30, 1}` и `sampleRate = 24000` — поля `compileProfile`, то есть
  часть произведения (ADR-0003, «fps = 30 — решение, а не умолчание»). Ни одна функция их
  не подставляет: сетка передаётся целиком.

### Чего здесь нет — и где это будет

| чего нет | почему | где |
|---|---|---|
| **ledger якорей**, вычисление абсолютного сэмпла по `anchor` | форму ledger'а `C-01` за него не решает | `C-04` |
| **укладчик клипов** — правило, по которому `frameStart` не выходит за сегмент | ADR-0003 задаёт ПРОВЕРКУ T4, но не правило укладки; выдумывать его здесь значило бы решать за ADR (Charter §7) | `CP-04` |
| **квантование T3 относительно сегмента** (`localFrame(x) = frameOfSample(x − segmentStartSample)`) | сегментов ещё нет; `frameOfSample` здесь абсолютен | `CP-04` / `C-05` |
| **сегментация T5–T6** (`L_i`, `d_i`, `A_i`, `δ_i`, `boundary-correction`) | требует Timeline | `CP-*` |
| **принудительный 1 кадр + запись в BuildRecord** при нулевой длительности (T3) | это правило укладчика; здесь нулевой интервал просто непредставим | `CP-04` |
| **перевод кадров в секунды** для рендерера | обязанность адаптера, и он обязан его доказывать (ADR-0003 T4 после SP-3) | `H-*` |
| **`AnchorId` как бренд** | бренд без единственного конструктора-валидатора не даёт ничего, а конструктор живёт там, где якоря минтятся | `C-04` |

### Два линта, заведённые этой задачей

Оба — в корневом `eslint.config.js`, оба действуют **везде, включая тесты**:

* **T1** — `* sampleRate` и `/ 1000`. Единственное исключение: `src/time/ms.ts`.
* **Бренды** (`S-01` долг №3) — `as Samples` / `as Frames` / `as Sha256` / `as Blake3`.
  Единственное исключение: `packages/schema/src/types/brands.ts`.

Охранники самих линтов — `tests/lints/`: греп по дереву, программный ESLint по временному
файлу-нарушителю и проверка, что исключение **не мёртвое** и **узкое** (сосед по каталогу
под правилом остаётся).
