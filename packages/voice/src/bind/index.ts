// Стадия `bind` (`V-05`, ADR-0010 §5): интерфейс биндера, правило интервала токена §6,
// дефолтный `provider-timestamps@1`, связка «токен ↔ якорь» и пересчёт привязок из take-файла.
// Публичная поверхность модуля.

export {
  isPronounceable,
  tokenIntervals,
  wordsOf,
  type TokenInterval,
  type Word,
} from './interval.js';

export type { Binder, SourceTokenRef, TakeBind } from './types.js';

export {
  PROVIDER_TIMESTAMPS,
  bindProviderTimestamps,
  providerTimestampsBinder,
  type ProviderTimestampsInput,
} from './provider-timestamps.js';

export {
  anchorIdByToken,
  tokensOfPlan,
  type PlanTokensInput,
} from './tokens.js';

export { rebindTake, type RebindInput } from './rebind.js';
