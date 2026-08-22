// `C-02` — правила нормативной таблицы ADR-0002 §2, исполнимые парсером, и отказы.
//
// Каждый отказ проверяется ЧИСЛАМИ `строка:колонка`, а не фактом исключения: сообщение
// `файл:строка:колонка` — половина смысла лексера (ADR-0002 §5), и «ошибка есть» её не ловит.

import { describe, expect, it } from 'vitest';

import {
  SourceParseError,
  chunksOf,
  parseSource,
  type Chunk,
  type Paragraph,
  type Scene,
} from '../src/index.js';
import { SAMPLE_RATE, doc } from './source-helpers.js';

const FILE = 'test.md';

function parse(...lines: string[]): ReturnType<typeof parseSource> {
  return parseSource(doc(...lines), { file: FILE, sampleRate: SAMPLE_RATE });
}

/** Отказ с проверкой места. Возвращает ошибку, чтобы тест мог смотреть и на текст. */
function refusal(lines: string[], line: number, column: number): SourceParseError {
  let caught: unknown;
  try {
    parse(...lines);
  } catch (error) {
    caught = error;
  }
  expect(caught, 'ожидался отказ лексера, а разбор прошёл').toBeInstanceOf(SourceParseError);
  const error = caught as SourceParseError;
  expect(error.location).toEqual({ file: FILE, line, column });
  expect(error.message.startsWith(`${FILE}:${String(line)}:${String(column)}: `)).toBe(true);
  return error;
}

const SCENE = ['# chapter: main', '', '## scene: intro', ''];

function onlyScene(document: ReturnType<typeof parseSource>): Scene {
  const scene = document.chapters[0]?.scenes[0];
  if (scene === undefined) throw new Error('в разборе нет сцены');
  return scene;
}

function onlyParagraph(document: ReturnType<typeof parseSource>): Paragraph {
  const block = onlyScene(document).blocks.find((item): item is Paragraph => item.kind === 'paragraph');
  if (block === undefined) throw new Error('в разборе нет абзаца');
  return block;
}

function onlyChunk(document: ReturnType<typeof parseSource>): Chunk {
  const chunk = chunksOf(onlyParagraph(document))[0];
  if (chunk === undefined) throw new Error('в разборе нет чанка');
  return chunk;
}

describe('структура: глава, сцена, абзац', () => {
  it('`# chapter:` и `## scene:` дают якоря `ch:`/`sc:` и режут абзац', () => {
    const document = parse(...SCENE, 'First paragraph.', '', 'Second paragraph.');
    expect(document.chapters).toHaveLength(1);
    expect(document.chapters[0]?.anchor).toBe('ch:main');
    expect(onlyScene(document).anchor).toBe('sc:intro');
    expect(onlyScene(document).blocks).toHaveLength(2);
  });

  it('`ordinalInScene` считается ВНУТРИ сцены, сквозного счётчика по документу нет', () => {
    const document = parse(
      ...SCENE,
      'One.',
      '',
      'Two.',
      '',
      '## scene: turn',
      '',
      'Three.',
    );
    const scenes = document.chapters[0]?.scenes ?? [];
    const ordinals = scenes.map((scene) =>
      scene.blocks.filter((block): block is Paragraph => block.kind === 'paragraph').map((p) => p.ordinalInScene),
    );
    expect(ordinals).toEqual([[1, 2], [1]]);
  });

  it('абзац может занимать несколько строк: мягкий перенос становится одним пробелом', () => {
    const chunk = onlyChunk(parse(...SCENE, 'One line', 'and the next.'));
    expect(chunk.spoken).toBe('One line and the next.');
  });

  it('проза до первой `## scene:` — ошибка: у чанка вне сцены нет `chunkKey`', () => {
    const error = refusal(['# chapter: main', '', 'Prose without a scene.'], 4, 1);
    expect(error.message).toContain('chunkKey');
  });

  it('`## scene:` до первой `# chapter:` — ошибка того же класса', () => {
    refusal(['## scene: intro', '', 'Prose.'], 2, 1);
  });

  it('повторный якорь — ошибка: живые id уникальны (ADR-0004 §4)', () => {
    const error = refusal([...SCENE, 'Text [beat: reveal] and [beat: reveal] more.'], 6, 25);
    expect(error.message).toContain('b:reveal');
  });
});

