// Трансдьюсер: AST → (spoken-текст, display-текст, карта между ними). ADR-0010 §10.
//
// ЧТО ОН ТАКОЕ. «Нормализатор-трансдьюсер = identity + подстановка `[say:]`» (ADR-0002 §3).
// Никакого переписывания чисел, дат и денег здесь нет и быть не может: линт прозы
// (`lint.ts`) гарантирует, что переписывать нечего, а всё, что нужно прочесть иначе, автор
// написал сам в `[say: display | spoken]`.
//
// ЭТО СТАДИЯ НАД AST, А НЕ ВТОРОЙ ПАРСЕР. Текст исходника здесь не разбирается ни разу:
// spoken-текст и прогоны `copy`/`space` уже посчитал `C-02` (`Chunk.spoken`,
// `Chunk.spanMap`), `[say:]` уже разобран в ОДИН токен с `displaySpan`/`spokenSpan`.
// Трансдьюсер добавляет ровно одно: display-СТОРОНУ у каждого прогона и третий вид прогона.
//
// ТРИ ВИДА ПРОГОНА, И ТРЕТИЙ — ЕДИНСТВЕННАЯ ВСТАВКА:
//   * `copy`  — символ spoken = символ display = символ исходника;
//   * `space` — ряд пробельных, схлопнутый в один `U+0020` (решение владельца `C-02`):
//               длина 1 с обеих сторон, оба смещения — на ПЕРВЫЙ символ ряда;
//   * `say`   — `[say: d | s]`: `spokenLength = |s|`, `displayLength = |d|`, и они НЕ равны.
// Именно этого требует ADR-0010 §10: «`[say:]` подставляет РАЗНОЕ в речь и в субтитр —
// вырезанием это не выражается»; карта обязана иметь вставки, а не только удаления.
//
// ЕДИНИЦА ИНДЕКСАЦИИ — CODE POINT, ВЕЗДЕ И БЕЗ ИСКЛЮЧЕНИЙ. `FACT` (SP-2, U4.2 + SP-2b.2):
// длина `alignment.characters` совпала с числом code points на 28/28 строк каждого из двух
// голосов; с UTF-16 units — на 26, с графемами — на 26. `INFERENCE` (ADR-0010 §10):
// реализация, индексирующая spoken через `str[i]` или `str.length`, разъедется с
// `alignment` на первом же эмодзи — и разъедется МОЛЧА, потому что `charIdentity` при этом
// останется истинным. Поэтому в этом модуле нет ни одного `str[i]` и ни одного `.length` по
// строке: только `[...text]`. `Intl.Segmenter` не используется — он дал бы НЕВЕРНУЮ единицу
// (графемы) и запрещён Charter V8.

import {
  chunksIn,
  displaySpanOf,
  type Chunk,
  type SourceDocument,
  type TokenNode,
} from './ast.js';
import { pointLength } from './text.js';

export type TextRunKind = 'copy' | 'space' | 'say';

/**
 * Прогон карты в ТРЁХ системах координат: spoken-текст чанка, display-текст чанка и
 * нормализованный поток исходника.
 *
 * Инвариант формы: у `copy` и `space` длины сторон равны, у `say` — нет. Литерал `display`
 * присутствует ТОЛЬКО у `say`: без него `reconstructDisplay` физически не может восстановить
 * то, чего в spoken-тексте нет.
 */
export interface TextRun {
  readonly kind: TextRunKind;
  readonly spokenStart: number;
  readonly spokenLength: number;
  readonly displayStart: number;
  readonly displayLength: number;
  /** Смещение в исходнике для spoken-стороны прогона (у `say` — внутрь `s`). */
  readonly spokenSource: number;
  /** Смещение в исходнике для display-стороны прогона (у `say` — внутрь `d`). */
  readonly displaySource: number;
  /** `d` целиком. Только у `kind === 'say'`. */
  readonly display?: string;
}

/** Выход трансдьюсера для одного чанка. */
export interface ChunkText {
  /** Ровно то, что уйдёт провайдеру (`Chunk.spoken`, identity). */
  readonly spoken: string;
  /** Ровно то, что уйдёт в субтитр. */
  readonly display: string;
  readonly runs: readonly TextRun[];
}

