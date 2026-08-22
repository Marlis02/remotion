# `@vpe/core-model`

**Ответственность (карта ADR-0009):** сущности ADR-0001, типы времени, лексер/линт/span-map,
ledger якорей.

**Импортирует:** `@vpe/schema`.
**НЕ импортирует:** `node:fs`/`fs`/`fs/promises` — модель не умеет читать диск (**M3**);
сеть (**M4**); `hyperframes`/`@hyperframes/*` (**M1**); `gsap` (**M6**);
`react`/`react-dom` (**M2**); `media`, `voice`, `templates-spec`, `compile`, `renderer-hyperframes`, `cli`.