describe('таблица ADR-0002 §2: `[say:]`, `[emph]`, `[beat:]`', () => {
  it('`[say: d | s]` — в spoken идёт `s`, в display `d`, токен ОДИН целиком', () => {
    const chunk = onlyChunk(parse(...SCENE, 'Almost [say: 200 | two hundred] years.'));
    expect(chunk.spoken).toBe('Almost two hundred years.');
    const say = chunk.nodes.find((node) => node.kind === 'token' && node.origin === 'say');
    expect(say).toBeDefined();
    if (say?.kind !== 'token') throw new Error('say-токен не найден');
    expect(say.surface).toBe('200');
    expect(say.spoken).toBe('two hundred');
    expect(chunk.nodes.filter((node) => node.kind === 'token')).toHaveLength(3);
  });

  it('`[emph]` в spoken не добавляет ничего и не ломает соседние токены', () => {
    const withEmph = onlyChunk(parse(...SCENE, 'What it [emph] cost.'));
    const without = onlyChunk(parse(...SCENE, 'What it cost.'));
    expect(withEmph.spoken).toBe(without.spoken);
    expect(withEmph.spoken).not.toContain('emph');
    expect(withEmph.nodes.filter((node) => node.kind === 'token').map((node) => node.surface)).toEqual(
      without.nodes.filter((node) => node.kind === 'token').map((node) => node.surface),
    );
    const emph = withEmph.nodes.find((node) => node.kind === 'emph');
    expect(emph?.span).toEqual({ start: 67, end: 73, line: 6, column: 9 });
  });

  it('`[beat: name]` не идёт в TTS и не меняет ни одного байта spoken-текста', () => {
    const withBeat = onlyChunk(parse(...SCENE, 'Ever bought. [beat: reveal] They sat here.'));
    const without = onlyChunk(parse(...SCENE, 'Ever bought. They sat here.'));
    expect(Buffer.from(withBeat.spoken, 'utf8').equals(Buffer.from(without.spoken, 'utf8'))).toBe(true);
    expect(withBeat.nodes.find((node) => node.kind === 'beat')?.anchor).toBe('b:reveal');
  });

  it('неизвестный маркер — ошибка, а не пропуск', () => {
    const error = refusal([...SCENE, 'Text [tpl: kenburns] more.'], 6, 6);
    expect(error.rule).toBe('ADR-0002 §1');
    expect(error.message).toContain('НОВОГО ADR');
  });

  it('`[say:]` без разделителя и с двумя `|` — ошибки', () => {
    refusal([...SCENE, 'Text [say: only] more.'], 6, 6);
    refusal([...SCENE, 'Text [say: a | b | c] more.'], 6, 6);
  });

  it('незакрытый маркер — ошибка в позиции `[`', () => {
    refusal([...SCENE, 'Text [beat: reveal more.'], 6, 6);
  });
});

