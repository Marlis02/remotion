// Лексер: нормализованный поток → блоки и маркеры. Ровно семь позиций таблицы ADR-0002 §2.
//
// СПИСОК МАРКЕРОВ ЗАКРЫТ (ADR-0002 §1): расширение требует НОВОГО ADR. Поэтому неизвестный
// `[...]` — ошибка, а не пропуск. Пропуск был бы хуже отказа дважды: `[tpl: kenburns{zoom:1.2}]`
// молча ушёл бы в TTS как ничто, а автор увидел бы пропажу только в готовом ролике.
//
// ИМЕНА ЯКОРЕЙ ПРОВЕРЯЮТСЯ СХЕМОЙ, А НЕ ВТОРОЙ КОПИЕЙ РЕГУЛЯРКИ. `publicAnchor()` из
// `@vpe/schema` — то самое место, где записано ADR-0004 §1; если `[beat: имя]` пройдёт здесь,
// но не пройдёт в `direction/1`, автор получит ошибку в другом файле и не поймёт, за что.
// Поэтому лексер спрашивает у схемы: «`b:<name>` — законный публичный якорь?».

import { publicAnchor } from '@vpe/schema';

import {
  at,
  fail,
  indexOfPoint,
  isWhitespace,
  sliceSource,
  spanOf,
  trimRange,
  type SourceText,
  type Span,
} from './text.js';

const KNOWN_MARKERS =
  'Диалект знает ровно семь позиций таблицы ADR-0002 §2: `# chapter: id`, `## scene: id`, ' +
  '`[beat: name]`, `[pause: Nms]`, `[say: display | spoken]`, `[img: alias]`, `[emph]`.';

const NEW_ADR = 'Расширение списка маркеров требует НОВОГО ADR (ADR-0002 §1), а не правки лексера.';

/** Маркер, каким его увидел лексер: разбор синтаксиса без единого правила расстановки. */
export type RawMarker =
  | { readonly kind: 'beat'; readonly name: string; readonly span: Span }
  | { readonly kind: 'pause'; readonly ms: number; readonly span: Span }
  | {
      readonly kind: 'say';
      readonly display: string;
      readonly spoken: string;
      readonly span: Span;
      readonly displaySpan: Span;
      readonly spokenSpan: Span;
    }
  | { readonly kind: 'img'; readonly alias: string; readonly span: Span }
  | { readonly kind: 'emph'; readonly span: Span };

export type InlineItem =
  | { readonly kind: 'prose'; readonly start: number; readonly end: number }
  | { readonly kind: 'marker'; readonly marker: RawMarker };

export type Block =
  | {
      readonly kind: 'heading';
      readonly word: 'chapter' | 'scene';
      readonly id: string;
      readonly idOffset: number;
      readonly span: Span;
    }
  | { readonly kind: 'text'; readonly start: number; readonly end: number };

/**
 * Имя якоря обязано быть законным ПУБЛИЧНЫМ якорем (ADR-0004 §1) в своём пространстве имён.
 *
 * Для `[img: alias]` проверяется `b:<alias>`, хотя минтить будет `b:img-<alias>-<n>` в `C-04`:
 * алфавит тот же, а собирать здесь будущее имя значило бы минтить его (запрещено заданием).
 */
function requireAnchorName(
  src: SourceText,
  offset: number,
  namespace: 'b' | 'ch' | 'sc',
  name: string,
  what: string,
): void {
  if (name === '') {
    fail(src, offset, 'ADR-0004 §1', `${what}: имя пустое`);
  }
  if (!publicAnchor().safeParse(`${namespace}:${name}`).success) {
    fail(
      src,
      offset,
      'ADR-0004 §1',
      `${what}: \`${name}\` — не имя якоря. Первый символ — буква или цифра, дальше буквы, ` +
        'цифры, `-` и `_` (`publicAnchor()` в `@vpe/schema`, ADR-0004 §1).',
    );
  }
}

