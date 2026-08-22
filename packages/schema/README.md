# `@vpe/schema`

**Ответственность (карта ADR-0009):** zod-схемы, канонический JSON, blake3, branded-типы
(`Samples`/`Frames`/`Sha256`).

**НЕ импортирует:** ни один пакет монорепо (это корень графа); `hyperframes`/`@hyperframes/*`
(M1), `gsap` (M6), `react`/`react-dom` (M2), сеть — `node:http`/`node:https`/`undici`/`ws`/`fetch` (M4).

## Что уже есть

| путь | что | задача |
|---|---|---|
| `src/profiles/render-profile.ts` | схема семейства `render-profile/1` (`.strict()` на каждом уровне) + `loadRenderProfile(path)` | `R-02` |
| `test/render-profile.test.ts` | охранники **P10** (`guarded`), **K6** (часть профилей), **P16** (это семейство) и критерия готовности `R-02` | `R-02` |
| `src/types/brands.ts` | `Samples`, `Frames`, `Sha256`, `Blake3` + конструкторы-валидаторы (`Number.isSafeInteger`, строчный hex 64) | `S-01` |
| `src/canonical/json.ts` | `canonicalJson` — сортировка ключей байтами UTF-8, кратчайшие числа, отказ с путём | `S-01` |
| `src/hash/blake3.ts`, `src/hash/base32.ts` | `blake3`/`blake3Bytes`, `base32`/`base32Decode` (RFC 4648, строчные, без паддинга) | `S-01` |
| `test/{brands,canonical-json,hash}.test.ts` | property-тесты канонизации, официальные векторы BLAKE3 и RFC 4648 | `S-01` |

**Зависимости — три, все прямые:** `zod` 4.4.3 (Charter §6), `yaml` 2.9.0 — парсер **YAML 1.2**
(`js-yaml` брать нельзя: он YAML 1.1, где `no`/`yes` становятся boolean, а `04:30` — числом 270,
то есть ровно «ядовитые значения» P16 приходят в схему уже приведёнными),
`@noble/hashes` 2.3.0 — blake3 чистым JS без нативной сборки и без WASM-блоба: иначе появился бы
бинарный компонент, влияющий на байты и не входящий в `engineFingerprint` (ADR-0006 §3, R14).

**`JSON.stringify` в `packages/**/src` запрещён линтом.** Единственное исключение —
`src/canonical/json.ts` (экранирование строк по ECMA-262). Каноническая форма — вход `blake3`,
то есть вход всех ключей кэша; тихое приведение здесь означает две величины с одним ключом.

**Чтение шапки `schema: <family>/N` здесь — заглушка** (`split('/')` + строгое равенство).
Толерантный читатель семейств — задача `S-02`, и она эту заглушку заменяет, а не дополняет.
