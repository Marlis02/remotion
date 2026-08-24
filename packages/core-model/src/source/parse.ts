// Парсер: блоки и маркеры → AST. Здесь живут ПРАВИЛА РАССТАНОВКИ из нормативной таблицы
// ADR-0002 §2 — те, что обязан выполнить парсер, а не линт прозы (`C-03`).
//
// ЧЕТЫРЕ ПРАВИЛА ТАБЛИЦЫ, ИСПОЛНИМЫЕ ЗДЕСЬ:
//   1. `[say: d | s]` — в spoken идёт `s`, в display `d`, токен один целиком;
//   2. `[emph]` — в spoken не добавляет ничего и не ломает соседние токены;
//   3. `[pause:]` — три положения: между абзацами (тишина, без разреза, бесплатно), внутри
//      абзаца на границе предложения (разрез чанка, платно), внутри абзаца НЕ на границе
//      предложения (ошибка компиляции с `файл:строка:колонка`);
//   4. `[img: alias]` — только в начале предложения.
//
// ГРАНИЦА ПРЕДЛОЖЕНИЯ = `.`/`!`/`?`, за которым пробельный, конец абзаца или сам маркер.
// Основание — ADR-0002 §3: после линта прозы сокращений с точкой в прозе нет, поэтому точка
// однозначна. Другого определения ADR не даёт; расширения (закрывающая кавычка после точки)
// здесь НЕ придуманы — см. отчёт `C-02`, раздел `UNKNOWN`.
//
// СХЛОПЫВАНИЕ ПРОБЕЛЬНЫХ — РЕШЕНИЕ ВЛАДЕЛЬЦА (`C-02`, вариант «а»). Ряд пробельных внутри
// абзаца даёт ОДИН `U+0020`, span указывает на первый символ ряда. Без этого правила снятый
// `[beat: reveal]` оставлял бы два пробела подряд, то есть менял `spokenChunkText` ⇒ менял
// `voiceKey` ⇒ вызывал платную перегенерацию маркером, который по таблице БЕСПЛАТЕН.
// Это расширение ADR-0002 §8 (там только NFC + `\n`); записано пометкой у D8 в invariants.

import { msToSamples } from '../time/ms.js';
import type {
  Chapter,
  Chunk,
  ChunkBreak,
  ChunkNode,
  Paragraph,
  Scene,
  Silence,
  SourceDocument,
  SpanRun,
} from './ast.js';
import { lexBlocks, lexInline, type Block, type InlineItem, type RawMarker } from './lexer.js';
import {
  at,
  fail,
  isWhitespace,
  sliceSource,
  sourceText,
  spanOf,
  type SourceText,
  type Span,
} from './text.js';

const SENTENCE_END = new Set(['.', '!', '?']);

/**
 * Знак конца предложения — ПЕРВАЯ ПОЛОВИНА правила из шапки этого файла
 * («граница предложения = `.`/`!`/`?`, за которым пробельный, конец абзаца или сам маркер»).
 * Вторая половина — про то, что стоит СПРАВА, — у каждого потребителя своя: парсер смотрит на
 * следующий элемент строки, деление длинного абзаца (`V-03`, ADR-0010 §3) — на следующий
 * code point spoken-текста.
 *
 * ЗАЧЕМ ЭКСПОРТ (решение владельца 2026-08-24, `V-03` вопрос 2): правило границы предложения в
 * репозитории ОДНО. Вторая копия набора знаков означала бы, что `[pause:]` законен там, где
 * деление резать не станет, и наоборот, — то есть автор видит два разных ответа на один
 * вопрос. Реэкспортируется через `packages/core-model/src/index.ts` тем же адресным блоком.
 */
export function isSentenceEnd(point: string): boolean {
  return SENTENCE_END.has(point);
}

export interface ParseOptions {
  /** Путь файла — попадает в каждое сообщение об ошибке. Диск лексер не читает (M3). */
  readonly file: string;
  /** `projectSampleRate` из `compileProfile`. Умолчания нет (ADR-0003). */
  readonly sampleRate: number;
}

