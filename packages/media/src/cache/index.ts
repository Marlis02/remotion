// Кэш стадий и ключи (`M-05`). Публичная поверхность модуля.
//
// ТРИ СТАДИИ И НИ ОДНОЙ ЧЕТВЁРТОЙ (ADR-0006 Decision 1): `voice`, `compose`, `segment`.
// `voiceKey` здесь НЕ считается — он живёт в `@vpe/voice` (стрелки `media → voice` нет);
// отсюда приходят каноническая форма его входа, его `cacheKeyView` и проектор, то есть всё
// общее у трёх ключей.

export { canonicalFields, int, json, text, type PlanField, type PlanFieldKind } from './canonical.js';
export { CacheError, type CacheRule } from './errors.js';
export {
  composeKey,
  segmentKey,
  verifyComposition,
  type ComposeKeyInput,
  type CompileProfileInput,
  type FpsInput,
  type PixelProfileInput,
  type SegmentKeyInput,
} from './keys.js';
export {
  CACHE_DIR,
  MANIFEST_NAME,
  assertKeyShape,
  cacheManifestPath,
  cacheNamespaceDir,
  cacheValuePath,
  isProfileScoped,
  type CacheAddress,
} from './layout.js';
export {
  familyFieldPaths,
  familyLeaves,
  mutantsOfFamily,
  schemaLeaves,
  type Mutant,
  type MutationSet,
  type SchemaLeaf,
  type SkippedMutation,
} from './mutants.js';
export {
  StageCache,
  type CacheManifest,
  type CacheManifestEntry,
  type CachePutMeta,
  type StageCacheOptions,
} from './stage-cache.js';
export {
  assertCacheKeyViewShape,
  cacheKeyView,
  keyOf,
  projectFields,
  projectionOf,
  renderCacheKeyView,
  type CacheKeyView,
  type CacheKeyViewExclusion,
  type CacheKeyViewField,
  type CacheKeyViewUpstream,
  type CacheStage,
  type KeyInputs,
  type ViewFieldKind,
} from './views.js';
