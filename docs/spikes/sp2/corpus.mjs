// SP-2 — весь тестовый материал в одном месте.
// Все ловушки заданы явными \u-эскейпами: если бы они лежали в файле литералами,
// любой редактор/git-фильтр/нормализация при копипасте могли бы подменить
// U+2019 на U+0027 или NFD на NFC, и спайк измерил бы себя, а не провайдера.

const EM         = '\u2014'                  ; // em-dash U+2014
const EN         = '\u2013'                  ; // en-dash U+2013
const RQ         = '\u2019'                  ; // типографский апостроф U+2019
const LDQ        = '\u201C'                  ; // левая curly quote U+201C
const RDQ        = '\u201D'                  ; // правая curly quote U+201D
const ELL        = '\u2026'                  ; // эллипсис ОДНИМ символом U+2026
const NBSP       = '\u00A0'                  ; // non-breaking space U+00A0
const EACUTE_NFC = '\u00E9'                  ; // é одним code point'ом (NFC): U+00E9
const EACUTE_NFD = '\u0065\u0301'            ; // é как e + combining acute (NFD): U+0065 U+0301
const SHIP       = '\uD83D\uDEA2'            ; // 🚢 U+1F6A2 — суррогатная пара U+D83D U+DEA2
const THUMB_TONE = '\uD83D\uDC4D\uD83C\uDFFD'; // 👍🏽 U+1F44D + модификатор тона U+1F3FD

// --- Блок 1 -----------------------------------------------------------------
// Каждая строка — короткое английское предложение, СОДЕРЖАЩЕЕ ловушку дословно
// в том виде, в каком она перечислена в задании (см. results/decisions.md п.2).
export const BLOCK1 = [
  { id: 'b1-01-dr',        f: 'F1',  trap: 'Dr. Smith',    text: 'Dr. Smith arrived long before the tide turned.' },
  { id: 'b1-02-st',        f: 'F1',  trap: 'St. Mary',     text: 'St. Mary stands above the old harbour road.' },
  { id: 'b1-03-year',      f: 'F2',  trap: 'in 1793',      text: 'The harbour was built in 1793 and never moved.' },
  { id: 'b1-04-ord3',      f: 'F3',  trap: 'the 3rd of May', text: 'They sailed on the 3rd of May and came home.' },
  { id: 'b1-05-ord21',     f: 'F3',  trap: '21st century', text: 'The 21st century found the warehouse empty.' },
  { id: 'b1-06-money',     f: 'F4',  trap: '$5',           text: 'A berth cost $5 a night in those old ledgers.' },
  { id: 'b1-07-percent',   f: 'F5',  trap: '5%',           text: 'Only 5% of the cargo ever reached the town.' },
  { id: 'b1-08-no7',       f: 'F1',  trap: 'No. 7',        text: 'Warehouse No. 7 kept the longest list of all.' },
  { id: 'b1-09-eg',        f: 'F6',  trap: 'e.g. this',    text: 'Some goods, e.g. this crate, waited for years.' },
  { id: 'b1-10-ie',        f: 'F6',  trap: 'i.e. that',    text: 'The word means waiting, i.e. that patience.' },
  { id: 'b1-11-apos-str',  f: 'F7',  trap: "it's",         text: "The keeper wrote that it's a quiet trade." },
  { id: 'b1-12-apos-typ',  f: 'F8',  trap: `it${RQ}s`,     text: `The keeper wrote that it${RQ}s a quiet trade.` },
  { id: 'b1-13-dont',      f: 'F7',  trap: "don't",        text: "They don't count the days any more." },
  { id: 'b1-14-hyphen',    f: 'F9',  trap: 'co-founder',   text: 'His co-founder kept the second ledger.' },
  { id: 'b1-15-emdash',    f: 'F10', trap: `word ${EM} word`, text: `The dock ${EM} the long one ${EM} held four ships.` },
  { id: 'b1-16-endash',    f: 'F10', trap: `word ${EN} word`, text: `The dock ${EN} the long one ${EN} held four ships.` },
  { id: 'b1-17-curly',     f: 'F11', trap: `${LDQ}quoted${RDQ}`, text: `He wrote ${LDQ}quoted${RDQ} in the margin of the page.` },
  { id: 'b1-18-ellipsis1', f: 'F12', trap: `wait${ELL}`,   text: `He would only say wait${ELL} and close the book.` },
  { id: 'b1-19-ellipsis3', f: 'F12', trap: 'wait...',      text: 'He would only say wait... and close the book.' },
  { id: 'b1-20-cafe-nfc',  f: 'F16', trap: `caf${EACUTE_NFC}`, text: `They drank at a caf${EACUTE_NFC} near the customs house.` },
  { id: 'b1-21-cafe-nfd',  f: 'F16', trap: `caf${EACUTE_NFD}`, text: `They drank at a caf${EACUTE_NFD} near the customs house.` },
  { id: 'b1-22-nbsp',      f: 'F15', trap: `5${NBSP}%`,    text: `Duty came to 5${NBSP}% of the declared value.` },
  { id: 'b1-23-emoji',     f: 'F13', trap: `${SHIP} ahead`, text: `${SHIP} ahead of the tide, the pilot called out.` },
  { id: 'b1-24-url',       f: 'F14', trap: 'https://example.org/a', text: 'The record lives at https://example.org/a today.' },
  { id: 'b1-25-thousands', f: 'num', trap: '1,000,000',    text: 'The archive holds 1,000,000 entries in all.' },
  { id: 'b1-26-decimal',   f: 'num', trap: '3.14',         text: 'The rate settled at 3.14 for the whole month.' },
  // Две строки СВЕРХ списка задания — обоснование в results/decisions.md п.3:
  { id: 'b1-27-emoji-tone', f: 'F13', trap: `${THUMB_TONE} ok`, added: true,
    text: `${THUMB_TONE} ok said the mate, and the rope went slack.` },
  { id: 'b1-28-date',       f: 'U16', trap: '03/04', added: true,
    text: 'The entry is dated 03/04 in the old even hand.' },
];