interface SceneBuild {
  readonly kind: 'scene';
  readonly id: string;
  readonly anchor: string;
  readonly span: Span;
  readonly blocks: (Paragraph | Silence)[];
  paragraphs: number;
}

interface ChapterBuild {
  readonly kind: 'chapter';
  readonly id: string;
  readonly anchor: string;
  readonly span: Span;
  readonly scenes: SceneBuild[];
}

/** Накопитель одного чанка: spoken-текст, span-map и узлы в порядке исходника. */
interface ChunkBuild {
  splitIndex: number;
  points: string[];
  runs: SpanRun[];
  nodes: ChunkNode[];
  from: number;
  to: number;
  /** Смещение ПЕРВОГО пробельного символа неотданного ряда; `-1` — ряда нет. */
  pendingSpaceAt: number;
}

function newChunk(splitIndex: number): ChunkBuild {
  return { splitIndex, points: [], runs: [], nodes: [], from: -1, to: -1, pendingSpaceAt: -1 };
}

function noteSpace(build: ChunkBuild, offset: number): void {
  if (build.pendingSpaceAt < 0) build.pendingSpaceAt = offset;
}

/** Ряд пробельных → один `U+0020`. Ведущий ряд чанка отбрасывается, хвостовой — тоже. */
function flushSpace(build: ChunkBuild): void {
  if (build.pendingSpaceAt < 0) return;
  if (build.points.length > 0) {
    build.runs.push({
      kind: 'space',
      spokenStart: build.points.length,
      sourceStart: build.pendingSpaceAt,
      length: 1,
    });
    build.points.push(' ');
  }
  build.pendingSpaceAt = -1;
}

function appendCopy(build: ChunkBuild, sourceStart: number, text: string): number {
  const spokenStart = build.points.length;
  const points = [...text];
  build.runs.push({ kind: 'copy', spokenStart, sourceStart, length: points.length });
  build.points.push(...points);
  return spokenStart;
}

function pushNode(build: ChunkBuild, node: ChunkNode): void {
  build.nodes.push(node);
  if (build.from < 0 || node.span.start < build.from) build.from = node.span.start;
  if (node.span.end > build.to) build.to = node.span.end;
}

function finishChunk(src: SourceText, build: ChunkBuild): Chunk {
  const from = build.from < 0 ? 0 : build.from;
  const to = build.to < 0 ? 0 : build.to;
  return {
    kind: 'chunk',
    splitIndex: build.splitIndex,
    span: spanOf(src, from, to),
    spoken: build.points.join(''),
    spanMap: build.runs,
    nodes: build.nodes,
  };
}

/**
 * `[pause: Nms]` → сэмплы через `msToSamples` (ADR-0003 T1, единственная функция перевода).
 * Отказ переводится в ошибку С МЕСТОМ: `TimeModelError` знает правило, но не знает файла.
 */
function pauseSamples(src: SourceText, marker: { ms: number; span: Span }, sampleRate: number): ReturnType<typeof msToSamples> {
  try {
    return msToSamples(marker.ms, sampleRate);
  } catch (error) {
    return fail(src, marker.span.start, 'ADR-0003 T1', `\`[pause: ${String(marker.ms)}ms]\`: ${(error as Error).message}`);
  }
}

/** Даёт ли элемент хоть один символ spoken-текста. */
function contributesSpoken(src: SourceText, item: InlineItem): boolean {
  if (item.kind === 'marker') return item.marker.kind === 'say';
  for (let i = item.start; i < item.end; i += 1) {
    if (!isWhitespace(at(src, i))) return true;
  }
  return false;
}

function lastNonSpaceOf(value: string): string {
  const points = [...value];
  for (let i = points.length - 1; i >= 0; i -= 1) {
    const ch = points[i] ?? '';
    if (!isWhitespace(ch)) return ch;
  }
  return '';
}

interface BlockContext {
  readonly sampleRate: number;
  readonly scene: SceneBuild;
  readonly registerAnchor: (anchor: string, span: Span) => void;
}