describe('таблица ADR-0002 §2: `[pause: Nms]` — три положения', () => {
  it('между абзацами: узел тишины, разреза нет, чанк один', () => {
    const scene = onlyScene(parse(...SCENE, '[pause: 600ms] The archive kept a list.'));
    expect(scene.blocks.map((block) => block.kind)).toEqual(['silence', 'paragraph']);
    const silence = scene.blocks[0];
    if (silence?.kind !== 'silence') throw new Error('нет узла тишины');
    expect(silence.ms).toBe(600);
    expect(silence.samples).toBe(14400);
    expect(chunksOf(onlyParagraph(parse(...SCENE, '[pause: 600ms] The archive kept a list.')))).toHaveLength(1);
  });

  it('в конце абзаца — тоже граница абзаца', () => {
    const scene = onlyScene(parse(...SCENE, 'The archive kept a list. [pause: 600ms]'));
    expect(scene.blocks.map((block) => block.kind)).toEqual(['paragraph', 'silence']);
  });

  it('внутри абзаца на границе предложения: разрез чанка и тишина', () => {
    const paragraph = onlyParagraph(parse(...SCENE, 'Years running. [pause: 250ms] Ships came in.'));
    expect(paragraph.parts.map((part) => part.kind)).toEqual(['chunk', 'chunk-break', 'chunk']);
    const chunks = chunksOf(paragraph);
    expect(chunks.map((chunk) => chunk.spoken)).toEqual(['Years running.', 'Ships came in.']);
    expect(chunks.map((chunk) => chunk.splitIndex)).toEqual([0, 1]);
    const cut = paragraph.parts[1];
    if (cut?.kind !== 'chunk-break') throw new Error('нет разреза');
    expect(cut.samples).toBe(6000);
  });

  it('внутри абзаца НЕ на границе предложения — ошибка компиляции с местом', () => {
    const error = refusal([...SCENE, 'Ships came [pause: 100ms] in on the night tide.'], 6, 12);
    expect(error.message).toContain('ТОЛЬКО на границе предложения');
    expect(error.rule).toBe('ADR-0002 §2');
  });

  it('две паузы подряд внутри абзаца — ошибка: чанк между ними пуст', () => {
    refusal([...SCENE, 'One. [pause: 100ms] [pause: 200ms] Two.'], 6, 21);
  });

  it('величина паузы обязана иметь единицу `ms`', () => {
    refusal([...SCENE, 'One. [pause: 400] Two.'], 6, 14);
  });

  it('сэмплы считает `msToSamples`, `sampleRate` — параметр без умолчания', () => {
    const scene = onlyScene(parseSource(doc(...SCENE, '[pause: 250ms] Text.'), { file: FILE, sampleRate: 44100 }));
    const silence = scene.blocks[0];
    if (silence?.kind !== 'silence') throw new Error('нет узла тишины');
    expect(silence.samples).toBe(11025);
  });
});

describe('таблица ADR-0002 §2: `[img:]` и заголовки — правила МЕСТА', () => {
  it('`[img: alias]` в начале предложения — законен (начало абзаца и после точки)', () => {
    const chunk = onlyChunk(parse(...SCENE, '[img: harbour] The morning began. [img: sea] Ships came.'));
    expect(chunk.nodes.filter((node) => node.kind === 'img').map((node) => node.alias)).toEqual(['harbour', 'sea']);
    expect(chunk.spoken).toBe('The morning began. Ships came.');
  });

  it('`[img: alias]` не в начале предложения — ошибка', () => {
    const error = refusal([...SCENE, 'The morning [img: harbour] began.'], 6, 13);
    expect(error.message).toContain('начале предложения');
  });

  it('`# chapter:` не в начале строки — ошибка', () => {
    const error = refusal([...SCENE, 'Text before # chapter: main'], 6, 13);
    expect(error.message).toContain('НАЧАЛЕ строки');
  });

  it('уровень заголовка и слово сверяются друг с другом', () => {
    refusal(['## chapter: main'], 2, 1);
    refusal(['# chapter: main', '', '# scene: intro'], 4, 1);
    refusal(['### chapter: main'], 2, 1);
  });

  it('идентификатор заголовка — законный публичный якорь (ADR-0004 §1)', () => {
    refusal(['# chapter: -bad'], 2, 12);
  });
});

describe('вход лексера', () => {
  it('без шапки первая строка исчезла бы молча — поэтому это отказ', () => {
    let caught: unknown;
    try {
      parseSource('# chapter: main\n', { file: FILE, sampleRate: SAMPLE_RATE });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SourceParseError);
    expect((caught as SourceParseError).location).toEqual({ file: FILE, line: 1, column: 1 });
  });
});