/**
 * Происхождение одного code point spoken-текста. ТОТАЛЬНОСТЬ (ADR-0010 §10) в исполнимой
 * форме: для любого индекса внутри spoken функция возвращает ответ, а не `undefined`.
 *
 * `inserted === true` ⇔ символ пришёл из `s` маркера `[say:]`: прообраз в ИСХОДНИКЕ у него
 * есть всегда (`s` записан автором), а прообраза в DISPLAY нет — именно это и значит
 * «вставлен».
 */
export interface SpokenOrigin {
  readonly kind: TextRunKind;
  /** Смещение в нормализованном потоке исходника. Есть всегда. */
  readonly sourceOffset: number;
  /** Индекс в display-тексте чанка; отсутствует ровно тогда, когда `inserted`. */
  readonly displayIndex?: number;
  readonly inserted: boolean;
}

/** Дефект стадии, а не входа: вход к этому моменту уже разобран парсером. */
export class TransducerError extends Error {
  constructor(reason: string) {
    super(`трансдьюсер (ADR-0010 §10): ${reason}`);
    this.name = 'TransducerError';
  }
}

/**
 * Чанк → spoken-текст, display-текст и карта со вставками.
 *
 * Прогоны `C-02` берутся КАК ЕСТЬ; прогон, чьё начало совпадает с началом токена
 * `origin: 'say'` и чья длина равна длине его `spoken`, становится прогоном `say`.
 * Несовпадение — дефект `C-02`, и оно кончается исключением, а не молчаливым `copy`:
 * молчаливый `copy` дал бы display-текст, равный spoken-тексту, то есть субтитр
 * `twenty-three percent` вместо `23%` — ровно то, ради чего существует `[say:]`.
 */
export function transduceChunk(chunk: Chunk): ChunkText {
  const sayAt = new Map<number, TokenNode>();
  for (const node of chunk.nodes) {
    if (node.kind === 'token' && node.origin === 'say') sayAt.set(node.spokenStart, node);
  }

  const spokenPoints = [...chunk.spoken];
  const runs: TextRun[] = [];
  const display: string[] = [];
  let spokenSeen = 0;
  let displaySeen = 0;

  for (const run of chunk.spanMap) {
    if (run.spokenStart !== spokenSeen) {
      throw new TransducerError(
        `span-map чанка не покрывает spoken-текст подряд: прогон начинается с ` +
          `${String(run.spokenStart)}, а покрыто ${String(spokenSeen)} символов`,
      );
    }
    const spokenLength = run.kind === 'space' ? 1 : run.length;
    const say = run.kind === 'copy' ? sayAt.get(run.spokenStart) : undefined;

    if (say !== undefined) {
      if (pointLength(say.spoken) !== spokenLength) {
        throw new TransducerError(
          `токен \`[say:]\` в позиции ${String(run.spokenStart)} занимает ${String(spokenLength)} ` +
            `code points spoken-текста, а его \`s\` — ${String(pointLength(say.spoken))}`,
        );
      }
      const literal = say.surface;
      const displayLength = pointLength(literal);
      runs.push({
        kind: 'say',
        spokenStart: run.spokenStart,
        spokenLength,
        displayStart: displaySeen,
        displayLength,
        spokenSource: run.sourceStart,
        displaySource: displaySpanOf(say).start,
        display: literal,
      });
      display.push(literal);
      displaySeen += displayLength;
    } else {
      const piece = spokenPoints.slice(run.spokenStart, run.spokenStart + spokenLength).join('');
      runs.push({
        kind: run.kind,
        spokenStart: run.spokenStart,
        spokenLength,
        displayStart: displaySeen,
        displayLength: spokenLength,
        spokenSource: run.sourceStart,
        displaySource: run.sourceStart,
      });
      display.push(piece);
      displaySeen += spokenLength;
    }
    spokenSeen += spokenLength;
  }

  if (spokenSeen !== spokenPoints.length) {
    throw new TransducerError(
      `span-map покрыла ${String(spokenSeen)} из ${String(spokenPoints.length)} code points ` +
        'spoken-текста: тотальность нарушена',
    );
  }

  return { spoken: chunk.spoken, display: display.join(''), runs };
}

