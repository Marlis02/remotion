// SP-2b шаг 1 — бесплатная разведка перед досъёмкой на боевом голосе.
// Ноль кредитов: только GET'ы. Пишет ВТОРОЙ снимок в results/machine.json
// под ключом snapshot_sp2b; первый снимок (Free, Daniel) не трогает.
// Ни ключ, ни voice_id в файл не попадают — только ИМЯ голоса.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { subscription, models, voiceInfo, get, writeJson, RESULTS, TTS_PARAMS } from './lib/api.mjs';
import { PROD_BUDGET } from './lib/prod.mjs';

const sub = await subscription();
const mds = await models();
const voice = await voiceInfo();            // по умолчанию — голос из ELEVENLABS_VOICE_ID
let user = null;
try { user = await get('/v1/user'); } catch (e) { user = { error: `HTTP ${e.status}` }; }

const target = mds.find((m) => m.model_id === TTS_PARAMS.model_id);

const snap = {
  schema: 'sp2b-machine/1',
  capturedAt: new Date().toISOString(),
  spike: {
    task: 'SP-2b — досъёмка на боевом голосе и закрытие долгов 1 и 4',
    budgetChars: PROD_BUDGET,
    unit: 'code points (измерено в SP-2: списание = сумма code points отправленных строк)',
    ttsParams: TTS_PARAMS,
    endpoint: 'POST /v1/text-to-speech/{voice_id}/with-timestamps?output_format=pcm_24000',
    note: 'параметры платных вызовов идентичны SP-2; единственное отличие — voice_id',
  },
  account: {
    tier: sub.tier,
    status: sub.status,
    characterLimit: sub.character_limit,
    characterCount: sub.character_count,
    charactersRemaining: sub.character_limit - sub.character_count,
    canExtendCharacterLimit: sub.can_extend_character_limit ?? null,
    allowedToExtend: sub.allowed_to_extend_character_limit ?? null,
    maxCharacterLimitExtension: sub.max_character_limit_extension ?? null,
    nextResetUnixMs: sub.next_character_count_reset_unix ? sub.next_character_count_reset_unix * 1000 : null,
    voiceLimit: sub.voice_limit ?? null,
    currency: sub.currency ?? null,
    billingPeriod: sub.billing_period ?? null,
    planTierAtGeneration: sub.tier,
  },
  voice: {
    // ИМЯ, а не id: боевой voice_id в артефакты спайка не попадает никогда.
    name: voice.name,
    category: voice.category,
    sharingStatus: voice.sharing?.status ?? null,
    labels: voice.labels ?? null,
    highQualityBaseModelIds: voice.high_quality_base_model_ids ?? null,
    idRecorded: false,
    source: 'process.env.ELEVENLABS_VOICE_ID',
    mode: 'env',
  },
  model: target ? {
    modelId: target.model_id,
    name: target.name,
    maxCharactersFreeUser: target.max_characters_request_free_user ?? null,
    maxCharactersSubscribedUser: target.max_characters_request_subscribed_user ?? null,
    tokenCostFactor: target.token_cost_factor ?? null,
    languages: (target.languages ?? []).length,
  } : { modelId: TTS_PARAMS.model_id, error: 'модель не найдена в GET /v1/models' },
  allModelIds: mds.map((m) => m.model_id),
  user: user && !user.error ? {
    subscriptionTier: user.subscription?.tier ?? null,
    isNewUser: user.is_new_user ?? null,
    canUseDelayedPaymentMethods: user.can_use_delayed_payment_methods ?? null,
  } : user,
  gate: {
    tierIsCreator: sub.tier === 'creator',
    voiceUsableExpected: sub.tier !== 'free',
    verdict: sub.tier === 'creator' ? 'можно тратить кредиты' : `tier = ${sub.tier} — ЖДУ ВЛАДЕЛЬЦА`,
  },
  notes: [
    'Второй снимок. Первый (Free, Daniel) лежит в корне этого файла и не изменён.',
    'Ни ключ, ни ELEVENLABS_VOICE_ID здесь не записаны: только имя голоса из GET /v1/voices/{id}.',
    'characterCount — на момент снимка, ДО первого платного вызова SP-2b.',
  ],
};

const m = JSON.parse(readFileSync(join(RESULTS, 'machine.json'), 'utf8'));
m.snapshot_sp2b = snap;
writeJson('machine.json', m);

console.log(JSON.stringify({
  tier: snap.account.tier,
  characterLimit: snap.account.characterLimit,
  characterCount: snap.account.characterCount,
  remaining: snap.account.charactersRemaining,
  voiceName: snap.voice.name,
  voiceCategory: snap.voice.category,
  sharingStatus: snap.voice.sharingStatus,
  model: snap.model.name ?? snap.model.modelId,
  maxCharsSubscribed: snap.model.maxCharactersSubscribedUser,
  gate: snap.gate.verdict,
}, null, 2));