// --- Блок 3 ------------------------------------------------------------------
// Одна фраза, пять вариантов разделителя. Всё, кроме знака, совпадает побайтово.
export const BLOCK3 = [
  { id: 'b3-1-period',   sep: '. Then',        text: 'The ships would stop. Then the town woke up.' },
  { id: 'b3-2-emdash',   sep: ` ${EM} then`,   text: `The ships would stop ${EM} then the town woke up.` },
  { id: 'b3-3-comma',    sep: ', then',        text: 'The ships would stop, then the town woke up.' },
  { id: 'b3-4-ellipsis', sep: `${ELL} then`,   text: `The ships would stop${ELL} then the town woke up.` },
  { id: 'b3-5-semi',     sep: '; then',        text: 'The ships would stop; then the town woke up.' },
];

// --- Блок 4 ------------------------------------------------------------------
// Один абзац, наращиваемый ЦЕЛЫМИ предложениями. Прозы без цифр, знаков и
// сокращений: иначе провал charIdentity нельзя было бы приписать длине
// (см. results/decisions.md п.5).
export const BLOCK4_SENTENCES = [
  'The morning began the same way for almost two hundred years running.',
  'Ships came in on the night tide, and the town woke to their horns.',
  'The harbour warehouses held goods that nobody in town ever bought.',
  'They sat there exactly as long as the passage to the next shore took.',
  'The town archive kept a plain list of all those waiting goods.',
  'The entries are short, the hand is even, and the ink has not faded.',
  'Almost every line in that ledger ends with the very same word.',
  'The word is waiting, and it is written without any explanation at all.',
  'Not delay, not idle time, but waiting, as though the cargo had a will.',
  'The warehouse keeper kept a careful count of the days as they passed.',
  'Each day he drew one short stroke in the corner of the open page.',
  'By the end of the month that corner of the page had turned black.',
  'When a ship finally came, the strokes were crossed out with one line.',
  'The archive holds many such pages, and each one is crossed the same way.',
  'Not one of them explains what exactly was being awaited on that shore.',
  'But each one shows plainly what the waiting itself had cost the town.',
  'The keeper never wrote a name, a reason, or a promise of any return.',
  'He wrote only the strokes, the crossing line, and that single word.',
  'A reader today can count the days but cannot recover the reason for them.',
  'That, in the end, is what the harbour archive was built to preserve.',
  'The last page is unfinished, and the final stroke has no crossing line.',
  'Nobody in the town has ever agreed on what that missing line means.',
];
export const BLOCK4_TARGETS = [200, 400, 800, 1500];

// --- Блок 5 ------------------------------------------------------------------
// Три предложения одного абзаца — шов проверяется между ними.
export const BLOCK5 = [
  'The warehouse keeper kept a careful count of the days as they passed.',
  'Each day he drew one short stroke in the corner of the open page.',
  'By the end of the month that corner of the page had turned black.',
];

// --- Блок 6 ------------------------------------------------------------------
export const BLOCK6_TEXT = 'The town archive holds an answer to almost every question asked.';
export const BLOCK6_REPEATS = 3;

// --- Блок 7 ------------------------------------------------------------------
export const BLOCK7_TEXT = 'NASA kept a station near the old harbour, and NASA never once explained why.';
export const BLOCK7_RULE = { string_to_replace: 'NASA', type: 'alias', alias: 'N A S A' };

/**
 * Префиксы блока 4: число целых предложений, дающее длину, БЛИЖАЙШУЮ к target.
 * Не «наибольшее, не превышающее target»: при таком правиле точка 200 давала бы
 * 135 символов (следующее предложение перескакивает через порог), и первая
 * ступень измеряла бы не ту длину, которая заказана.
 */
export function block4Prefixes() {
  const cum = [];
  let text = '';
  for (const s of BLOCK4_SENTENCES) { text = text ? text + ' ' + s : s; cum.push(text); }
  return BLOCK4_TARGETS.map((target) => {
    let best = cum[0];
    for (const c of cum) if (Math.abs(c.length - target) < Math.abs(best.length - target)) best = c;
    return { id: `b4-${target}`, target, text: best,
             sentences: cum.indexOf(best) + 1, chars: best.length };
  });
}