/** Разбирает один маркер, начиная с `[` по смещению `open`. Границу абзаца не пересекает. */
export function lexMarker(src: SourceText, open: number, limit: number): RawMarker {
  let close = -1;
  for (let i = open + 1; i < limit; i += 1) {
    const ch = at(src, i);
    if (ch === '[') {
      fail(src, i, 'ADR-0002 §1', 'вложенный `[` внутри маркера: маркеры беспараметрические и не вкладываются');
    }
    if (ch === ']') {
      close = i;
      break;
    }
  }
  if (close === -1) {
    fail(src, open, 'ADR-0002 §2', 'маркер не закрыт: до конца абзаца нет `]`');
  }
  const span = spanOf(src, open, close + 1);
  const inner = { start: open + 1, end: close };
  const colon = indexOfPoint(src, inner.start, inner.end, ':');

  if (colon === -1) {
    const word = trimRange(src, inner.start, inner.end);
    const text = sliceSource(src, word.start, word.end);
    if (text === 'emph') return { kind: 'emph', span };
    fail(src, open, 'ADR-0002 §1', `неизвестный маркер \`[${text}]\`. ${KNOWN_MARKERS} ${NEW_ADR}`);
  }

  const keywordRange = trimRange(src, inner.start, colon);
  const keyword = sliceSource(src, keywordRange.start, keywordRange.end);
  const rest = trimRange(src, colon + 1, inner.end);
  const restText = sliceSource(src, rest.start, rest.end);

  switch (keyword) {
    case 'beat': {
      requireAnchorName(src, rest.start, 'b', restText, '`[beat: name]`');
      return { kind: 'beat', name: restText, span };
    }
    case 'img': {
      requireAnchorName(src, rest.start, 'b', restText, '`[img: alias]`');
      return { kind: 'img', alias: restText, span };
    }
    case 'pause': {
      const match = /^(?<digits>[0-9]+)ms$/u.exec(restText);
      const digits = match?.groups?.['digits'];
      if (digits === undefined) {
        fail(
          src,
          rest.start,
          'ADR-0002 §2',
          `\`[pause: ${restText}]\`: величина паузы — целое число миллисекунд с единицей \`ms\`, ` +
            'например `[pause: 400ms]`. Миллисекунды — единственная единица авторского слоя (ADR-0003 T1).',
        );
      }
      const ms = Number(digits);
      if (!Number.isSafeInteger(ms)) {
        fail(src, rest.start, 'ADR-0003 T1', `\`[pause: ${restText}]\`: величина вышла за пределы точного целого`);
      }
      return { kind: 'pause', ms, span };
    }
    case 'say': {
      const pipe = indexOfPoint(src, colon + 1, inner.end, '|');
      if (pipe === -1) {
        fail(src, open, 'ADR-0002 §2', '`[say:]` без разделителя: форма — `[say: display | spoken]`');
      }
      if (indexOfPoint(src, pipe + 1, inner.end, '|') !== -1) {
        fail(src, open, 'ADR-0002 §2', '`[say:]` с двумя `|`: разделитель ровно один — `[say: display | spoken]`');
      }
      const displayRange = trimRange(src, colon + 1, pipe);
      const spokenRange = trimRange(src, pipe + 1, inner.end);
      const display = sliceSource(src, displayRange.start, displayRange.end);
      const spoken = sliceSource(src, spokenRange.start, spokenRange.end);
      if (display === '') fail(src, open, 'ADR-0002 §2', '`[say:]`: пустая display-часть (слева от `|`)');
      if (spoken === '') fail(src, open, 'ADR-0002 §2', '`[say:]`: пустая spoken-часть (справа от `|`)');
      return {
        kind: 'say',
        display,
        spoken,
        span,
        displaySpan: spanOf(src, displayRange.start, displayRange.end),
        spokenSpan: spanOf(src, spokenRange.start, spokenRange.end),
      };
    }
    default:
      fail(src, open, 'ADR-0002 §1', `неизвестный маркер \`[${keyword}: …]\`. ${KNOWN_MARKERS} ${NEW_ADR}`);
  }
}

/**
 * Разбирает содержимое абзаца на прозу и маркеры.
 *
 * `#` В ПРОЗЕ — ОШИБКА. Таблица ADR-0002 §2 разрешает `# chapter:`/`## scene:` только в начале
 * строки; заголовок, съехавший на середину строки, иначе молча стал бы прозой и ушёл в TTS
 * вместе с решёткой. Это то же правило, что и «неизвестный маркер — ошибка»: пунктуация
 * диалекта закрыта.
 */
