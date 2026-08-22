// AST диалекта `source/`. Формы узлов — по нормативной таблице ADR-0002 §2, ровно семь
// маркеров плюс восьмая строка таблицы (участок без маркера: у него нет узла вовсе — тишина
// по умолчанию берётся из `compileProfile` в `C-05`, а не из исходника).
//
// AST НЕ ПЕРСИСТИРУЕТСЯ (ADR-0002 §5): ни схемы, ни файла, ни миграций. Единственный выход
// наружу — `dumpAst` для отладки и golden-теста. Поэтому здесь нет ни одного поля «на будущее».
//
// ЧЕГО ЗДЕСЬ НЕТ И ПОЧЕМУ:
//   * ledger, минт `w:` и `b:img-<alias>-<n>` — `C-04` (ADR-0002 §4, ADR-0004 §2a);
//   * разворот `[img:]` в direction-запись — компилятор, `C-05`;
//   * Timeline, сэмплы дефолтных gap'ов (T8) — `C-05`;
//   * линт прозы и трансдьюсер `[say:]` как отдельная стадия — `C-03`.

import type { Samples } from '@vpe/schema';

import type { Span } from './text.js';

/**
 * Прогон span-map: `length` code points spoken-текста, начиная с `spokenStart`, соответствуют
 * `length` code points исходника, начиная с `sourceStart`.
 *
 * ДВА ВИДА, И РАЗЛИЧАТЬ ИХ ОБЯЗАТЕЛЬНО:
 *   * `copy` — тождество: символ spoken РАВЕН символу исходника;
 *   * `space` — ряд пробельных исходника, схлопнутый в один `U+0020` (решение владельца
 *     `C-02`; пометка у D8). Длина всегда 1, `sourceStart` — ПЕРВЫЙ символ ряда. Символ
 *     исходника здесь пробельный, но не обязан быть пробелом: таб или мягкий перенос строки.
 */
export interface SpanRun {
  readonly kind: 'copy' | 'space';
  readonly spokenStart: number;
  readonly sourceStart: number;
  readonly length: number;
}

/**
 * Токен исходника — единица якоря `w:` (ADR-0004 §5: поверхностная форма, не нормализованное
 * слово). Два происхождения:
 *   * `prose` — максимальный ряд непробельных символов; `surface === spoken`;
 *   * `say` — маркер `[say: display | spoken]` ЦЕЛИКОМ (ADR-0002 §2: «якорь `w:` на токен
 *     целиком»), поэтому `surface !== spoken` и у него есть отдельные `displaySpan`/`spokenSpan`.
 *
 * `span` — отрезок исходника, который токен занимает целиком (у `say` — от `[` до `]`).
 * `displaySpan`/`spokenSpan` присутствуют ТОЛЬКО когда отличаются от `span`; читать их
 * следует через `displaySpanOf`/`spokenSpanOf`, тогда правило «подстрока исходника по span
 * равна тексту» верно без оговорок.
 */
export interface TokenNode {
  readonly kind: 'token';
  readonly origin: 'prose' | 'say';
  readonly surface: string;
  readonly spoken: string;
  readonly span: Span;
  readonly displaySpan?: Span;
  readonly spokenSpan?: Span;
  /** Индекс первого символа токена в `spoken` своего чанка, в code points. */
  readonly spokenStart: number;
}

/** `[beat: name]` — якорь `b:`; в TTS не идёт, чанк не режет, денег не стоит. */
export interface BeatNode {
  readonly kind: 'beat';
  readonly name: string;
  /** `b:<name>`. ИМЯ якоря, а не запись ledger'а: ledger — `C-04`. */
  readonly anchor: string;
  readonly span: Span;
}

/**
 * `[emph]` — чисто визуальный маркер (ADR-0002 §2, ADR-0010). В spoken не добавляет ничего и
 * не ломает соседние токены.
 *
 * SCOPE У НЕГО ЗДЕСЬ НЕТ, И ЭТО РЕШЕНИЕ ВЛАДЕЛЬЦА (`C-02`, вариант «а»): дрейф roadmap §11.2
 * строка 16 остаётся открытым, закроет `CP-05` правкой нормативной таблицы. В AST маркер
 * виден как узел со span'ом и ПОЗИЦИЕЙ между токенами (порядок `Chunk.nodes`) — этого хватает
 * любому из трёх вариантов scope, и ни один из них здесь не выбран.
 */
