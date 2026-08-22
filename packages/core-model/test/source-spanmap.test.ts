// `C-02` — span-map и инвариант D8.
//
// SPAN-MAP: каждый символ spoken-текста знает свой символ исходника и обратно. Это фундамент
// V1 (`characters.join('') === отправленный spoken-текст`) и V5; без него привязка токенов
// не строится вовсе (доказательство — ADR-0002 §5).
//
// D8: NFC + `\n` первым шагом. Проверяется тем, что NFD-версия с `\r\n` даёт БАЙТ-В-БАЙТ тот
// же spoken каждого чанка, те же позиции и те же имена якорей — то есть весь дамп AST целиком.
// «Тот же `voiceKey`» на этом этапе означает ровно это: `voiceKey` считается от
// `spokenChunkText` (ADR-0010 §3a), а провайдер, голос и `roleDigest` появятся в `V-03`.

import { describe, expect, it } from 'vitest';

import {
  chunksOf,
  displaySpanOf,
  dumpAst,
  normalizeSource,
  parseSource,
  pointLength,
  runAtSpoken,
  sourceText,
  sourceToSpoken,
  spanText,
  spokenSpanOf,
  spokenToSource,
  type Chunk,
  type Paragraph,
  type SourceDocument,
} from '../src/index.js';
import { FIXTURE_FILE, SAMPLE_RATE, doc, readFixture } from './source-helpers.js';

function allChunks(ast: SourceDocument): Chunk[] {
  return ast.chapters.flatMap((chapter) =>
    chapter.scenes.flatMap((scene) =>
      scene.blocks
        .filter((block): block is Paragraph => block.kind === 'paragraph')
        .flatMap((paragraph) => chunksOf(paragraph)),
    ),
  );
}

describe('span-map: round-trip по фикстуре', () => {
  const raw = readFixture();
  const src = sourceText(FIXTURE_FILE, raw);
  const ast = parseSource(raw, { file: FIXTURE_FILE, sampleRate: SAMPLE_RATE });
  const chunks = allChunks(ast);

  it('фикстура даёт чанки, иначе тест ниже проверял бы пустоту', () => {
    expect(chunks.length).toBeGreaterThan(5);
  });

  it('каждый символ spoken → исходный символ → тот же символ', () => {
    for (const chunk of chunks) {
      const points = [...chunk.spoken];
      for (let i = 0; i < points.length; i += 1) {
        const run = runAtSpoken(chunk, i);
        expect(run, `символ №${String(i)} не покрыт span-map`).toBeDefined();
        const source = src.points[spokenToSource(chunk, i)];
        if (run?.kind === 'space') {
          // Схлопнутый ряд пробельных: в spoken — `U+0020`, в исходнике — первый символ ряда
          // (пробел, таб или мягкий перенос). Решение владельца `C-02`, пометка у D8.
          expect(points[i]).toBe(' ');
          expect(source === ' ' || source === '\t' || source === '\n').toBe(true);
        } else {
          expect(source).toBe(points[i]);
        }
      }
    }
  });

  it('span-map покрывает spoken целиком и монотонна в code points', () => {
    for (const chunk of chunks) {
      let expected = 0;
      let previousSource = -1;
      for (const run of chunk.spanMap) {
        expect(run.spokenStart).toBe(expected);
        expect(run.sourceStart).toBeGreaterThan(previousSource);
        previousSource = run.sourceStart;
        expected += run.length;
      }
      expect(expected).toBe(pointLength(chunk.spoken));
    }
  });

  it('обратное направление: смещение исходника → тот же индекс spoken', () => {
    for (const chunk of chunks) {
      for (const run of chunk.spanMap) {
        if (run.kind !== 'copy') continue;
        for (let k = 0; k < run.length; k += 1) {
          expect(sourceToSpoken(chunk, run.sourceStart + k)).toBe(run.spokenStart + k);
        }
      }
    }
    // Символы маркеров в spoken не уходят: `[emph]` целиком вне карты.
    const emph = chunks.flatMap((chunk) => chunk.nodes).find((node) => node.kind === 'emph');
    expect(emph).toBeDefined();
    const owner = chunks.find((chunk) => chunk.nodes.some((node) => node.kind === 'emph'));
    expect(sourceToSpoken(owner as Chunk, (emph?.span.start ?? 0) + 1)).toBeUndefined();
  });

  it('подстрока исходника по span токена равна его тексту — с учётом `[say:]`', () => {
    let says = 0;
    for (const chunk of chunks) {
      for (const node of chunk.nodes) {
        if (node.kind !== 'token') continue;
        expect(spanText(src, displaySpanOf(node))).toBe(node.surface);
        expect(spanText(src, spokenSpanOf(node))).toBe(node.spoken);
        if (node.origin === 'say') {
          says += 1;
          // Токен целиком — это маркер от `[` до `]`; display и spoken живут ВНУТРИ него.
          expect(spanText(src, node.span).startsWith('[say:')).toBe(true);
          expect(node.surface).not.toBe(node.spoken);
        } else {
          expect(node.displaySpan).toBeUndefined();
          expect(node.spokenSpan).toBeUndefined();
        }
        const slice = [...chunk.spoken].slice(node.spokenStart, node.spokenStart + pointLength(node.spoken)).join('');
        expect(slice).toBe(node.spoken);
      }
    }
    expect(says).toBe(3);
  });
});

