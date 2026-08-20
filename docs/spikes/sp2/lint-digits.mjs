// SP-2 блок 9 — доля токенов прозы, попадающих под линт-запрет ADR-0002 §3.
// Ни сети, ни кредитов.
//
// Запрещены в прозе: цифры, %, $, №, римские цифры, сокращения с точкой, URL,
// **жирный**, списки, инлайн-код. Область запрета — ТОЛЬКО проза (C7).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { writeJson, SPIKE_DIR } from './lib/api.mjs';

const REPO = join(SPIKE_DIR, '..', '..', '..');

// Известные английские сокращения — закрытый список. Нужен потому, что
// «сокращение с точкой» и «точка конца предложения» — один и тот же байт, и
// различить их без списка нельзя (это ровно та неоднозначность, ради устранения
// которой ADR-0002 §3 и вводит запрет). Первая редакция этого скрипта считала
// сокращением любое слово до четырёх букв перед точкой и записывала в нарушители
// `took.`, `word.`, `cost.` — число получалось втрое завышенным.
const KNOWN_ABBREV = new Set([
  'dr','mr','mrs','ms','prof','st','jr','sr','no','vs','etc','inc','ltd','co',
  'ave','rd','blvd','fig','vol','ch','ed','eds','approx','est','dept','univ',
  'jan','feb','mar','apr','jun','jul','aug','sep','sept','oct','nov','dec',
  'mon','tue','wed','thu','fri','sat','sun','al','cf','ibid','viz',
]);

const RULES = [
  { id: 'digit',     why: 'цифра',               test: (t) => /\d/u.test(t) },
  { id: 'percent',   why: 'знак %',              test: (t) => /%/u.test(t) },
  { id: 'currency',  why: 'знак валюты',         test: (t) => /[$€£¥]/u.test(t) },
  { id: 'numero',    why: 'знак №',              test: (t) => /№/u.test(t) },
  { id: 'url',       why: 'URL',                 test: (t) => /^(https?:\/\/|www\.)/iu.test(t) },
  // (а) точка ВНУТРИ токена — сокращение однозначно: e.g., i.e., U.S.
  { id: 'abbrevInnerDot', why: 'точка внутри токена (e.g., i.e., U.S.)',
    test: (t) => /^[^.]*\.[^.]*[^.\s]/u.test(t) || /^(?:[A-Za-z]{1,4}\.){2,}$/u.test(t) },
  // (б) точка в конце + основа в списке сокращений: Dr., St., No.
  { id: 'abbrevKnown', why: 'известное сокращение с точкой (Dr., St., No.)',
    test: (t) => /^[A-Za-z]{1,6}\.$/u.test(t) && KNOWN_ABBREV.has(t.slice(0, -1).toLowerCase()) },
  { id: 'roman',     why: 'римские цифры',
    test: (t) => /^(?=[MDCLXVI]{2,}$)M*(C[MD]|D?C{0,3})(X[CL]|L?X{0,3})(I[XV]|V?I{0,3})$/u.test(t) },
];

// Верхняя граница для (б): ЛЮБОЙ токен с точкой на конце. Разница между этим
// числом и `abbrevKnown` — цена закрытого списка, и она печатается явно.
const trailingDot = (t) => /^[A-Za-z]{1,6}\.$/u.test(t);

/** Разбор прозы source-диалекта: убрать шапку, заголовки, и разложить маркеры. */
function extractProse(md, mode) {
  const lines = md.split('\n');
  const kept = [];
  for (const l of lines) {
    const t = l.trim();
    if (!t) continue;
    if (/^schema:/.test(t)) continue;
    if (/^#{1,6}\s/.test(t)) continue;          // # chapter: / ## scene:
    kept.push(t);
  }
  let text = kept.join('\n');
  // [say: display | spoken] — две трактовки, см. results/decisions.md п.6
  text = text.replace(/\[say:\s*([^|\]]*?)\s*\|\s*([^\]]*?)\s*\]/gu,
    (_, d, s) => (mode === 'display' ? d : mode === 'spoken' ? s : d));
  // беспараметрические маркеры текстом не являются
  text = text.replace(/\[(?:beat|img|pause|emph)[^\]]*\]/gu, ' ');
  return text;
}

