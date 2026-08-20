// SP-2 — один и тот же голос во всех блоках. Имя, а не id: id из .env не
// используется (402 на Free), id премейда резолвится по имени на каждом запуске.
import { usePremadeVoice } from './api.mjs';
export const SPIKE_VOICE_NAME_PREFIX = 'Daniel';
export const initVoice = () => usePremadeVoice(SPIKE_VOICE_NAME_PREFIX);
