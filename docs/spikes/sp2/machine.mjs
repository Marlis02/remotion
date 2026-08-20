// SP-2 шаг 1 — бесплатная разведка. Ноль кредитов: только GET'ы.
// В machine.json не попадают ни ключ, ни voice_id — только ИМЯ голоса.
import { execSync } from 'node:child_process';
import { subscription, models, voiceInfo, writeJson, TTS_PARAMS, BUDGET_CHARS } from './lib/api.mjs';

const sh = (c) => { try { return execSync(c, { stdio: ['ignore','pipe','ignore'] }).toString().trim(); } catch { return null; } };

const sub = await subscription();
const mds = await models();
const voice = await voiceInfo();

const target = mds.find((m) => m.model_id === TTS_PARAMS.model_id);

const out = {
  schema: 'sp2-machine/1',
  capturedAt: new Date().toISOString(),
  spike: {
    budgetChars: BUDGET_CHARS,
    ttsParams: TTS_PARAMS,
    endpoint: 'POST /v1/text-to-speech/{voice_id}/with-timestamps?output_format=pcm_24000',
  },
  account: {
    tier: sub.tier,
    status: sub.status,
    characterLimit: sub.character_limit,
    characterCount: sub.character_count,
    charactersRemaining: sub.character_limit - sub.character_count,
    canExtendCharacterLimit: sub.can_extend_character_limit ?? null,
    allowedToExtend: sub.allowed_to_extend_character_limit ?? null,
    nextResetUnixMs: sub.next_character_count_reset_unix ? sub.next_character_count_reset_unix * 1000 : null,
    maxCharacterLimitExtension: sub.max_character_limit_extension ?? null,
    voiceLimit: sub.voice_limit ?? null,
    // ADR-0010 §2: planTierAtGeneration обязателен, тариф ретроспективно не восстановить.
    planTierAtGeneration: sub.tier,
  },
  voice: {
    // ИМЯ, а не id — по требованию задания.
    name: voice.name,
    category: voice.category,
    labels: voice.labels ?? null,
    highQualityBaseModelIds: voice.high_quality_base_model_ids ?? null,
    idRecorded: false,
  },
  model: target ? {
    modelId: target.model_id,
    name: target.name,
    canDoTextToSpeech: target.can_do_text_to_speech,
    canUseSpeakerBoost: target.can_use_speaker_boost ?? null,
    canUseStyle: target.can_use_style ?? null,
    languages: (target.languages ?? []).length,
    maxCharactersFreeUser: target.max_characters_request_free_user ?? null,
    maxCharactersSubscribedUser: target.max_characters_request_subscribed_user ?? null,
    tokenCostFactor: target.token_cost_factor ?? null,
    description: target.description ?? null,
  } : { modelId: TTS_PARAMS.model_id, error: 'модель не найдена в GET /v1/models' },
  allModelIds: mds.map((m) => m.model_id),
  host: {
    node: process.version,
    os: sh('lsb_release -ds') || sh('uname -sr'),
    kernel: sh('uname -r'),
    arch: process.arch,
  },
  notes: [
    'Ключ и voice_id не записаны и не печатались: в файле только имя голоса (GET /v1/voices/{id}).',
    'characterCount — на момент снимка, ДО первого платного вызова спайка.',
    'Расход спайка считается дельтой character_count вокруг каждого платного вызова (results/progress.jsonl).',
  ],
};

writeJson('machine.json', out);
console.log(JSON.stringify({
  tier: out.account.tier, characterLimit: out.account.characterLimit,
  characterCount: out.account.characterCount, remaining: out.account.charactersRemaining,
  voiceName: out.voice.name, model: out.model.name ?? out.model.modelId,
  maxCharsFree: out.model.maxCharactersFreeUser,
}, null, 2));
