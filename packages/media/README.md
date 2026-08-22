# `@vpe/media`

**Ответственность (карта ADR-0009):** CAS-store, assets + provenance + aliases, кэш,
PCM/микрофейды/микс, ffmpeg-сборка (`concat` + mux).

**Импортирует:** `@vpe/schema`, `@vpe/core-model`.
**НЕ импортирует:** `hyperframes`/`@hyperframes/*` — склейка только ffmpeg, и вопрос
`combineChunks()` закрыт дважды (**M1**); сеть (**M4**); `gsap` (**M6**);
`react`/`react-dom` (**M2**); `voice`, `templates-spec`, `compile`, `renderer-hyperframes`, `cli`.
**Внутренняя граница (M5):** `src/cache/**` не импортирует `src/audio/**` и наоборот.
