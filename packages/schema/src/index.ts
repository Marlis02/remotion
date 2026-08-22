// Публичная поверхность `@vpe/schema`. Импорты внутри пакета — с расширением `.js`
// (`moduleResolution: NodeNext`, tsconfig.base.json).

// `S-01` — branded-типы, каноническая форма, хэш.
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

// `R-02` — семейство `render-profile/1`.
export {
  RENDER_PROFILE_FAMILY,
  RENDER_PROFILE_HEADER,
  RENDER_PROFILE_IDS,
  RENDER_PROFILE_VERSION,
  RenderProfileSchema,
  loadRenderProfile,
  type RenderProfile,
} from './profiles/render-profile.js';
