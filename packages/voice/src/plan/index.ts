// Стадия `plan` (`V-03`): ключи, деление абзаца, `SpeechPlan`, укладка дубля. Публичная
// поверхность модуля.

export {
  canonicalFields,
  int,
  json,
  text,
  type PlanField,
  type PlanFieldKind,
} from './canonical.js';

export {
  CHUNK_KEY_LENGTH,
  NORMALIZER_VERSION,
  TTS_PIPELINE_VERSION,
  chunkKey,
  roleDigest,
  voiceKey,
  type ChunkAddress,
  type VoiceKeyFields,
  type VoiceRolePreset,
} from './keys.js';

export { splitChunkText, type ParagraphPart } from './split.js';

export {
  speechPlan,
  type EffectiveVoice,
  type PlannedChunk,
  type RoleAssignment,
  type SpeechPlan,
  type SpeechPlanInput,
} from './speech-plan.js';

export { TAKES_DIR, renderTakeFile, takeFilePath, writeTakeFile } from './take-file.js';

export {
  recordSpeechPlan,
  type RecordProvenance,
  type RecordSpeechInput,
  type RecordSpeechResult,
  type RecordedTake,
  type SpeechSource,
  type StoreLockValue,
  type VoiceSynthesis,
} from './record.js';
