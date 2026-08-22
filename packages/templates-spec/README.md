# `@vpe/templates-spec`

**Ответственность (карта ADR-0009):** схемы `params`, `declareAssets`/`declareFonts`,
манифест шаблона, реестр easing — **БЕЗ рендерера**.

**Импортирует:** `@vpe/core-model`.
**НЕ импортирует:** рендерер и его библиотеку анимации — `hyperframes`/`@hyperframes/*`
(**M1**), `gsap` (**M6**), `three`; `react`/`react-dom` (**M2**); сеть (**M4**);
`media`, `voice`, `compile`, `renderer-hyperframes`, `cli`. Строка карты сформулирована
через роль («БЕЗ рендерера»), а не через имя кандидата — чтобы следующая смена кандидата её не трогала.