/** Текстовый блок между пустыми строками → абзац плюс, возможно, узлы тишины вокруг него. */
function parseTextBlock(src: SourceText, block: { start: number; end: number }, ctx: BlockContext): void {
  const items = lexInline(src, block.start, block.end);

  // Есть ли spoken-текст ПОСЛЕ элемента `i`. Нужно, чтобы отличить `[pause:]` на границе
  // абзаца (тишина) от `[pause:]` внутри него (разрез): «внутри» — значит текст с обеих сторон.
  const spokenAfter: boolean[] = new Array<boolean>(items.length + 1).fill(false);
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    spokenAfter[i] = (spokenAfter[i + 1] ?? false) || (item !== undefined && contributesSpoken(src, item));
  }

  const before: Silence[] = [];
  const after: Silence[] = [];
  const parts: (Chunk | ChunkBreak)[] = [];
  let build = newChunk(0);
  let spokenSeen = false;
  let lastNonSpace = '';

  const atSentenceStart = (): boolean => !spokenSeen || SENTENCE_END.has(lastNonSpace);

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item === undefined) continue;

    if (item.kind === 'prose') {
      let i = item.start;
      while (i < item.end) {
        if (isWhitespace(at(src, i))) {
          noteSpace(build, i);
          i += 1;
          continue;
        }
        const tokenStart = i;
        while (i < item.end && !isWhitespace(at(src, i))) i += 1;
        flushSpace(build);
        const surface = sliceSource(src, tokenStart, i);
        const spokenStart = appendCopy(build, tokenStart, surface);
        pushNode(build, {
          kind: 'token',
          origin: 'prose',
          surface,
          spoken: surface,
          span: spanOf(src, tokenStart, i),
          spokenStart,
        });
        spokenSeen = true;
        lastNonSpace = lastNonSpaceOf(surface);
      }
      continue;
    }

    const marker: RawMarker = item.marker;
    switch (marker.kind) {
      case 'emph':
        pushNode(build, { kind: 'emph', span: marker.span });
        break;

      case 'beat': {
        const anchor = `b:${marker.name}`;
        ctx.registerAnchor(anchor, marker.span);
        pushNode(build, { kind: 'beat', name: marker.name, anchor, span: marker.span });
        break;
      }

      case 'img': {
        if (!atSentenceStart()) {
          fail(
            src,
            marker.span.start,
            'ADR-0002 §2',
            `\`[img: ${marker.alias}]\` допустим только в начале предложения; перед ним ` +
              `\`${lastNonSpace}\`, а предложение начинается после \`.\`/\`!\`/\`?\` или в начале абзаца`,
          );
        }
        pushNode(build, { kind: 'img', alias: marker.alias, span: marker.span });
        break;
      }

      case 'say': {
        flushSpace(build);
        const spokenStart = appendCopy(build, marker.spokenSpan.start, marker.spoken);
        pushNode(build, {
          kind: 'token',
          origin: 'say',
          surface: marker.display,
          spoken: marker.spoken,
          span: marker.span,
          displaySpan: marker.displaySpan,
          spokenSpan: marker.spokenSpan,
          spokenStart,
        });
        spokenSeen = true;
        lastNonSpace = lastNonSpaceOf(marker.spoken);
        break;
      }

      case 'pause': {
        const samples = pauseSamples(src, marker, ctx.sampleRate);
        const silence: Silence = { kind: 'silence', ms: marker.ms, samples, span: marker.span };
        if (!spokenSeen) {
          // Начало абзаца — «между абзацами» по таблице: тишина, разреза нет, денег не стоит.
          before.push(silence);
          break;
        }
        if (!(spokenAfter[index + 1] ?? false)) {
          after.push(silence);
          break;
        }
        if (!SENTENCE_END.has(lastNonSpace)) {
          fail(
            src,
            marker.span.start,
            'ADR-0002 §2',
            `\`[pause: ${String(marker.ms)}ms]\` внутри абзаца допустим ТОЛЬКО на границе предложения ` +
              `(иначе — ошибка компиляции): перед ним \`${lastNonSpace}\`, а граница — \`.\`/\`!\`/\`?\`. ` +
              'На границе абзацев пауза законна везде и ничего не стоит.',
          );
        }
        if (build.points.length === 0) {
          fail(
            src,
            marker.span.start,
            'ADR-0002 §2',
            `\`[pause: ${String(marker.ms)}ms]\` сразу после предыдущего разреза: чанк между ними пуст`,
          );
        }
        parts.push(finishChunk(src, build));
        parts.push({ kind: 'chunk-break', ms: marker.ms, samples, span: marker.span });
        build = newChunk(build.splitIndex + 1);
        break;
      }
    }
  }

  parts.push(finishChunk(src, build));
  const empty = parts.every((part) => part.kind !== 'chunk' || (part.spoken === '' && part.nodes.length === 0));

  ctx.scene.blocks.push(...before);
  if (!empty) {
    ctx.scene.paragraphs += 1;
    ctx.scene.blocks.push({
      kind: 'paragraph',
      ordinalInScene: ctx.scene.paragraphs,
      span: spanOf(src, block.start, block.end),
      parts,
    });
  }
  ctx.scene.blocks.push(...after);
}

