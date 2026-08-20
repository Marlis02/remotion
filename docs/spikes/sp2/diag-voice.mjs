// Диагностика после 402. Только GET'ы, ноль кредитов.
import { get, subscription, voiceInfo, writeJson } from './lib/api.mjs';

const sub = await subscription();
const v = await voiceInfo();
const mine = await get('/v1/voices');

const byCat = {};
for (const x of mine.voices) (byCat[x.category] ??= []).push(x.name);

const out = {
  schema: 'sp2-diag-voice/1',
  capturedAt: new Date().toISOString(),
  billing: { tier: sub.tier, characterCount: sub.character_count, characterLimit: sub.character_limit },
  targetVoice: {
    name: v.name, category: v.category,
    isOwner: v.sharing ? (v.sharing.status ?? null) : null,
    sharingPublicOwnerId: v.sharing ? !!v.sharing.public_owner_id : false,
    availableForTiers: v.available_for_tiers ?? null,
  },
  accountVoices: Object.fromEntries(Object.entries(byCat).map(([k, arr]) => [k, { count: arr.length, names: arr }])),
  error402: {
    code: 'paid_plan_required',
    message: 'Free users cannot use library voices via the API. Please upgrade your subscription to use this voice.',
  },
};
writeJson('raw/diag-voice.json', out);
console.log(JSON.stringify(out, null, 2));
