// SP-2 — один и тот же голос во всех блоках. Имя, а не id: id из .env не
// используется (402 на Free), id премейда резолвится по имени на каждом запуске.
//
// SP-2b (тариф Creator): боевой голос из .env через API доступен, поэтому рядом
// с режимом Daniel появился режим `env`. Режим выбирается флагом
//   --voice=env      боевой голос из process.env.ELEVENLABS_VOICE_ID (ДЕФОЛТ)
//   --voice=premade  премейд `Daniel`, которым сняты результаты SP-2
// Старый режим не удалён: Daniel-числа обязаны оставаться воспроизводимыми.
import { usePremadeVoice, useEnvVoice } from './api.mjs';
export const SPIKE_VOICE_NAME_PREFIX = 'Daniel';
export const initVoice = () => usePremadeVoice(SPIKE_VOICE_NAME_PREFIX);

/** Режим голоса из argv. Дефолт — `env` (боевой голос). */
export function voiceModeFromArgv(argv = process.argv) {
  const flag = argv.find((a) => a.startsWith('--voice='))?.slice(8) ?? 'env';
  if (flag !== 'env' && flag !== 'premade') {
    throw new Error(`--voice=${flag}: допустимо только env или premade`);
  }
  return flag;
}

/** Инициализация голоса по флагу. Возвращает { name, category, mode, publicId }. */
export async function initVoiceByFlag(argv = process.argv) {
  const mode = voiceModeFromArgv(argv);
  const v = mode === 'env' ? await useEnvVoice() : await usePremadeVoice(SPIKE_VOICE_NAME_PREFIX);
  return { ...v, mode };
}