export interface EmphNode {
  readonly kind: 'emph';
  readonly span: Span;
}

/**
 * `[img: alias]` — допустим только в начале предложения.
 *
 * Ни разворота в direction-запись, ни минта `b:img-<alias>-<n>` здесь НЕТ (ADR-0002 §4:
 * это компилятор). Ordinal тоже не считается — см. отчёт `C-02`, `UNKNOWN` для `C-04`.
 */
export interface ImgNode {
  readonly kind: 'img';
  readonly alias: string;
  readonly span: Span;
}

/** Узлы внутри чанка, в порядке исходника. */
export type ChunkNode = TokenNode | BeatNode | EmphNode | ImgNode;

/**
 * Чанк — то, что уйдёт в TTS одним запросом (ADR-0010 §3: чанк = абзац; здесь абзац уже
 * разрезан паузами внутри него).
 *
 * `spoken` — ровно те байты, которые считает `voiceKey` (ADR-0010 §3a). Сам `voiceKey`
 * считается не здесь: тут нет ни провайдера, ни голоса, ни `roleDigest`.
 *
 * `splitIndex` — номер части абзаца, как в формуле `chunkKey`. Структурное деление СЛИШКОМ
 * ДЛИННОГО абзаца (ADR-0010 §3) — задача `V-03`, здесь его нет: `splitIndex` растёт только
 * от `[pause:]` на границе предложения.
 */
export interface Chunk {
  readonly kind: 'chunk';
  readonly splitIndex: number;
  readonly span: Span;
  readonly spoken: string;
  readonly spanMap: readonly SpanRun[];
  readonly nodes: readonly ChunkNode[];
}

/**
 * `[pause: Nms]` ВНУТРИ абзаца, на границе предложения: режет чанк (таблица ADR-0002 §2 —
 * «да, только на границе предложения; иначе ошибка компиляции») и несёт N сэмплов тишины.
 */
export interface ChunkBreak {
  readonly kind: 'chunk-break';
  readonly ms: number;
  readonly samples: Samples;
  readonly span: Span;
}

/**
 * `[pause: Nms]` НА ГРАНИЦЕ абзаца: тишина N сэмплов, разреза нет (абзац уже граница чанка),
 * денег не стоит.
 */
export interface Silence {
  readonly kind: 'silence';
  readonly ms: number;
  readonly samples: Samples;
  readonly span: Span;
}

/**
 * Абзац. `ordinalInScene` 1-based — это `paragraphOrdinalInScene` из формулы `chunkKey`
 * (ADR-0010 §3a); счётчик ЛОКАЛЕН для сцены, сквозного по документу нет — иначе вставка
 * абзаца в первую сцену переименовала бы take-файлы всех последующих.
 */
export interface Paragraph {
  readonly kind: 'paragraph';
  readonly ordinalInScene: number;
  readonly span: Span;
  readonly parts: readonly (Chunk | ChunkBreak)[];
}

export interface Scene {
  readonly kind: 'scene';
  readonly id: string;
  /** `sc:<id>`. */
  readonly anchor: string;
  readonly span: Span;
  readonly blocks: readonly (Paragraph | Silence)[];
}

export interface Chapter {
  readonly kind: 'chapter';
  readonly id: string;
  /** `ch:<id>`. */
  readonly anchor: string;
  readonly span: Span;
  readonly scenes: readonly Scene[];
}

/**
 * Корень. `sampleRate` попадает в дамп намеренно: без него числа `samples` в узлах тишины
 * нечитаемы, а умолчаний у него нет (ADR-0003, «fps = 30 — решение, а не умолчание»).
 */
export interface SourceDocument {
  readonly kind: 'document';
  readonly file: string;
  readonly sampleRate: number;
  readonly chapters: readonly Chapter[];
}

/** Отрезок исходника, подстрока по которому равна `surface` токена. */
export function displaySpanOf(token: TokenNode): Span {
  return token.displaySpan ?? token.span;
}

/** Отрезок исходника, подстрока по которому равна `spoken` токена. */
export function spokenSpanOf(token: TokenNode): Span {
  return token.spokenSpan ?? token.span;
}

/** Чанки абзаца без разрезов между ними. */
export function chunksOf(paragraph: Paragraph): Chunk[] {
  return paragraph.parts.filter((part): part is Chunk => part.kind === 'chunk');
}
