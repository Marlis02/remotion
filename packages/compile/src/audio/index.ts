// `CP-05` — зона `audio`: план непрерывной дорожки, её материализация и ссылка в манифест.
// Публичная поверхность зоны.
//
// ЧЕГО ЗДЕСЬ НЕТ И НЕ БУДЕТ: `seconds`/`amount` из `dump.ts` (display-хелперы секунд наружу не
// уезжают — поправка владельца П2: наружу уходит готовая строка, а не вторая единица времени).

export { CompileAudioError, type CompileAudioRule } from './errors.js';

export {
  compileAudio,
  type AudioProfileInput,
  type CompileAudioInput,
} from './plan.js';

export { audioTrackRef, renderAudioTrack, withAudioTrack, type PcmSource } from './render.js';

export { dumpAudioPlan, formatBreakdown } from './dump.js';

export type {
  AudioBreakdown,
  AudioCorrectionSilence,
  AudioElement,
  AudioMusicClip,
  AudioPlainSilence,
  AudioPlan,
  AudioSilenceElement,
  AudioSilenceKind,
  AudioSpeechElement,
} from './types.js';