/**
 * Разбирает файл диалекта `source/` целиком.
 *
 * Вход — ТЕКСТ, а не путь: `core-model` не умеет читать диск (M3, ADR-0009). Первая строка —
 * шапка семейства, лексер её пропускает не интерпретируя (P3: шапку читает `readFamily`).
 *
 * @throws {SourceParseError} любое нарушение диалекта; сообщение начинается с `файл:строка:колонка`.
 */
export function parseSource(raw: string, options: ParseOptions): SourceDocument {
  const src = sourceText(options.file, raw);
  const blocks: Block[] = lexBlocks(src);
  const anchors = new Map<string, number>();
  const chapters: ChapterBuild[] = [];
  let chapter: ChapterBuild | undefined;
  let scene: SceneBuild | undefined;

  const registerAnchor = (anchor: string, span: Span): void => {
    const seen = anchors.get(anchor);
    if (seen !== undefined) {
      fail(
        src,
        span.start,
        'ADR-0004 §1',
        `якорь \`${anchor}\` уже объявлен в строке ${String(seen)}: живые id уникальны (ADR-0004 §4), ` +
          'иначе direction-запись применилась бы к чужому месту',
      );
    }
    anchors.set(anchor, span.line);
  };

  for (const block of blocks) {
    if (block.kind === 'heading') {
      if (block.word === 'chapter') {
        const anchor = `ch:${block.id}`;
        registerAnchor(anchor, block.span);
        const next: ChapterBuild = { kind: 'chapter', id: block.id, anchor, span: block.span, scenes: [] };
        chapters.push(next);
        chapter = next;
        scene = undefined;
        continue;
      }
      if (chapter === undefined) {
        fail(
          src,
          block.span.start,
          'ADR-0010 §3a',
          '`## scene:` до первой `# chapter:`: `chunkKey` состоит из `chapterId ‖ sceneId ‖ ordinal`, ' +
            'у сцены вне главы его нет',
        );
      }
      const anchor = `sc:${block.id}`;
      registerAnchor(anchor, block.span);
      const next: SceneBuild = { kind: 'scene', id: block.id, anchor, span: block.span, blocks: [], paragraphs: 0 };
      chapter.scenes.push(next);
      scene = next;
      continue;
    }

    if (scene === undefined) {
      fail(
        src,
        block.start,
        'ADR-0010 §3a',
        'проза до первой `## scene:`: `chunkKey` состоит из `chapterId ‖ sceneId ‖ ordinal`, ' +
          'у чанка вне сцены его нет — и адресовать к нему нечего',
      );
    }
    parseTextBlock(src, block, { sampleRate: options.sampleRate, scene, registerAnchor });
  }

  return {
    kind: 'document',
    file: options.file,
    sampleRate: options.sampleRate,
    chapters: chapters.map(
      (built): Chapter => ({
        kind: 'chapter',
        id: built.id,
        anchor: built.anchor,
        span: built.span,
        scenes: built.scenes.map(
          (sceneBuilt): Scene => ({
            kind: 'scene',
            id: sceneBuilt.id,
            anchor: sceneBuilt.anchor,
            span: sceneBuilt.span,
            blocks: sceneBuilt.blocks,
          }),
        ),
      }),
    ),
  };
}
