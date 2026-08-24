// `M-04` — сборка ffmpeg: сегменты `h264`/MPEG-TS без аудио, конкат `-c copy`, единственный
// энкод аудио при муксе, измеренный `StreamFingerprint`, `framemd5` под флагом.
// Публичная поверхность модуля.

export { AssembleError, type AssembleRule } from './errors.js';
export {
  DEFAULT_FFPROBE_PATH,
  FINGERPRINT_FIELDS,
  FfprobeError,
  countPacketsArgs,
  parseFrameCount,
  parseHasAudio,
  parseKeyframeIndices,
  parseStreams,
  parseVideoFingerprint,
  probeColorRange,
  probeFrameCount,
  probeHasAudio,
  probeKeyframeIndices,
  probeStreamFingerprint,
  runFfprobe,
  showPacketFlagsArgs,
  showStreamsArgs,
  type ProbeOptions,
  type StreamFingerprint,
} from './ffprobe.js';
export {
  KNOWN_VIDEO_ENCODERS,
  SEGMENT_EXTENSION,
  SEGMENT_FORMAT,
  TUNE_NONE,
  assertNoAudioTrack,
  encodeSegment,
  segmentEncodeArgs,
  type EncodeSegmentOptions,
  type SegmentEncodeOptions,
  type SegmentEncodeRun,
} from './encode.js';
export {
  FINAL_EXTENSION,
  FINAL_FORMAT,
  FORBIDDEN_CONCAT_ARGS,
  KNOWN_AUDIO_ENCODERS,
  VIDEO_COPY_ARGS,
  assertNoVideoEncodeArgs,
  concatAndMux,
  concatListLine,
  concatListText,
  concatMuxArgs,
  type ConcatAndMuxOptions,
  type ConcatMuxOptions,
  type ConcatMuxRun,
} from './concat.js';
export {
  assertClosedGop,
  assertFrameCounts,
  assertSameEncoderSignature,
  assertSameFingerprint,
  extractEncoderSignature,
  framesForSamples,
  readEncoderSignature,
  verifyAssembly,
  type FrameCountCheck,
  type MeasuredFinal,
  type VerifyAssemblyInput,
} from './verify.js';
// `framemd5` экспортируется, но обычным путём сборки НЕ зовётся (ADR-0006 §14): экспорт нужен
// CLI под флагом `--verify-frames` и ночному прогону. Охранник этого различия — репозиторный
// тест, требующий, чтобы `encode.ts`/`concat.ts`/`verify.ts` не импортировали этот модуль.
export {
  FRAMEMD5_FLAG,
  framemd5Args,
  framemd5Lines,
  framemd5Of,
  type Framemd5Options,
  type Framemd5Result,
} from './framemd5.js';
