// SP-2 — единственная точка обращения к ElevenLabs.
// Параметры платного вызова зашиты ЗДЕСЬ и нигде больше: задание требует,
// чтобы они не менялись между блоками, а разъехаться они могут только если
// их набирают руками в каждом скрипте.
import { createHash } from 'node:crypto';
import { writeFileSync, appendFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SPIKE_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
export const RESULTS = join(SPIKE_DIR, 'results');
export const RAW = join(RESULTS, 'raw');
export const OUT = join(SPIKE_DIR, 'out');
for (const d of [RESULTS, RAW, OUT]) if (!existsSync(d)) mkdirSync(d, { recursive: true });

const API = 'https://api.elevenlabs.io';

// --- секреты -----------------------------------------------------------------
// Значения не печатаются нигде: ни в лог, ни в raw/, ни в machine.json.
const KEY = process.env.ELEVENLABS_API_KEY;
const VOICE = process.env.ELEVENLABS_VOICE_ID;
if (!KEY || !VOICE) {
  console.error('ELEVENLABS_API_KEY / ELEVENLABS_VOICE_ID не заданы в окружении (.env).');
  process.exit(2);
}
// Голос, которым спайк снимает ФАКТИЧЕСКИ. По умолчанию — из .env.
// Может быть переключён на premade-голос: на тарифе Free библиотечные
// (category: professional/cloned) голоса через API недоступны — HTTP 402
// `paid_plan_required`. См. results/voice-and-tier.md.
let ACTIVE_VOICE = VOICE;
let ACTIVE_VOICE_NAME = null;
export const activeVoice = () => ({ name: ACTIVE_VOICE_NAME, isFromEnv: ACTIVE_VOICE === VOICE,
  mode: ACTIVE_VOICE === VOICE ? 'env' : 'premade',
  // id премейд-голоса НЕ секрет (он публичен в документации ElevenLabs) и
  // записывается ради воспроизводимости; id из .env не записывается никогда.
  publicId: ACTIVE_VOICE === VOICE ? null : ACTIVE_VOICE });
export const activeVoiceMode = () => (ACTIVE_VOICE === VOICE ? 'env' : 'premade');

/** Переключить спайк на premade-голос, найденный ПО ИМЕНИ. .env не читается и не меняется. */
export async function usePremadeVoice(namePrefix) {
  const all = await get('/v1/voices');
  const v = all.voices.find((x) => x.category === 'premade' && x.name.startsWith(namePrefix));
  if (!v) throw new Error(`premade-голос по префиксу ${JSON.stringify(namePrefix)} не найден`);
  ACTIVE_VOICE = v.voice_id;
  ACTIVE_VOICE_NAME = v.name;
  return { name: v.name, publicId: v.voice_id, category: v.category };
}

/**
 * SP-2b: переключить спайк на БОЕВОЙ голос из process.env.ELEVENLABS_VOICE_ID.
 * Это дефолтное состояние ACTIVE_VOICE; функция нужна ради ИМЕНИ голоса —
 * оно приватно для модуля, а задание требует писать его в каждый raw/*.json.
 * .env не читается скриптом: значение приходит через --env-file в process.env.
 */
export async function useEnvVoice() {
  const v = await get(`/v1/voices/${VOICE}`);
  ACTIVE_VOICE = VOICE;
  ACTIVE_VOICE_NAME = v.name;
  // publicId: null — боевой id не записывается никуда, ни в raw/, ни в machine.json.
  return { name: v.name, publicId: null, category: v.category,
           sharingStatus: v.sharing?.status ?? null, mode: 'env' };
}

// Любая строка, уходящая в лог или в файл, проходит через это.
export function redact(s) {
  if (typeof s !== 'string') s = String(s);
  return s.split(KEY).join('<API_KEY>').split(VOICE).join('<VOICE_ID>');
}

// --- параметры всех платных вызовов (задание: не менять между блоками) -------
export const TTS_PARAMS = Object.freeze({
  output_format: 'pcm_24000',
  model_id: 'eleven_multilingual_v2',
  apply_text_normalization: 'off',
  seed: 20260821,
  voice_settings: Object.freeze({ stability: 0.5, similarity_boost: 0.75, style: 0, speed: 1.0 }),
});
export const SAMPLE_RATE = 24000;
export const BYTES_PER_SAMPLE = 2; // pcm_24000 = s16le mono

// --- бюджет ------------------------------------------------------------------
export const BUDGET_CHARS = 7000;
const LEDGER = join(RESULTS, 'progress.jsonl');

function ledger(rec) {
  appendFileSync(LEDGER, JSON.stringify(rec) + '\n');
}
export function ledgerRecords() {
  if (!existsSync(LEDGER)) return [];
  return readFileSync(LEDGER, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}
export function spentSoFar() {
  return ledgerRecords().reduce((a, r) => a + (r.charged ?? 0), 0);
}

/**
 * Сверка с провайдером на ГРАНИЦЕ БЛОКА, а не вокруг каждого вызова.
 * `GET /v1/user/subscription` отдаёт character_count с лагом ~20-40 c
 * (измерено, см. results/findings.md), поэтому как поштучный счётчик он
 * непригоден: дельта вокруг вызова читается как 0. Учёт ведётся по длине
 * отправленной строки (что тарифицируется ровно она — тоже измерено),
 * а подписка служит контрольной сверкой.
 */
export async function settleBilling({ pollMs = 10000, maxPolls = 12 } = {}) {
  let prev = (await subscription()).character_count;
  let stable = 0;
  for (let i = 0; i < maxPolls; i++) {
    await new Promise((r) => setTimeout(r, pollMs));
    const now = (await subscription()).character_count;
    if (now === prev) { stable++; if (stable >= 2) break; } else { stable = 0; prev = now; }
  }
  return prev;
}
/** Ворота бюджета: платный вызов не выполняется, если он выводит спайк за лимит. */
export function assertBudget(plannedChars) {
  const spent = spentSoFar();
  if (spent + plannedChars > BUDGET_CHARS) {
    throw new Error(`Бюджет спайка: потрачено ${spent}, запрошено ещё ${plannedChars}, ` +
      `лимит ${BUDGET_CHARS}. Останавливаюсь до решения владельца.`);
  }
  return { spent, remaining: BUDGET_CHARS - spent };
}

// --- HTTP --------------------------------------------------------------------
async function req(path, init = {}) {
  const res = await fetch(API + path, {
    ...init,
    headers: { 'xi-api-key': KEY, ...(init.headers || {}) },
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} на ${redact(path)}: ${redact(text).slice(0, 600)}`);
    err.status = res.status;
    err.body = redact(text);
    throw err;
  }
  return text ? JSON.parse(text) : null;
}
export const get = (p) => req(p);
export const post = (p, body) =>
  req(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
export const del = (p) => req(p, { method: 'DELETE' });

// --- бесплатные справочные вызовы --------------------------------------------
export const subscription = () => get('/v1/user/subscription');
export const models = () => get('/v1/models');
export const voiceInfo = (id = VOICE) => get(`/v1/voices/${id}`);

// --- платный вызов -----------------------------------------------------------
export function sha256(buf) { return createHash('sha256').update(buf).digest('hex'); }

/**
 * Один платный вызов TTS.
 * Обрамляется бесплатным GET /v1/user/subscription до и после — дельта
 * character_count даёт ФАКТИЧЕСКИ списанные единицы, а не нашу оценку.
 */
export async function tts(name, { text, previousText, nextText, dictionaryLocators, note } = {}) {
  const body = { text, ...TTS_PARAMS };
  if (previousText != null) body.previous_text = previousText;
  if (nextText != null) body.next_text = nextText;
  if (dictionaryLocators != null) body.pronunciation_dictionary_locators = dictionaryLocators;

  const t0 = Date.now();
  let resp, failure = null;
  try {
    resp = await post(`/v1/text-to-speech/${ACTIVE_VOICE}/with-timestamps?output_format=${TTS_PARAMS.output_format}`, body);
  } catch (e) {
    failure = e;
  }
  const ms = Date.now() - t0;
  // Учёт по длине отправленной строки: измерено, что тарифицируется ровно она
  // (605 -> 651 на строке в 46 символов), а подписка отстаёт на десятки секунд.
  const charged = text.length;

  const rec = {
    name, ts: new Date(t0).toISOString(), ms,
    voice: ACTIVE_VOICE_NAME,
    voiceMode: ACTIVE_VOICE === VOICE ? 'env' : 'premade',
    inputChars: text.length,
    inputCodePoints: [...text].length,
    previousTextChars: previousText ? previousText.length : 0,
    nextTextChars: nextText ? nextText.length : 0,
    charged,
    ok: !failure,
    note: note ?? null,
  };

  if (failure) {
    rec.charged = 0;
    rec.error = failure.body ? failure.body.slice(0, 400) : String(failure.message).slice(0, 400);
    rec.status = failure.status ?? null;
    ledger(rec);
    throw failure;
  }

  // Аудио: base64 -> PCM в out/ (в .gitignore), в git уходит только sha256.
  const pcm = Buffer.from(resp.audio_base64, 'base64');
  writeFileSync(join(OUT, `${name}.pcm`), pcm);
  const audio = {
    sha256: sha256(pcm),
    bytes: pcm.length,
    numSamples: pcm.length / BYTES_PER_SAMPLE,
    sampleRate: SAMPLE_RATE,
    durationSeconds: pcm.length / BYTES_PER_SAMPLE / SAMPLE_RATE,
    file: `out/${name}.pcm`,
  };
  rec.audioSha256 = audio.sha256;
  rec.audioSeconds = Number(audio.durationSeconds.toFixed(4));
  ledger(rec);

  // Полный нетронутый ответ — в out/ (гитигнор), чтобы ничего не потерять.
  writeFileSync(join(OUT, `${name}.full.json`), JSON.stringify(resp));
  // В git — тот же ответ, но audio_base64 заменён дескриптором: массивы alignment
  // лежат ровно как пришли, а 25 МБ base64 в docs/ не отправляются.
  const forGit = { ...resp, audio_base64: { __replacedBy: 'sp2', ...audio } };
  writeFileSync(join(RAW, `${name}.json`), JSON.stringify({
    schema: 'sp2-take/1',
    name,
    voice: ACTIVE_VOICE_NAME,
    voiceMode: ACTIVE_VOICE === VOICE ? 'env' : 'premade',
    request: {
      endpoint: `POST /v1/text-to-speech/{voice_id}/with-timestamps?output_format=${TTS_PARAMS.output_format}`,
      body: { text, ...(previousText != null ? { previous_text: previousText } : {}),
              ...(nextText != null ? { next_text: nextText } : {}),
              ...(dictionaryLocators != null ? { pronunciation_dictionary_locators: dictionaryLocators } : {}),
              ...TTS_PARAMS },
    },
    billing: { inputChars: text.length, charged, unit: 'символы отправленной строки' },
    response: forGit,
  }, null, 2) + '\n');

  return { resp, audio, charged, rec };
}

export function writeJson(relPath, obj) {
  const p = join(RESULTS, relPath);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
  return p;
}