function tokenize(text) {
  // Токен = максимальная последовательность непробельных символов; внешняя
  // пунктуация-обрамление снимается, внутренняя (`Dr.`, `e.g.`, `co-founder`,
  // `it's`, `1,000,000`, `3.14`) остаётся частью токена — это ровно та
  // токенизация, которую требуют F1–F9 из ADR-0010 §10.
  return text.split(/[\s ]+/u)
    .map((t) => t.replace(/^[“”"'(\[—–]+/u, '')
                 .replace(/[“”"')\]—–,;:!?]+$/u, ''))
    .filter(Boolean);
}

function analyze(name, md) {
  const res = { file: name, modes: {} };
  for (const mode of ['display', 'spoken']) {
    const prose = extractProse(md, mode);
    const tokens = tokenize(prose);
    const hits = [];
    for (const tok of tokens) {
      const fired = RULES.filter((r) => r.test(tok)).map((r) => r.id);
      if (fired.length) hits.push({ token: tok, rules: fired });
    }
    const byRule = {};
    for (const h of hits) for (const r of h.rules) byRule[r] = (byRule[r] ?? 0) + 1;
    const trailingDotTokens = tokens.filter(trailingDot);
    res.modes[mode] = {
      tokens: tokens.length,
      banned: hits.length,
      shareBanned: Number((hits.length / tokens.length).toFixed(4)),
      sharePercent: Number(((hits.length / tokens.length) * 100).toFixed(2)),
      byRule,
      hits,
      trailingDotUpperBound: {
        count: trailingDotTokens.length,
        sharePercent: Number(((trailingDotTokens.length / tokens.length) * 100).toFixed(2)),
        tokens: trailingDotTokens,
        note: 'верхняя граница: если бы КАЖДАЯ точка в конце токена была сокращением',
      },
    };
  }
  // сколько раз автор УЖЕ был вынужден применить escape-hatch [say:]
  res.sayMarkers = [...md.matchAll(/\[say:\s*([^|\]]*?)\s*\|\s*([^\]]*?)\s*\]/gu)]
    .map((m) => ({ display: m[1], spoken: m[2] }));
  return res;
}

const candidates = [
  join(REPO, 'fixtures', 'minimal', 'source', '01-intro.md'),
];
const files = candidates.filter(existsSync);

const results = files.map((f) => analyze(f.replace(REPO + '/', ''), readFileSync(f, 'utf8')));

const totals = {};
for (const mode of ['display', 'spoken']) {
  const t = results.reduce((a, r) => ({ tokens: a.tokens + r.modes[mode].tokens, banned: a.banned + r.modes[mode].banned }), { tokens: 0, banned: 0 });
  totals[mode] = { ...t, sharePercent: Number(((t.banned / t.tokens) * 100).toFixed(2)) };
}

const out = {
  schema: 'sp2-lint/1',
  block: 9,
  rules: RULES.map((r) => ({ id: r.id, why: r.why, test: String(r.test) })),
  filesScanned: results.map((r) => r.file),
  filesNotFound: 'второго английского драфта в репозитории нет — см. results/decisions.md п.7',
  totals,
  results,
  thresholdFromAdr0002: { sharePercent: 2, source: 'ADR-0002, Риски: «при доле > ~2 % придётся ослаблять правило»' },
};
writeJson('raw/block9-lint.json', out);

console.log(`файлов: ${files.length}`);
for (const r of results) {
  for (const mode of ['display', 'spoken']) {
    const m = r.modes[mode];
    console.log(`  ${r.file} [${mode}] токенов ${m.tokens}, под запретом ${m.banned} (${m.sharePercent}%) — ${JSON.stringify(m.byRule)}`);
    console.log(`     верхняя граница по точкам: ${m.trailingDotUpperBound.count} (${m.trailingDotUpperBound.sharePercent}%)`);
    if (m.hits.length) console.log(`     ${m.hits.map((h) => h.token).join(' | ')}`);
  }
  console.log(`  escape-hatch [say:] уже применён ${r.sayMarkers.length} раз: ${JSON.stringify(r.sayMarkers)}`);
}
console.log('итого:', JSON.stringify(totals));
