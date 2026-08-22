// Публичная поверхность `@vpe/schema`. Импорты внутри пакета — с расширением `.js`
// (`moduleResolution: NodeNext`, tsconfig.base.json).

// `S-01` — branded-типы, каноническая форма для ХЭША, хэш.
export {
  asBlake3,
  asFrames,
  asSamples,
  asSha256,
  type Blake3,
  type Frames,
  type Samples,
  type Sha256,
} from './types/brands.js';
export { CanonicalJsonError, canonicalJson } from './canonical/json.js';
export { blake3, blake3Bytes } from './hash/blake3.js';
export { BASE32_ALPHABET, base32, base32Decode } from './hash/base32.js';

// `S-02` — реестр семейств, толерантный читатель, канонический писатель для ФАЙЛА.
export {
  FAMILIES,
  FAMILY_NAMES,
  type FamilyEntry,
  type FamilyFormat,
} from './registry.js';
export {
  FamilyReadError,
  readFamily,
  type FamilyHeader,
  type ReadResult,
} from './read.js';
export {
  FamilyWriteError,
  canonicalTextOf,
  checkCanonical,
  renderFamily,
  type CanonicalReport,
  type Difference,
  type DifferenceKind,
} from './write.js';
export { MigrationError, migrate, type MigrationPlan } from './migrate.js';

// Схемы семейств — по одной на файл, все со `.strict()` (кроме `aliases/1`: открытая карта).
export { AliasesSchema, type Aliases } from './families/aliases.js';
export { AnchorEntrySchema, type AnchorEntry } from './families/anchors.js';
export { AssetRecordSchema, type AssetRecord } from './families/asset-record.js';
export { AudioProfileSchema, type AudioProfile } from './families/audio-profile.js';
export { CompileProfileSchema, type CompileProfile } from './families/compile-profile.js';
export { DIRECTION_TRACKS, DirectionSchema, type Direction } from './families/direction.js';
export { ProjectSchema, type Project } from './families/project.js';
export { PublishSchema, type Publish } from './families/publish.js';
export { SourceDialectHeaderSchema, type SourceDialectHeader } from './families/source-dialect.js';
export { StoreLockSchema, type StoreLock } from './families/store-lock.js';
export { VoiceRolesSchema, type VoiceRoles } from './families/voice-roles.js';
export { identifier, isIdentifier } from './families/marks.js';

// `R-02` — семейство `render-profile/1`.
export {
  RENDER_PROFILE_FAMILY,
  RENDER_PROFILE_HEADER,
  RENDER_PROFILE_IDS,
  RENDER_PROFILE_VERSION,
  RenderProfileSchema,
  type RenderProfile,
} from './profiles/render-profile.js';
export { loadRenderProfile } from './profiles/load-render-profile.js';
