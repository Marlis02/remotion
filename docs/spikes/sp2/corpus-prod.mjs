// SP-2b — материал досъёмки. Тексты берутся из corpus.mjs БЕЗ изменений:
// сравнение Daniel против Michael честно только если строки побайтово те же.
// Меняются лишь идентификаторы (суффикс -prod), чтобы старые raw/*.json
// не перезаписывались и чтобы бюджет SP-2b считался по этому суффиксу.
import { BLOCK1, BLOCK3, BLOCK7_TEXT, BLOCK7_RULE, BLOCK4_SENTENCES } from './corpus.mjs';

const prod = (s) => ({ ...s, baseId: s.id, id: `${s.id}-prod` });

export const BLOCK1_PROD = BLOCK1.map(prod);
export const BLOCK3_PROD = BLOCK3.map(prod);
export const BLOCK7_PROD = { id: 'b7-dict-prod', text: BLOCK7_TEXT, rule: BLOCK7_RULE };

// --- Долг 4: ступень ~2700 символов ------------------------------------------
// Абзац block4.mjs кончается на 1514 символах (22 предложения), поэтому для
// ступени 2700 он ДОПИСАН целыми предложениями в том же стиле и по тому же
// правилу, что и исходный: ни цифр, ни знаков валюты/процента, ни сокращений
// с точкой (decisions SP-2 п.5 — один фактор на эксперимент: измеряется длина).
export const BLOCK4_SENTENCES_EXTRA = [
  'Some readers come to the archive hoping to find a single missing name.',
  'They leave with nothing but the shape of a habit repeated for years.',
  'The building itself has changed hands more times than anyone recalls.',
  'Its rooms are cold, and the windows face the water on every floor.',
  'A clerk once tried to sort the pages by the length of the waiting.',
  'He gave up when he found that most entries had no ending at all.',
  'The town council asked twice for a summary of what the archive held.',
  'Both times the answer came back as a list of years and nothing more.',
  'Visitors often ask whether the ships in question ever arrived at all.',
  'The keeper of the archive answers that the question is badly put.',
  'What the pages record is not arrival but the shape of expectation.',
  'A stroke means a day, and a crossing line means the day was answered.',
  'Everything else in the ledger is the silence between those two marks.',
  'On the upper floor there is a room nobody has catalogued in decades.',
  'It holds the ledgers that were damaged when the roof failed one winter.',
  'The ink there has run, and the strokes have joined into long grey bands.',
  'Nobody can say how many days those bands were once meant to stand for.',
  'The archive keeps them anyway, because a ruined count is still a count.',
];

export const BLOCK4_ALL_SENTENCES = [...BLOCK4_SENTENCES, ...BLOCK4_SENTENCES_EXTRA];

/**
 * Префикс из целых предложений, БЛИЖАЙШИЙ к target (то же правило, что в
 * corpus.mjs block4Prefixes: «ближайший», а не «наибольший не превышающий»).
 */
export function block4ProdPrefix(target = 2700) {
  let text = '';
  const cum = [];
  for (const s of BLOCK4_ALL_SENTENCES) { text = text ? text + ' ' + s : s; cum.push(text); }
  let best = cum[0];
  for (const c of cum) if (Math.abs([...c].length - target) < Math.abs([...best].length - target)) best = c;
  return {
    id: `b4-${target}-prod`, target, text: best,
    sentences: cum.indexOf(best) + 1,
    chars: best.length,
    codePoints: [...best].length,
    fromOriginal: BLOCK4_SENTENCES.length,
    fromExtra: Math.max(0, cum.indexOf(best) + 1 - BLOCK4_SENTENCES.length),
  };
}
