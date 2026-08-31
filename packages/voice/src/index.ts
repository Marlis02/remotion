// Публичная поверхность `@vpe/voice` (карта ADR-0009: TTS-провайдеры за интерфейсом, приёмка
// дублей, `tts:mock@1`, binders).
//
// `V-01` — интерфейс провайдера, capabilities и `tts:mock@1` (перенос SP-2, блок 8).
// `V-02` — приёмка дубля целиком (`acceptance/`): метрики и вердикт, пороги из профиля,
// диагностика отказа с `codePointDiff`, лестница ретраев «ретрай ×N → падение сборки» (M12).
// `V-03` — стадия `plan` (`plan/`): инъективная каноническая форма входа ключей, `chunkKey`,
// `voiceKey`, `roleDigest`, структурное деление длинного абзаца, `SpeechPlan` и укладка дубля
// (PCM в CAS `kind: voice`, take-файл `voice/takes/<chunkKey>.json`, запись в `store.lock`).
// `V-04` — акустическая обрезка T7 (`edges/`): границы речи из PCM по RMS с параметрами из
// профиля, признак смены поведения провайдера.
// `V-05` — стадия `bind` (`bind/`): интерфейс `Binder` (ADR-0010 §5), правило интервала токена
// §6, дефолтный `provider-timestamps@1`, связка «токен исходника ↔ якорь `w:`» и пересчёт
// привязок из одного take-файла. Живой провайдер (`V-06`) — впереди.
// `M-05` — межсборочный кэш стадии `voice` (`plan/voice-cache.ts`): попадание в УЖЕ ОПЛАЧЕННЫЙ
// дубль прошлой сборки, `voiceKey` полем take-файла и пересборка манифеста сканом дублей.
// Каноническая форма входа ключей переехала в `@vpe/media` (`plan/canonical.ts` — реэкспорт).

export { VoiceError, type VoiceRule } from './errors.js';

export type {
  PcmFormat,
  ProviderAlignment,
  RequestStitching,
  SeedSupport,
  Take,
  TakeHealth,
  TakeProvenance,
  TakeRejectReason,
  TimestampDomain,
  TimestampUnit,
  TokenBinding,
  TokenBindingStatus,
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

export { providerSecondsToSamples, tailResidualSlopSamples } from './providers/time.js';

// --- приёмка дубля (`V-02`, перенос `sp2/lib/analyze.mjs`) -------------------

export {
  assessTake,
  charIdentityReport,
  codePointDiff,
  explainRejection,
  timeAt,
  type CharIdentityReport,
  type CodePointDiff,
  type LengthUnit,
  type MultiUnitElement,
  type TakeAcceptance,
  type TakeAssessment,
  type TakeRejection,
} from './acceptance/health.js';

export {
  acceptTakeWithRetries,
  type AcceptTakeInput,
  type AcceptedTake,
  type TakeAttempt,
  type TakeAttemptRequest,
  type TakeSource,
} from './acceptance/ladder.js';

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
  type MakeTakeFields,
  type MockPcm,
  type MockProfile,
  type MockSchedule,
  type MockSynthesis,
  type MockSynthesizeOptions,
} from './providers/mock.js';

// --- живой провайдер (`V-06`) ------------------------------------------------
// Сеть у пакета приезжает ВХОДОМ (`HttpTransport`), а не глобалью: `packages/voice/src/**`
// по-прежнему исполним в тестовом контуре без сети и без ключа (**V9**). Реализацию транспорта
// подаёт граница процесса — `packages/cli/bin/http.ts`, — и только при `ELEVENLABS_LIVE=1`.

export { redactSecrets, type HttpRequest, type HttpResponse, type HttpTransport } from './providers/http.js';

export {
  ELEVENLABS_API_BASE,
  ELEVENLABS_MODEL,
  capabilities as elevenLabsCapabilities,
  elevenLabsBody,
  elevenLabsProvider,
  elevenLabsUrl,
  parseElevenLabsResponse,
  type ElevenLabsBody,
  type ElevenLabsOptions,
} from './providers/elevenlabs.js';

export {
  accountSnapshot,
  assertBilledRate,
  billedInWindow,
  checkBilledRate,
  expectedBilled,
  planTier,
  voiceCategory,
  type AccountOptions,
  type AccountSnapshot,
  type BilledRateCheck,
  type BilledRateReport,
  type BilledRateVerdict,
  type UsageWindow,
} from './providers/usage.js';

export {
  knownProviderIds,
  providerCapabilities,
  providerFor,
  type ProviderEntry,
  type ProviderRuntime,
} from './providers/registry.js';

export { providerSpeechSource, type ProviderSpeechSourceInput } from './providers/source.js';

// --- акустическая обрезка T7 (`V-04`, перенос `sp2/t7-prod.mjs` + `acoustic-prod.mjs`) ------

export * from './edges/index.js';

// --- стадия `plan` (`V-03`) --------------------------------------------------

export * from './plan/index.js';

// --- стадия `bind` (`V-05`) --------------------------------------------------
// `tokenIntervals`/`TokenInterval` вывозятся ОТСЮДА, а не из `providers/mock.js`, как в
// `V-01`–`V-04`: правило интервала токена (ADR-0010 §6) переехало вместе со своей стадией.
// Имена и формы при этом те же — публичная поверхность пакета не рвётся.

export * from './bind/index.js';