export function lexInline(src: SourceText, start: number, end: number): InlineItem[] {
  const items: InlineItem[] = [];
  let proseStart = start;
  let i = start;
  while (i < end) {
    const ch = at(src, i);
    if (ch === '#') {
      fail(
        src,
        i,
        'ADR-0002 §2',
        '`#` в прозе: заголовки `# chapter: id` и `## scene: id` допустимы только в НАЧАЛЕ строки',
      );
    }
    if (ch === ']') {
      fail(src, i, 'ADR-0002 §2', '`]` без открывающего `[`');
    }
    if (ch !== '[') {
      i += 1;
      continue;
    }
    if (i > proseStart) items.push({ kind: 'prose', start: proseStart, end: i });
    const marker = lexMarker(src, i, end);
    items.push({ kind: 'marker', marker });
    i = marker.span.end;
    proseStart = i;
  }
  if (end > proseStart) items.push({ kind: 'prose', start: proseStart, end });
  return items;
}

/** Заголовок: `#`/`##`, слово, `:`, идентификатор. Разбирается по code points, не регуляркой. */
function lexHeading(src: SourceText, lineStart: number, lineEnd: number): Block {
  let i = lineStart;
  let hashes = 0;
  while (at(src, i) === '#') {
    hashes += 1;
    i += 1;
  }
  if (hashes > 2) {
    fail(src, lineStart, 'ADR-0002 §2', 'уровней заголовка ровно два: `# chapter: id` и `## scene: id`');
  }
  while (i < lineEnd && isWhitespace(at(src, i))) i += 1;
  const wordStart = i;
  while (i < lineEnd && /[A-Za-z]/u.test(at(src, i))) i += 1;
  const word = sliceSource(src, wordStart, i);
  while (i < lineEnd && isWhitespace(at(src, i))) i += 1;
  if (at(src, i) !== ':') {
    fail(src, lineStart, 'ADR-0002 §2', 'заголовок обязан иметь форму `# chapter: id` или `## scene: id`');
  }
  if (word !== 'chapter' && word !== 'scene') {
    fail(
      src,
      wordStart,
      'ADR-0002 §2',
      `\`${word}\` — не заголовок диалекта. Их два: \`# chapter: id\` и \`## scene: id\`. ${NEW_ADR}`,
    );
  }
  if (word === 'chapter' && hashes !== 1) {
    fail(src, lineStart, 'ADR-0002 §2', 'глава — один `#`: `# chapter: id`');
  }
  if (word === 'scene' && hashes !== 2) {
    fail(src, lineStart, 'ADR-0002 §2', 'сцена — два `#`: `## scene: id`');
  }
  const idRange = trimRange(src, i + 1, lineEnd);
  const id = sliceSource(src, idRange.start, idRange.end);
  requireAnchorName(src, idRange.start, word === 'chapter' ? 'ch' : 'sc', id, `\`${word}\``);
  return { kind: 'heading', word, id, idOffset: idRange.start, span: spanOf(src, lineStart, lineEnd) };
}

/**
 * Тело файла → блоки: заголовки и куски текста между пустыми строками.
 *
 * Абзац может занимать несколько строк (мягкий перенос markdown). Пустая строка и заголовок
 * абзац закрывают — заголовок режет чанк по таблице ADR-0002 §2.
 */
export function lexBlocks(src: SourceText): Block[] {
  const blocks: Block[] = [];
  let textStart = -1;
  let textEnd = -1;

  const flush = (): void => {
    if (textStart >= 0) {
      blocks.push({ kind: 'text', start: textStart, end: textEnd });
      textStart = -1;
    }
  };

  let lineStart = src.bodyStart;
  while (lineStart < src.length) {
    let lineEnd = lineStart;
    while (lineEnd < src.length && at(src, lineEnd) !== '\n') lineEnd += 1;

    const trimmed = trimRange(src, lineStart, lineEnd);
    if (trimmed.start === trimmed.end) {
      flush();
    } else if (at(src, lineStart) === '#') {
      flush();
      blocks.push(lexHeading(src, lineStart, lineEnd));
    } else {
      if (textStart < 0) textStart = lineStart;
      textEnd = lineEnd;
    }
    lineStart = lineEnd + 1;
  }
  flush();
  return blocks;
}
