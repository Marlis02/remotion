# `R-01` — скелет монорепо и тесты границ. Отчёт сессии

* **Дата:** 2026-08-22. **Задача:** [docs/roadmap.md](../../roadmap.md) §3, §4.1 `R-01`.
* **Статус:** выполнено. `pnpm install` / `pnpm lint` / `pnpm typecheck` / `pnpm test` — зелёные.
* **Переводит в `guarded`:** **M1, M2, M3, M4, M5, M6** — первый переход `named → guarded`
  в проекте (было 0, стало 6; счёт «0 `guarded` из 99 строк» — roadmap §1).
* **Журнал сессии:** [PROGRESS.md](PROGRESS.md). **Протокол падений:**
  [violation-transcript.txt](violation-transcript.txt).

---

## 1. Что появилось в репозитории

| путь | что |
|---|---|
| `pnpm-workspace.yaml` | `packages/*` |
| `package.json` | корень, `private`, `type: module`, скрипты `test`/`lint`/`typecheck`/`build`/`clean`, `packageManager: pnpm@11.9.0`, `engines.node: 25.6.1` |
| `.nvmrc` | `25.6.1` |
| `tsconfig.base.json` | `strict: true` + `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `isolatedModules`, `composite: true` |
| `tsconfig.json` | solution-файл: `files: []`, девять `references` (8 пакетов + `tests`) |
| `eslint.config.js` | flat config: `import/no-restricted-paths` (M5), `no-restricted-imports` (M3/M4), `no-restricted-globals` (M4 + `Intl`), `no-restricted-properties`/`no-restricted-syntax` (V8/D4) |
| `vitest.config.ts` | `fileParallelism: false` — тесты границ пишут временные файлы в `packages/**` |
| `packages/<8>/` | `package.json`, `tsconfig.json`, `src/index.ts` (`export {};`), `README.md` |
| `packages/compile/src/{render-ir,timeline}/.gitkeep`, `packages/media/src/{cache,audio}/.gitkeep` | пустые каталоги внутренних границ — правило M5 исполнимо с первого дня |
| `tests/boundaries/` | `repo.ts` + шесть тестов инвариантов + `adr0009-graph.test.ts` |
| `.gitignore` | дописаны `dist/`, `*.tsbuildinfo`, `.cache/`, `build/`; существующие строки не тронуты |

**Node — `v25.6.1`** (`FACT`: то, что стоит на машине; nvm default, рядом лежит `v24.14.0`).
Пришпилен точно, без диапазона, и в `.nvmrc`, и в `engines`. **pnpm — `11.9.0`.**

### Граф зависимостей — строго по стрелкам ADR-0009

```
schema               → —
core-model           → schema
media                → schema, core-model
voice                → core-model, media
templates-spec       → core-model
compile              → core-model, media, voice, templates-spec
renderer-hyperframes → core-model, templates-spec
cli                  → все семь
```

Лишних стрелок нет; охраняется `tests/boundaries/adr0009-graph.test.ts` (он же проверяет
отсутствие циклов и то, что `renderer-hyperframes` зависит от `core-model`, **а не от `compile`**).

### Внешние зависимости

**В `R-01` не ставится ни одной** — ни `zod`, ни `hyperframes`, ни `gsap`, ни `three`, ни
`puppeteer`. Это часть задания и часть смысла: тесты границ обязаны проверяться на пустом дереве
раньше, чем появится что проверять. Инструменты — семь, все **точными** версиями без `^`
(первый шаг к R14):

| пакет | версия | зачем |
|---|---|---|
| `typescript` | `5.9.3` | сборка и `typecheck`. **Не `7.0.2`:** peer-диапазон `typescript-eslint` — `>=4.8.4 <6.1.0` |
| `vitest` | `4.1.11` | тесты |
| `eslint` | `9.39.5` | линт. **Не `10.x`:** peer-диапазон `eslint-plugin-import` кончается на `^9` |
| `eslint-plugin-import` | `2.32.0` | `import/no-restricted-paths` — охранник M5, назван в ADR-0009 поимённо |
| `typescript-eslint` | `8.67.0` | без парсера ESLint не читает `.ts`, и ни один охранник не работает *(6-й инструмент, согласован отдельно)* |
| `cross-env` | `10.1.0` | `TZ=UTC` и `LC_ALL=C` в скриптах, а не в `.bashrc` (ADR-0007 §4) |
| `@types/node` | `24.13.3` | типы `node:`-модулей для тестов границ; без них `pnpm typecheck` на `tests/` невозможен |

---

## 2. `TZ=UTC` / `LC_ALL=C` — ADR-0007 §4

Во **всех** скриптах, через `cross-env`, а не через окружение разработчика:

```json
"test":      "cross-env TZ=UTC LC_ALL=C vitest run",
"lint":      "cross-env TZ=UTC LC_ALL=C eslint .",
"typecheck": "cross-env TZ=UTC LC_ALL=C tsc --build",
"build":     "cross-env TZ=UTC LC_ALL=C tsc --build",
"clean":     "cross-env TZ=UTC LC_ALL=C tsc --build --clean"
```

---

## 3. Критерий готовности: каждый охранник показан **падающим**

Это главное требование задания: «"написал тест" без этого показа — не готово». Полные вывод и
сообщения — [violation-transcript.txt](violation-transcript.txt). Каждое нарушение вносилось
руками, прогонялся ровно тот тест, что его охраняет, затем нарушение откатывалось.

| # | инвариант | ручное нарушение | результат |
|---|---|---|---|
| 1 | **M1** | `hyperframes: 0.8.5` в `devDependencies` `media` | 2 теста упали: «`hyperframes` разрешён только в `@vpe/renderer-hyperframes` и `@vpe/cli`. Найдено: `packages/media/package.json → devDependencies.hyperframes`» |
| 1 | **M1** (lockfile) | то же + `pnpm install --lockfile-only` | +1 тест: «в pnpm-lock.yaml hyperframes объявлен посторонним пакетом: `packages/media → hyperframes`» |
| 2 | **M2** | `react: 19.2.0` в `devDependencies` `schema` | упал: «Найдено: `packages/schema/package.json → devDependencies.react@19.2.0`» |
| 2 | **M2** (lockfile) | то же + `pnpm install --lockfile-only` | +1 тест: «в pnpm-lock.yaml присутствует react» |
| 2a | **M6** | `gsap: 3.15.0` в `dependencies` `compile` | 2 теста упали, второй — именной: «протечка gsap в `compile`» |
| 2a | **M6** (lockfile) | то же + `pnpm install --lockfile-only` | +1 тест: «gsap объявлен посторонним пакетом: `packages/compile → gsap`» |
| 3 | **M3** (греп) | `import fs from "node:fs"` в `packages/core-model/src/index.ts` | упал: «`core-model` не умеет читать диск. Перенесите работу с файлами в `media`. Найдено: `packages/core-model/src/index.ts → "node:fs"`» |
| 3 | **M3** (ESLint) | `FS_PATHS` убран из `no-restricted-imports` для `core-model` | упал: «Охранник M3 в eslint.config.js молчит на прямом нарушении» |
| 7 | **M4** (греп, импорт) | `import { request } from "undici"` в `media` | упал: «сеть разрешена только в `voice`. Найдено: `packages/media/src/index.ts → "undici"`» |
| 7 | **M4** (греп, глобал) | `fetch("…")` в `compile` | упал: «`fetch` как глобал — тоже сеть, и импортом он не виден» |
| 7 | **M4** (ESLint) | `NETWORK_GLOBALS` убраны из `no-restricted-globals` | упал: «`fetch` не ловится `no-restricted-imports`, и без `no-restricted-globals` сеть протекает мимо теста» |
| 5 | **M5** | `import/no-restricted-paths` переведён в `off` — **ровно тот риск, что назван в ADR-0009 Consequences** | упали все четыре направления обеих зон |
| 5 | **M5** (тихий отказ) | `.ts` убран из `settings['import/resolver'].node.extensions` | упали те же четыре: правило перестаёт срабатывать **молча**, и тест это ловит |
| — | граф ADR-0009 | `@vpe/compile` добавлен в `dependencies` `renderer-hyperframes` | упал: «Граф ADR-0009 нарушен у `renderer-hyperframes`» |
| — | **V8 / D4** | `Math.random`, `Date.now`, `new Date`, `toLocaleString`, `localeCompare`, `Intl.Segmenter` в `packages/schema/src` | `eslint` дал **7 ошибок**, по одной на каждую конструкцию (`Intl` ловится дважды — глобалью и селектором) |

**Про строку «M5 (тихий отказ)».** `import/no-restricted-paths` выходит из проверки **раньше зон**,
если спецификатор не разрешился в существующий файл. Из этого следуют два решения, оба сознательные:

1. в `settings` явно перечислены расширения `['.ts', '.tsx', '.js', '.json']` — иначе node-резолвер
   не увидит ни одного `.ts`, и правило будет молчать при полностью корректном конфиге;
2. тест M5 создаёт **два** файла — нарушителя и цель импорта, — иначе он был бы зелёным даже при
   снятом правиле. Второй файл здесь не удобство, а условие осмысленности теста.

После каждого прогона нарушение откатывалось; в конце — сверка с бэкапами (`diff` по всем
`package.json`, `src/index.ts`, `eslint.config.js`, `pnpm-lock.yaml`) и поиск оставшихся временных
файлов: расхождений нет, `pnpm install --frozen-lockfile` проходит.

---

## 4. Что записано в документы

**`docs/invariants.md`** — M1…M6 переведены в `guarded`, в колонке «Охранник» стоит имя файла.
В шапку добавлена строка о том, что это **первый** переход `named → guarded` в проекте; фраза
легенды «сейчас кода нет, поэтому все механические охранники в статусе `named`» зачёркнута и
заменена — она перестала быть верной.

**Два хвоста (§3 задания) — приведение, не решения:**

1. **ADR-0001, строка `Track`** — список дополнен `voice` с пометкой «добавлено: RM2, решение
   владельца 1, 2026-08-22 — директивный трек, клипа Timeline не порождает, питает SpeechPlan;
   форма — ADR-0010 §3a-bis». Закрывает рассогласование ADR-0001 ↔ ADR-0010.
2. **Charter §6, ревизия 7** — решение владельца по долгу 3: вариант (а). Фраза «всё три величины
   в профиле» зачёркнута, на её месте: «`--no-browser-gpu` и `workers` — в профиле; версия
   `chrome-headless-shell` — в lockfile/`vendor/`, охраняется инвариантом R14; в профиле полей
   версий нет (K6)». Строка «Ревизия 7» добавлена в шапку Charter. В `rm1-closure.md` долг 3
   зачёркнут («закрыт вариантом (а), ревизия 7»), абзац «Вопрос владельцу: какой из трёх» — тоже.
   В **ADR-0006 §5** и в **roadmap `R-02`** пометка «противоречие вынесено владельцу» снята.
   Попутно там же датирована цитата Charter («до ревизии 7») — иначе оба документа цитировали бы
   формулировку, которой больше нет.

---

## 5. Известные ограничения — честно

1. **`engines.node: "25.6.1"` — предупреждение, а не отказ.** pnpm по умолчанию не включает
   `engine-strict`, поэтому установка на другой версии Node пройдёт с warning'ом. Сделать пин
   исполнимым — одна строка `engine-strict=true` в `.npmrc`, но это **решение** (кто угодно на
   другой машине перестанет собирать), и в задании его нет. **Предложение отдельной задачей.**
2. **Внутренние границы M5 держатся на ESLint и снимаются строкой `// eslint-disable`.** Это
   записано в ADR-0009, Consequences как принятая цена. Смягчение — правило в CI; CI в репозитории
   ещё нет, значит сейчас смягчения нет тоже. Первый момент, когда это становится дорого, — рост
   `compile`; признак протечки назван в ADR-0009 («если `render-ir` начнёт импортировать `timeline`»).
3. **`import/no-restricted-paths` проверен только на импортах без расширения** (`../timeline/x`).
   Когда в пакетах появится реальный код, `moduleResolution: NodeNext` потребует писать
   `../timeline/x.js`, и node-резолвер такой путь **не** сопоставит с `x.ts` — правило снова начнёт
   молчать. Признак наступления: первый настоящий кросс-модульный импорт внутри `compile`/`media`.
   Лечение известно и стоит одну зависимость (`eslint-import-resolver-typescript`); заводить её
   в `R-01` не за что — проверять нечего. **Записано, чтобы не всплыло сюрпризом.**
4. **Lockfile-половина M1 и M6 в штатном прогоне не исполняется:** `hyperframes` и `gsap` не
   установлены, тест на этом месте делает ранний возврат. Она **проверена** отдельно
   (`pnpm install --lockfile-only`, §3), но до `H-01`/`E-00` в зелёном прогоне не участвует.
5. **`no-restricted-syntax` на `new Date()` не ловит `Date.parse` и `structuredClone`-обходы** —
   линт статический и обходится. Вторая половина охранника D4 (runtime-guard, заморозка глобалей
   в entry рендера) — задача `H-05`; поэтому **D4 остаётся `named`**, и это правильно.
6. **ESLint-охранники M3/M4 живут в корневом `eslint.config.js`, а не в конфиге каждого пакета.**
   Задание допускало «в tsconfig/eslint пакета»; flat config делает per-package файлы избыточными,
   а видимость правила в одном месте — выше. Правила прицелены на `files:` конкретного пакета.
7. **`docs/roadmap.md` §9 п. 1 (журнал дрейфа) всё ещё содержит фразу «вынесено владельцу».**
   §9 объявлен «записью о том, что было найдено и чем закрыто», то есть исторической, а задание
   называло ровно два места (ADR-0006 §5 и `R-02`) — поэтому строка **не тронута**.
   Правка — на решение владельца; **предложение отдельной задачей.**
8. **`pnpm test` зелёный на пустых пакетах — это ровно то, что заявлено, и не больше.** Ни одной
   строки продуктового кода в `packages/*/src` нет, кроме `export {};`. Всё, что охраняется, —
   раскладка и границы.

---

## 6. Время по стенке

**Сессия заняла 24 минуты по стенке** (11:12 → 11:36 локального времени), из них ≈ 20 мин — чтение входа
(Charter, `CLAUDE.md`, roadmap §0–§3/§4.1, ADR-0009 целиком, `invariants.md` §8, ADR-0007 §4,
ADR-0001, ADR-0006 §5, `rm1-closure.md`, `sp3c/package.json`, `sp3f/results/machine.json`).
Платных вызовов — **ноль**; сеть — только реестр npm.

Оценка roadmap для `R-01` — **1 сессия**; фактически — **1 сессия**. Это **первая измеренная
точка** для поправки оценок (§11.2 п. 1). Признак ошибки оценки, названный в `rm1-closure.md`
(«первые три задачи `R-01`, `S-01`, `S-02` дали суммарно заметно больше 3 сессий»), пока **не**
наступил — но одна точка коэффициента не даёт, и выводить его из неё нельзя.