describe('D8 — NFC + `\\n` первым шагом', () => {
  // Кейс, названный самой строкой D8: `café` = `caf` + U+00E9 против `caf` + `e` + U+0301.
  // Литералы записаны escape-последовательностями намеренно: тест про БАЙТЫ не имеет права
  // зависеть от того, в какой форме редактор сохранил свой собственный исходник.
  const PRECOMPOSED = 'caf\u00e9';
  const DECOMPOSED = 'cafe\u0301';
  const body = [
    '# chapter: main',
    '',
    '## scene: intro',
    '',
    `[img: harbour] The ${PRECOMPOSED} opened. [beat: reveal] Ships came in.`,
    '',
    `[pause: 400ms] The ${PRECOMPOSED} closed.`,
  ];
  const nfc = doc(...body);
  const nfd = nfc.normalize('NFD').replace(/\n/gu, '\r\n');

  it('входы РАЗНЫЕ до нормализации — иначе тест был бы тавтологией', () => {
    expect(nfd).not.toBe(nfc);
    expect(Buffer.from(nfd, 'utf8').length).toBeGreaterThan(Buffer.from(nfc, 'utf8').length);
    expect(nfc).toContain(PRECOMPOSED);
    expect(nfc).not.toContain(DECOMPOSED);
    expect(nfd).toContain(DECOMPOSED);
    expect(nfd).not.toContain(PRECOMPOSED);
  });

  it('нормализация приводит их к одному потоку', () => {
    expect(normalizeSource(nfd)).toBe(normalizeSource(nfc));
  });

  it('spoken каждого чанка — байт-в-байт тот же, позиции и имена якорей — те же', () => {
    const a = parseSource(nfc, { file: 'd8.md', sampleRate: SAMPLE_RATE });
    const b = parseSource(nfd, { file: 'd8.md', sampleRate: SAMPLE_RATE });

    const spokenA = allChunks(a).map((chunk) => Buffer.from(chunk.spoken, 'utf8').toString('hex'));
    const spokenB = allChunks(b).map((chunk) => Buffer.from(chunk.spoken, 'utf8').toString('hex'));
    expect(spokenB).toEqual(spokenA);
    expect(spokenA.length).toBe(2);

    // Позиции, span-map, якоря и всё остальное — один и тот же дамп целиком.
    expect(dumpAst(b)).toBe(dumpAst(a));
    expect(dumpAst(a)).toContain('"anchor":"b:reveal"');
  });

  it('D8 держится и на фикстуре: NFD-копия даёт тот же дамп', () => {
    const raw = readFixture();
    const a = parseSource(raw, { file: FIXTURE_FILE, sampleRate: SAMPLE_RATE });
    const b = parseSource(raw.normalize('NFD').replace(/\n/gu, '\r\n'), {
      file: FIXTURE_FILE,
      sampleRate: SAMPLE_RATE,
    });
    expect(dumpAst(b)).toBe(dumpAst(a));
  });
});

describe('схлопывание пробельных — решение владельца `C-02` (пометка у D8)', () => {
  const scene = ['# chapter: main', '', '## scene: intro', ''];
  const spokenOf = (line: string): string => {
    const ast = parseSource(doc(...scene, line), { file: 'ws.md', sampleRate: SAMPLE_RATE });
    const chunk = allChunks(ast)[0];
    if (chunk === undefined) throw new Error('нет чанка');
    return chunk.spoken;
  };

  it('бесплатный по таблице маркер не меняет ни одного байта spoken-текста', () => {
    const withMarker = Buffer.from(spokenOf('Ever bought. [beat: reveal] They sat here.'), 'utf8');
    const without = Buffer.from(spokenOf('Ever bought. They sat here.'), 'utf8');
    expect(withMarker.equals(without)).toBe(true);
  });

  it('то же верно для `[emph]` и для нескольких маркеров подряд', () => {
    const plain = spokenOf('Ever bought. They sat here.');
    expect(spokenOf('Ever bought. [emph] They sat here.')).toBe(plain);
    expect(spokenOf('Ever bought. [beat: one] [emph] [img: sea] They sat here.')).toBe(plain);
  });

  it('ведущие и хвостовые пробельные чанка снимаются', () => {
    expect(spokenOf('   Ever bought.   ')).toBe('Ever bought.');
  });
});
