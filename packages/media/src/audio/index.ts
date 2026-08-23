// `M-03` — PCM-тракт: формат, WAV I/O, микс, микрофейд, ресемплинг на ingest, контроль
// громкости, охранник **V6**. Публичная поверхность модуля.

export { AudioError, type AudioRule } from './errors.js';
export {
  PCM_BITS_PER_SAMPLE,
  PCM_BYTES_PER_SAMPLE,
  PCM_CHANNELS,
  PCM_SAMPLE_MAX,
  PCM_SAMPLE_MIN,
  assertProjectRate,
  bytesFromPcm,
  pcmFromBytes,
  pcmS16,
  silence,
  type PcmS16,
} from './pcm.js';
export {
  WAVE_FORMAT_MPEG,
  WAVE_FORMAT_MPEGLAYER3,
  assertNotMp3,
  isMp3Bytes,
  mp3WaveFormatName,
} from './v6.js';
export {
  WAVE_FORMAT_EXTENSIBLE,
  WAVE_FORMAT_PCM,
  WAV_HEADER_BYTES,
  decodeWav,
  encodeWav,
  readWavFile,
  writeWavFile,
} from './wav.js';
export { applyEdgeFade, scaleSample } from './fade.js';
export { mixSaturating, type MixResult } from './mix.js';
export {
  DEFAULT_FFMPEG_PATH,
  FfmpegError,
  parseFfmpegBuild,
  readFfmpegBuild,
  runFfmpeg,
  type FfmpegBuild,
  type FfmpegRun,
} from './ffmpeg.js';
export {
  KNOWN_RESAMPLER_ENGINES,
  ingestMusic,
  resampleArgs,
  type IngestOptions,
  type IngestResult,
  type ResampleOptions,
} from './resample.js';
export {
  FULL_SCALE,
  checkLoudness,
  dbFsOf,
  measureLoudness,
  peakLimitFromDb,
  type LoudnessCheck,
  type LoudnessReport,
} from './loudness.js';
