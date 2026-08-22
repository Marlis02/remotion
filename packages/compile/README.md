# `@vpe/compile`

**Ответственность (карта ADR-0009):** `timeline`, Policy Guard (ruleset — **данные**,
не захардкоженные цитаты), `render-ir`.

**Импортирует:** `@vpe/core-model`, `@vpe/media`, `@vpe/voice`, `@vpe/templates-spec`.
**НЕ импортирует:** `hyperframes`/`@hyperframes/*` (**M1**); `gsap` — иначе easing вычислялся бы
в двух местах (**M6**); сеть (**M4**); `react`/`react-dom` (**M2**); `renderer-hyperframes`, `cli`.
**Внутренняя граница (M5):** `src/render-ir/**` не импортирует `src/timeline/**` и наоборот —
«IR не знает Timeline» (ADR-0009, Риски).
