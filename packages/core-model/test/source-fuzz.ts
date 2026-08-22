// Генератор случайных исходников для property-тестов трансдьюсера (`C-03`, ADR-0010 §10).
//
// ПОЧЕМУ ОЖИДАНИЕ СТРОИТ ГЕНЕРАТОР, А НЕ ТОТ ЖЕ КОД. Свойство round-trip
// (`reconstructDisplay(spoken, spanMap) === displayText`) на входе «display, посчитанный
// трансдьюсером» было бы тавтологией: обе стороны считала бы одна функция. Поэтому генератор
// СНАЧАЛА решает, из чего состоит абзац (слово / `[say: d | s]` / прозрачный маркер), и
// оттуда независимо получает ОБА ожидаемых текста; исходник собирается из того же плана.
//
// ПОЧЕМУ БЕЗ `fast-check`. Новых зависимостей в `C-03` нет (задание). `splitmix32` из `C-01`
// уже в репозитории, сид — константа и печатается: падение обязано быть воспроизводимым
// (Charter V8), а вход печатается целиком и без сжатия контрпримера.
//
// АЛФАВИТ — ЭТО ЛОВУШКИ F1–F16, а не «случайные буквы»: апостроф обоих видов, em-dash,
// эллипсис одним символом, curly quotes, дефис, NBSP, эмодзи с модификатором тона, `é` в NFC
// и в NFD, цифры и знаки. Символы диалекта (`[`, `]`, `|`, `#`) и пробельные в алфавит НЕ
// входят: они сделали бы вход синтаксически другим, а не «тем же текстом с ловушкой».

import { nextInt, splitmix32 } from './etalon.js';
import { doc } from './source-helpers.js';

/** Сид. Константа: прогон обязан быть воспроизводимым командой из сообщения об ошибке. */
export const FUZZ_SEED = 0xc03_2026;

/**
 * Ни одна запись не начинается с комбинирующего символа — иначе NFC мог бы склеить её с
 * концом предыдущей записи, и «ожидание = NFC каждой части» перестало бы быть точным.
 */
const ALPHABET: readonly string[] = [
  'a', 'b', 'c', 'o', 'w', 'Z',
  '1', '5', '%', '$',
  '-', '.', ',', '?', '!', ':', '/',
  '—', // em-dash, F10
  '…', // эллипсис одним символом, F12
  '’', // типографский апостроф, F8
  "'", // прямой апостроф, F7
  '“', '”', // curly quotes, F11
  '\u00A0', // NBSP, F15
  '\u{1F6A2}', // 🚢 — суррогатная пара, F13
  '\u{1F44D}\u{1F3FD}', // 👍🏽 — пара + модификатор тона, F13
  '\u00E9', // `é` одним code point (NFC), F16
  'e\u0301', // `e` + комбинирующий акут (NFD) — NFC соберёт его в `é`, F16
];

/** Пробельные диалекта — ровно три (`C-02`, `text.ts`). NBSP среди них нет намеренно. */
const SPACES: readonly string[] = [' ', ' ', ' ', '\t', '\n'];

/** План одного абзаца: что видит парсер и что ОБЯЗАНО получиться с обеих сторон. */
export interface FuzzChunk {
  readonly spoken: string;
  readonly display: string;
}

export interface FuzzDocument {
  /** Готовый файл диалекта, с шапкой, главой и сценой. */
  readonly text: string;
  /** Ожидание по чанкам, в порядке исходника. */
  readonly chunks: readonly FuzzChunk[];
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[nextInt(rng, items.length - 1)] as T;
}

/** Слово или часть маркера: 1..6 записей алфавита подряд, без пробельных и символов диалекта. */
function part(rng: () => number): string {
  let out = '';
  const count = 1 + nextInt(rng, 5);
  for (let i = 0; i < count; i += 1) out += pick(rng, ALPHABET);
  return out;
}

/** Ряд пробельных между элементами: 1..3 символа, не больше одного `\n` (иначе конец абзаца). */
function gap(rng: () => number): string {
  let out = '';
  let newlines = 0;
  const count = 1 + nextInt(rng, 2);
  for (let i = 0; i < count; i += 1) {
    const ch = pick(rng, SPACES);
    if (ch === '\n') {
      if (newlines > 0) {
        out += ' ';
        continue;
      }
      newlines += 1;
    }
    out += ch;
  }
  return out;
}

interface Item {
  readonly source: string;
  readonly spoken: string;
  readonly display: string;
}

/**
 * Один элемент абзаца. `[emph]` и `[beat:]` ПРОЗРАЧНЫ: по таблице ADR-0002 §2 они не идут в
 * TTS, а ряд пробельных вокруг них схлопывается в один пробел (решение владельца `C-02`) —
 * значит на обеих сторонах от них не остаётся ничего, и ожидание это учитывает.
 */
function item(rng: () => number, beat: () => string): Item {
  const roll = nextInt(rng, 9);
  if (roll <= 4) {
    const word = part(rng).normalize('NFC');
    return { source: word, spoken: word, display: word };
  }
  if (roll <= 7) {
    const display = part(rng);
    const spoken = part(rng);
    return {
      source: `[say: ${display} | ${spoken}]`,
      spoken: spoken.normalize('NFC'),
      display: display.normalize('NFC'),
    };
  }
  if (roll === 8) return { source: '[emph]', spoken: '', display: '' };
  return { source: `[beat: ${beat()}]`, spoken: '', display: '' };
}

/**
 * Случайный документ: одна глава, одна сцена, 1..3 абзаца по 1..7 элементов.
 *
 * `[pause:]` в генераторе НЕТ намеренно: он режет чанк и вносит правила МЕСТА (граница
 * предложения), то есть проверял бы парсер `C-02`, а не трансдьюсер. Абзац здесь ровно
 * один чанк.
 */
export function fuzzDocument(rng: () => number, index: number): FuzzDocument {
  let beats = 0;
  const beat = (): string => {
    beats += 1;
    return `k${String(index)}x${String(beats)}`;
  };

  const lines: string[] = ['', '# chapter: main', '', '## scene: intro'];
  const chunks: FuzzChunk[] = [];
  const paragraphs = 1 + nextInt(rng, 2);

  for (let p = 0; p < paragraphs; p += 1) {
    const items: Item[] = [];
    const count = 1 + nextInt(rng, 6);
    for (let i = 0; i < count; i += 1) items.push(item(rng, beat));

    let source = '';
    for (let i = 0; i < items.length; i += 1) {
      if (i > 0) source += gap(rng);
      source += items[i]?.source ?? '';
    }
    const textful = items.filter((entry) => entry.spoken !== '' || entry.display !== '');
    lines.push('', source);
    chunks.push({
      spoken: textful.map((entry) => entry.spoken).join(' '),
      display: textful.map((entry) => entry.display).join(' '),
    });
  }

  return { text: doc(...lines), chunks };
}

/** `count` документов подряд из одного сида — воспроизводимо и без сети. */
export function fuzzDocuments(count: number, seed = FUZZ_SEED): FuzzDocument[] {
  const rng = splitmix32(seed);
  const out: FuzzDocument[] = [];
  for (let i = 0; i < count; i += 1) out.push(fuzzDocument(rng, i));
  return out;
}
