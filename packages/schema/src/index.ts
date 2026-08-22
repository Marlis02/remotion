// Публичная поверхность `@vpe/schema`. Импорты внутри пакета — с расширением `.js`
// (`moduleResolution: NodeNext`, tsconfig.base.json).

export {
  RENDER_PROFILE_FAMILY,
  RENDER_PROFILE_HEADER,
  RENDER_PROFILE_IDS,
  RENDER_PROFILE_VERSION,
  RenderProfileSchema,
  loadRenderProfile,
  type RenderProfile,
} from './profiles/render-profile.js';
