// Досъёмка machine.json: фактический голос спайка, итог расхода, находки по тарификации.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { subscription, voiceInfo, writeJson, RESULTS, ledgerRecords, spentSoFar, BUDGET_CHARS } from './lib/api.mjs';
import { initVoice } from './lib/voice.mjs';

const m = JSON.parse(readFileSync(join(RESULTS, 'machine.json'), 'utf8'));
const v = await initVoice();
const full = await voiceInfo(v.publicId);
const sub = await subscription();
const recs = ledgerRecords();
const ok = recs.filter((r) => r.ok);

// Идемпотентно: при повторном прогоне поля intended берутся из уже
// перестроенной структуры, а не из исходной (иначе они затираются undefined).
const intendedName = m.voice.intended?.name ?? m.voice.name;
const intendedCategory = m.voice.intended?.category ?? m.voice.category;
m.voice = {
  intended: {
    name: intendedName,
    category: intendedCategory,
    usable: false,
    error: 'HTTP 402 paid_plan_required: «Free users cannot use library voices via the API»',
    note: 'id не записан: он лежит в .env и в артефакты спайка не попадает',
  },
  actual: {
    name: full.name,
    category: full.category,
    publicId: v.publicId,
    note: 'premade-голос: его id публичен в документации ElevenLabs и записан ради воспроизводимости',
    resolvedBy: 'имя через GET /v1/voices — .env не читался и не менялся',
  },
  consequence: 'абсолютные тайминги (лид-ин, хвост, длительность пауз) голосозависимы — см. results/voice-and-tier.md',
};
m.spend = {
  budgetChars: BUDGET_CHARS,
  accountedByCodePoints: ok.reduce((a, r) => a + r.inputCodePoints, 0),
  accountedByUtf16: ok.reduce((a, r) => a + r.inputChars, 0),
  providerCharacterCountStart: 605,
  providerCharacterCountEnd: sub.character_count,
  providerBilled: sub.character_count - 605,
  contextCharsNotBilled: recs.reduce((a, r) => a + (r.previousTextChars ?? 0) + (r.nextTextChars ?? 0), 0),
  paidCallsOk: ok.length,
  paidCallsFailed: recs.length - ok.length,
  remainingOfBudget: BUDGET_CHARS - spentSoFar(),
  accountCharactersRemaining: sub.character_limit - sub.character_count,
};
m.billingFindings = {
  unit: 'code points',
  evidence: 'сумма code points по всем text = 5153 = списанию провайдера; сумма UTF-16 units = 5156 ≠ списанию',
  perRequestMinimum: 'нет: первая строка в 46 символов списала ровно 46',
  contextFieldsBilled: false,
  subscriptionLagSeconds: '20-40',
  subscriptionUsableAsPerCallMeter: false,
};
m.keyPermissions = {
  missing: ['pronunciation_dictionaries_write'],
  evidence: 'HTTP 401 unauthorized на POST /v1/pronunciation-dictionaries/add-from-rules',
  blocks: 'блок 7 (словарь с alias, C1)',
};
m.notes.push('Голос из .env недоступен на Free через API (402). Спайк снят на premade-голосе — см. results/voice-and-tier.md.');
m.notes.push('Тарификация — по code points, не по UTF-16 units. Это тот же счётчик, в котором приходит массив alignment.');
writeJson('machine.json', m);
console.log(JSON.stringify({ voice: m.voice.actual.name, spend: m.spend, key: m.keyPermissions }, null, 2));
