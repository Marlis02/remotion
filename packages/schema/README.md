# `@vpe/schema`

**Ответственность (карта ADR-0009):** zod-схемы, канонический JSON, blake3, branded-типы
(`Samples`/`Frames`/`Sha256`).

**НЕ импортирует:** ни один пакет монорепо (это корень графа); `hyperframes`/`@hyperframes/*`
(M1), `gsap` (M6), `react`/`react-dom` (M2), сеть — `node:http`/`node:https`/`undici`/`ws`/`fetch` (M4).
