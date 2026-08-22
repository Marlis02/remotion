# `@vpe/voice`

**Ответственность (карта ADR-0009):** TTS-провайдеры за интерфейсом, приёмка дублей,
`tts:mock@1`, binders.

**Импортирует:** `@vpe/core-model`, `@vpe/media`. **Единственный пакет, которому разрешена
сеть** (**M4**); сетевой binder помечается `requiresNetwork: true`.
**НЕ импортирует:** `hyperframes`/`@hyperframes/*` (**M1**); `gsap` (**M6**);
`react`/`react-dom` (**M2**); `schema` напрямую (через `core-model`), `templates-spec`,
`compile`, `renderer-hyperframes`, `cli`.
