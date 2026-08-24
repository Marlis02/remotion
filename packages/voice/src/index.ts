// Публичная поверхность `@vpe/voice` (карта ADR-0009: TTS-провайдеры за интерфейсом, приёмка
// дублей, `tts:mock@1`, binders).
//
// `V-01` — интерфейс провайдера, capabilities и `tts:mock@1` (перенос SP-2, блок 8).
// Приёмка дубля целиком (`V-02`), `chunkKey`/`voiceKey` (`V-03`), акустическая обрезка T7
// (`V-04`), стадия `bind` и take-файл (`V-05`) и живой провайдер (`V-06`) — впереди.

export { VoiceError, type VoiceRule } from './errors.js';

export type {
  PcmFormat,
  ProviderAlignment,
  RequestStitching,
  SeedSupport,
  Take,
  TakeHealth,
  TakeProvenance,
  TimestampDomain,
  TimestampUnit,
  TokenBinding,
  TtsCapabilities,
  TtsProvider,
  TtsRequest,
  TtsResponse,
  VoiceCategory,
} from './providers/types.js';

export { ttsRequest, type TtsRequestFields } from './providers/request.js';

export {
  PCM_FORMAT_SAMPLE_RATE,
  assertOriginalDomain,
  needsForcedAlignment,
  pcmFormatFor,
  sampleRateOfPcmFormat,
  stitchingMode,
} from './providers/capabilities.js';

export { providerSecondsToSamples } from './providers/time.js';

export {
  MOCK_PROFILE,
  MOCK_SAMPLE_RATE,
  capabilities,
  makeTake,
  mockProvider,
  schedule,
  synthPcm,
  synthesize,
  takeHealth,
  tokenIntervals,
  type MakeTakeFields,
  type MockPcm,
  type MockProfile,
  type MockSchedule,
  type MockSynthesis,
  type MockSynthesizeOptions,
  type TakeHealthOptions,
  type TokenInterval,
} from './providers/mock.js';