/** Все чанки документа в порядке исходника, пропущенные через трансдьюсер. */
export function transduceDocument(document: SourceDocument): ChunkText[] {
  return chunksIn(document).map(transduceChunk);
}

/**
 * ROUND-TRIP (ADR-0010 §10): display-текст, восстановленный ТОЛЬКО из spoken-текста и карты.
 *
 * Функция намеренно не видит ни AST, ни `ChunkText.display`: её единственный вход — то, что
 * переживёт сериализацию карты. Свойство `reconstructDisplay(spoken, runs) === display`
 * держится ровно тогда, когда карта покрывает spoken без дыр и нахлёстов, display-смещения
 * согласованы с длинами, а каждая вставка несёт свой литерал.
 *
 * @throws {TransducerError} карта не согласована со spoken-текстом.
 */
export function reconstructDisplay(spoken: string, runs: readonly TextRun[]): string {
  const points = [...spoken];
  const out: string[] = [];
  let spokenSeen = 0;
  let displaySeen = 0;

  for (const run of runs) {
    if (run.spokenStart !== spokenSeen) {
      throw new TransducerError(
        `дыра или нахлёст в карте: прогон начинается с ${String(run.spokenStart)}, ` +
          `покрыто ${String(spokenSeen)}`,
      );
    }
    if (run.displayStart !== displaySeen) {
      throw new TransducerError(
        `display-смещение прогона (${String(run.displayStart)}) не совпало с накопленной ` +
          `длиной display-текста (${String(displaySeen)})`,
      );
    }
    if (run.kind === 'say') {
      const literal = run.display;
      if (literal === undefined) {
        throw new TransducerError('прогон `say` без литерала display: восстановить нечем');
      }
      if (pointLength(literal) !== run.displayLength) {
        throw new TransducerError('длина литерала display не совпала с `displayLength` прогона');
      }
      out.push(literal);
    } else {
      if (run.displayLength !== run.spokenLength) {
        throw new TransducerError(
          `прогон \`${run.kind}\` обязан иметь равные длины сторон: ` +
            `${String(run.spokenLength)} против ${String(run.displayLength)}`,
        );
      }
      out.push(points.slice(run.spokenStart, run.spokenStart + run.spokenLength).join(''));
    }
    spokenSeen += run.spokenLength;
    displaySeen += run.displayLength;
  }

  if (spokenSeen !== points.length) {
    throw new TransducerError(
      `карта покрыла ${String(spokenSeen)} из ${String(points.length)} code points spoken-текста`,
    );
  }
  return out.join('');
}

/** Прогон, покрывающий индекс `spokenIndex`, или `undefined` за границами. Двоичный поиск. */
export function runAtSpokenIndex(runs: readonly TextRun[], spokenIndex: number): TextRun | undefined {
  let low = 0;
  let high = runs.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const run = runs[mid];
    if (run === undefined) return undefined;
    if (spokenIndex < run.spokenStart) high = mid - 1;
    else if (spokenIndex >= run.spokenStart + run.spokenLength) low = mid + 1;
    else return run;
  }
  return undefined;
}

/**
 * ТОТАЛЬНОСТЬ (ADR-0010 §10) в исполнимой форме: происхождение любого code point spoken.
 *
 * @throws {RangeError} индекс вне spoken-текста — это дефект вызывающего, а не входа
 *   (та же дисциплина, что у `spokenToSource` из `C-02`).
 */
export function spokenOrigin(text: ChunkText, spokenIndex: number): SpokenOrigin {
  const run = runAtSpokenIndex(text.runs, spokenIndex);
  if (run === undefined) {
    throw new RangeError(`трансдьюсер: символ №${String(spokenIndex)} вне spoken-текста чанка`);
  }
  const offset = spokenIndex - run.spokenStart;
  if (run.kind === 'say') {
    return { kind: 'say', sourceOffset: run.spokenSource + offset, inserted: true };
  }
  if (run.kind === 'space') {
    return {
      kind: 'space',
      sourceOffset: run.spokenSource,
      displayIndex: run.displayStart,
      inserted: false,
    };
  }
  return {
    kind: 'copy',
    sourceOffset: run.spokenSource + offset,
    displayIndex: run.displayStart + offset,
    inserted: false,
  };
}
