# `@vpe/templates-spec`

**Ответственность (карта ADR-0009):** схемы `params`, `declareAssets`/`declareFonts`,
манифест шаблона, реестр easing — **БЕЗ рендерера**.

**Импортирует:** `@vpe/core-model`.
**НЕ импортирует:** рендерер и его библиотеку анимации — `hyperframes`/`@hyperframes/*`
(**M1**), `gsap` (**M6**), `three`; `react`/`react-dom` (**M2**); сеть (**M4**);
`media`, `voice`, `compile`, `renderer-hyperframes`, `cli`. Строка карты сформулирована
через роль («БЕЗ рендерера»), а не через имя кандидата — чтобы следующая смена кандидата её не трогала.

**Диска НЕ ВИДИТ ВОВСЕ** (`node:fs`/`node:path` запрещены охранником
`tests/boundaries/templates-spec-imports.test.ts`): `declareAssets`/`declareFonts` обязаны быть
чистыми, иначе список файлов запроса зависел бы от состояния диска (**R3**).

---

## Манифест собирается из ДВУХ мест (`E-00`, 2026-08-29)

Неизменная часть манифеста (`msPerFrameBudget`, `easingIds`, `purposes`, декларации) —
TS-литерал рядом со спеком в [`src/templates/`](src/templates). Измеренная часть — **записи
гейта** — живёт файлом `<id>@<N>.gates.json` в том же каталоге (решение владельца `H-04`,
вопрос 1, вариант «б»): её пишет ПРОГРАММА (`vpe template gate`), а правка TS-литерала
программой означала бы генерацию кода на каждое снятие гейта.

* форма файла и слияние — [`gates-file.ts`](src/gates-file.ts) (`template-gates/1`,
  `attachGates`, `makeGateFile`, `replaceEntry`); запись файла = `GateRecord` **плюс**
  `bundleHash` (sha256 перечня каталога композиции: отпечаток описывает окружение и молчит о
  коде шаблона);
* **чтение с диска — не здесь**, а в `renderer-hyperframes/src/library.ts`: содержимое файлов
  приезжает сюда ЗНАЧЕНИЕМ (`GateFileSource.text`);
* спек без файла — законен (ноль записей, `UNGATED`); **файл без спека — отказ** с полным
  путём и разобранной парой;
* «запись годится или устарела» — одна функция `gateStaleness` ([`gate.ts`](src/gate.ts)), и
  вход **R12** `assertBuildMayStart` переведён на неё.
