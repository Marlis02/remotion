// Дорожка речи: тотальное разбиение `[0, L)` (`CP-01`; ADR-0003 T5, T6, T7, T8).
//
// ЧТО ЗДЕСЬ ПРОИСХОДИТ. Обход исходника в порядке `SpeechPlan` даёт чередование «речь — тишина
// — речь». Речь — окно `[leadInSamples, numSamples − tailSamples)` внутри СЫРОГО PCM дубля
// (T7 после `DOC-04`: «на импорте ничего не срезается… режет интервал речи тот, кто строит
// дорожку»); тишина — ровно один клип на стык, вида `author` либо `gap`.
//
// ЗДЕСЬ ЖЕ ИСПОЛНЯЕТСЯ ВТОРАЯ ПОЛОВИНА СТРОКИ **T7** РЕЕСТРА: «после импорта дубля ВСЯ
// межчанковая тишина — явные клипы `Silence`». Проверяется она не отдельным правилом, а
// ассертом тотальности: если бы хоть один стык остался неучтённым, клипы перестали бы
// стыковаться, и `assertTotalPartition` покраснел бы.
//
// ПОЧЕМУ ОДИН КЛИП НА СТЫК, А НЕ НЕСКОЛЬКО. Автор вправе написать два `[pause:]` подряд на
// одной границе; ADR молчит о таком случае. Правило принято здесь и названо: авторские паузы
// одной точки СУММИРУЮТСЯ и кладутся ОДНИМ клипом. Довод: «переопределяет, а не складывается»
// (T8) сказано про пару «автор ↔ дефолт движка», а не про две авторские паузы; а один клип на
// стык делает структуру дорожки функцией структуры текста, а не числа маркеров.
//
// ЧЕГО ЗДЕСЬ НЕТ. Сегментов и `boundary-correction` (решение владельца 2026-08-26, вопрос 2):
// δ определён НА СЕГМЕНТ (T6), сегментов до `CP-03` нет, а «ролик как один сегмент» дал бы
// финальную добивку T5, которая принадлежит `CP-05`. Вид в типе есть, экземпляров `CP-01`
// не порождает.

import {
  asSamples,
  type Chapter,
  type Samples,
  type Scene,
  type SourceDocument,
  type TimelineSilence,
} from '@vpe/core-model';
import { splitChunkText, type SpeechPlan, type Take } from '@vpe/voice';

import { CompileError, type CompileProblem } from './errors.js';
import type {
  BoundaryKind,
  CompileProfileInput,
  CutCandidate,
  PlacedSilence,
  PlacedSpeech,
} from './types.js';

/** Вход построения дорожки речи. Ни диска, ни часов: всё приходит значениями. */
export interface SpeechTrackInput {
  readonly document: SourceDocument;
  readonly plan: SpeechPlan;
  /** `chunkKey` → дубль, прочитанный строгим читателем (`parseTakeFile`, `V-05`/`CP-01`). */
  readonly takes: ReadonlyMap<string, Take>;
  readonly profile: CompileProfileInput;
}

/** Область сцены или главы на дорожке: `[startSample, endSample)`. */
export interface Area {
  readonly id: string;
  readonly startSample: Samples;
  readonly endSample: Samples;
}

/** Дорожка речи вместе с тем, что из неё выводится. */
export interface SpeechTrackResult {
  readonly items: readonly (PlacedSpeech | PlacedSilence)[];
  /** `L` — длина дорожки речи. */
  readonly durationSamples: Samples;
  readonly cutCandidates: readonly CutCandidate[];
  /** `chunkKey` → его речевой клип. Вход разрешения якорей `w:`. */
  readonly speechByChunk: ReadonlyMap<string, PlacedSpeech>;
  /** `sc:<id>` → область. */
  readonly sceneAreas: ReadonlyMap<string, Area>;
  /**
   * `sc:<id>` → конец ПОСЛЕДНЕГО речевого клипа сцены (без хвостового gap'а).
   *
   * Не то же самое, что конец области, и разница существенна: маркер, за которым в его сцене
   * нет ни одного произносимого токена, встаёт именно сюда (правило П3, см. `anchors.ts`).
   */
  readonly sceneSpeechEnd: ReadonlyMap<string, Samples>;
  /** `ch:<id>` → область. */
  readonly chapterAreas: ReadonlyMap<string, Area>;
}

// ── Обход исходника ─────────────────────────────────────────────────────────

/** Адрес места в структуре прозы: по нему считается ТИП границы между двумя речами. */
interface Place {
  readonly chapterIndex: number;
  readonly chapterId: string;
  readonly sceneIndex: number;
  readonly sceneId: string;
  readonly paragraphIndex: number;
}

/** Единица обхода: либо речь (часть чанка плана), либо авторская пауза. */
type Unit =
  | { readonly kind: 'speech'; readonly place: Place }
  | { readonly kind: 'pause'; readonly place: Place | null; readonly samples: Samples; readonly ms: number };

/**
 * Разворачивает документ в плоский список единиц В ПОРЯДКЕ ПЛАНА.
 *
 * Обход повторяет обход `speechPlan` (`V-03`) шаг в шаг — глава → сцена → абзац → части
 * абзаца, — потому что число речевых единиц обязано совпасть с числом чанков плана. Совпадение
 * не предполагается, а проверяется ниже: расхождение означает, что план построен другим
 * `maxChunkChars` или другим разбором.
 *
 * `[pause:]` приезжает из двух узлов AST, и оба здесь: `ChunkBreak` — пауза ВНУТРИ абзаца
 * (режет чанк), `Silence` — пауза НА ГРАНИЦЕ абзаца (блок сцены). Разница между ними видна
 * только по месту, где они стоят, и она же даёт тип границы.
 */
function unitsOf(document: SourceDocument, maxChunkChars: number): Unit[] {
  const out: Unit[] = [];
  document.chapters.forEach((chapter: Chapter, chapterIndex: number) => {
    chapter.scenes.forEach((scene: Scene, sceneIndex: number) => {
      let paragraphIndex = 0;
      for (const block of scene.blocks) {
        const place: Place = {
          chapterIndex,
          chapterId: chapter.id,
          sceneIndex,
          sceneId: scene.id,
          paragraphIndex,
        };
        if (block.kind === 'silence') {
          out.push({ kind: 'pause', place, samples: block.samples, ms: block.ms });
          continue;
        }
        for (const part of block.parts) {
          if (part.kind === 'chunk-break') {
            out.push({ kind: 'pause', place, samples: part.samples, ms: part.ms });
            continue;
          }
          for (const _part of splitChunkText(part.spoken, maxChunkChars)) {
            void _part;
            out.push({ kind: 'speech', place });
          }
        }
        paragraphIndex += 1;
      }
    });
  });
  return out;
}

/** Тип границы между двумя соседними речевыми клипами — по структурному расстоянию. */
function boundaryBetween(before: Place, after: Place): BoundaryKind {
  if (before.chapterIndex !== after.chapterIndex) return 'chapter';
  if (before.sceneIndex !== after.sceneIndex) return 'scene';
  if (before.paragraphIndex !== after.paragraphIndex) return 'paragraph';
  return 'intra-paragraph';
}

/** Дефолт движка для этой границы (T8). Внутри абзаца движок не добавляет ничего. */
function defaultGapOf(boundary: BoundaryKind, profile: CompileProfileInput): number {
  switch (boundary) {
    case 'chapter':
      return profile.defaultChapterGapSamples;
    case 'scene':
      return profile.defaultSceneGapSamples;
    case 'paragraph':
      return profile.defaultParagraphGapSamples;
    case 'intra-paragraph':
      return 0;
  }
}

// ── Проверки дублей ─────────────────────────────────────────────────────────

/**
 * Все дубли на месте, все сняты на частоте проекта, ни один не «весь тихий».
 *
 * ТРИ ПРОВЕРКИ ПОДРЯД, И КАЖДАЯ СО СПИСКОМ. Отсутствующие дубли приходят пачкой (не
 * сгенерирована целая глава), и падение на первом заставляло бы чинить их по одному.
 */
function assertTakes(input: SpeechTrackInput): ReadonlyMap<string, Take> {
  const missing: CompileProblem[] = [];
  const takes = new Map<string, Take>();
  for (const chunk of input.plan.chunks) {
    const take = input.takes.get(chunk.chunkKey);
    if (take === undefined) {
      missing.push({
        address: chunk.chunkKey,
        message:
          `дубля нет (сцена \`sc:${chunk.address.sceneId}\`, абзац ` +
          `${String(chunk.address.paragraphOrdinalInScene)}, часть ${String(chunk.address.splitIndex)})`,
      });
      continue;
    }
    takes.set(chunk.chunkKey, take);
  }
  if (missing.length > 0) {
    throw new CompileError(
      'ADR-0010 §2',
      'дорожка речи не строится: плану не хватает дублей. Компилятор не выдумывает время — ' +
        'пропустить чанк значило бы молча сократить ролик; запусти стадию `voice`',
      missing,
    );
  }

  const rate: CompileProblem[] = [];
  for (const [chunkKey, take] of takes) {
    if (take.pcm.sampleRate !== input.profile.projectSampleRate) {
      rate.push({
        address: chunkKey,
        message:
          `дубль снят на ${String(take.pcm.sampleRate)} Гц, а \`projectSampleRate\` проекта — ` +
          `${String(input.profile.projectSampleRate)}. Сэмплы двух частот на одной дорожке — ` +
          'это тихий сдвиг всей речи, а ресемплинг дубля запрещён: байты в CAS сырые',
      });
    }
  }
  if (rate.length > 0) {
    throw new CompileError('ADR-0003 T1', 'дубли сняты не на частоте проекта', rate);
  }

  const silent: CompileProblem[] = [];
  for (const [chunkKey, take] of takes) {
    const edges = take.leadInSamples + take.tailSamples;
    if (edges < take.pcm.numSamples) continue;
    silent.push({
      address: chunkKey,
      message:
        edges === take.pcm.numSamples
          ? `дубль весь тихий: leadInSamples ${String(take.leadInSamples)} + tailSamples ` +
            `${String(take.tailSamples)} == numSamples ${String(take.pcm.numSamples)}, то есть ` +
            'интервал речи пуст. Приёмка `V-02` пропустила его ЗАКОННО — она судит `alignment`, ' +
            'а не звук, и молчащий дубль с исправными таймкодами для неё здоров (долг №99). ' +
            'Чинить нужно стадию `voice`: молчащий чанк — это отказ синтеза, а не текст'
          : `измерения краёв не сходятся: leadInSamples ${String(take.leadInSamples)} + ` +
            `tailSamples ${String(take.tailSamples)} больше numSamples ` +
            `${String(take.pcm.numSamples)} — интервал речи вывернут (ADR-0003 T4)`,
    });
  }
  if (silent.length > 0) {
    throw new CompileError(
      'ADR-0003 T7',
      'интервал речи `[leadInSamples, numSamples − tailSamples)` пуст или вывернут',
      silent,
    );
  }
  return takes;
}

// ── Сборка дорожки ──────────────────────────────────────────────────────────

/** Клип тишины — `TimelineSilence` из `core-model` как есть, плюс физический адрес. */
function silenceClip(
  silenceKind: TimelineSilence['silenceKind'],
  lengthSamples: Samples,
  startSample: Samples,
  boundary: BoundaryKind,
  chapterId: string,
  sceneId: string | null,
): PlacedSilence {
  return {
    kind: 'silence',
    clipId: `silence:${String(startSample)}`,
    silence: { silenceKind, duration: { samples: lengthSamples } },
    startSample,
    endSample: asSamples(startSample + lengthSamples),
    boundary,
    chapterId,
    sceneId,
  };
}

/**
 * Авторская пауза нулевой длины на границе сцены или главы — ОШИБКА (решение владельца
 * 2026-08-26, поправка П1).
 *
 * Довод сильнее, чем «нарушен T8». На границе **главы** это **V4**: граница главы обязана быть
 * границей сегмента, а разрез по T6 требует тишины НЕНУЛЕВОЙ длины — то есть нулевая авторская
 * пауза делает V4 невыполнимым, и не отчётом, а по построению. На границе сцены нарушается
 * **T8** («каждая граница сцены — кандидат на разрез»), причём валидация профиля этот путь не
 * закрывает вовсе: `defaultSceneGapSamples > 0` проверяет ПРОФИЛЬ, а обнуляет тишину ПРОЗА.
 */
function assertNonZeroStructuralPause(
  boundary: BoundaryKind,
  pauses: readonly { readonly ms: number; readonly samples: Samples }[],
  after: Place,
  problems: { readonly chapter: CompileProblem[]; readonly scene: CompileProblem[] },
): void {
  if (pauses.length === 0) return;
  if (boundary !== 'scene' && boundary !== 'chapter') return;
  const total = pauses.reduce((sum, pause) => sum + pause.samples, 0);
  if (total > 0) return;
  const where = boundary === 'chapter' ? `ch:${after.chapterId}` : `sc:${after.sceneId}`;
  const problem: CompileProblem = {
    address: where,
    message:
      `авторская пауза ${pauses.map((pause) => `[pause: ${String(pause.ms)}ms]`).join(' + ')} ` +
      'переопределяет дефолт движка в своей точке (**T8**) и обнуляет тишину на границе ' +
      `${boundary === 'chapter' ? 'главы' : 'сцены'}. Разрез по **T6** требует тишины ` +
      'НЕНУЛЕВОЙ длины, поэтому точка перестаёт быть кандидатом' +
      (boundary === 'chapter'
        ? ', и **V4** («граница главы обязана быть границей сегмента») становится невыполнимым ' +
          'по построению, а не по отчёту'
        : ', и **T8** («каждая граница сцены — кандидат на разрез») перестаёт держаться. ' +
          'Валидация профиля этот путь не закрывает: `defaultSceneGapSamples > 0` проверяет ' +
          'профиль, а обнуляет тишину проза'),
  };
  if (boundary === 'chapter') problems.chapter.push(problem);
  else problems.scene.push(problem);
}

/**
 * Строит дорожку речи и всё, что из неё выводится.
 *
 * @throws {CompileError} нет дубля / не та частота / весь-тихий дубль / нулевая авторская
 *   пауза на структурной границе / разбиение не тотально.
 */
export function speechTrack(input: SpeechTrackInput): SpeechTrackResult {
  const takes = assertTakes(input);
  // Раскрой — ТОЙ ЖЕ функцией и ТЕМ ЖЕ пределом, каким построен план (`SpeechPlan.maxChunkChars`,
  // `M-05` долг №105): второй раскрой в репозитории завёл бы второй адрес чанков. Прецедент —
  // `tokensOfPlan` (`bind/tokens.ts`, `V-05`), которая делит текст ровно так же.
  const units = unitsOf(input.document, input.plan.maxChunkChars);
  const speechUnits = units.filter((unit) => unit.kind === 'speech');
  if (speechUnits.length !== input.plan.chunks.length) {
    throw new CompileError('ADR-0010 §2', 'обход исходника и план речи описывают разное', [
      {
        address: input.plan.file,
        message:
          `обход дал ${String(speechUnits.length)} речевых единиц, а план содержит ` +
          `${String(input.plan.chunks.length)} чанк(ов). План строится тем же обходом ` +
          '(`speechPlan`, `V-03`), поэтому расхождение означает разные входы: другой ' +
          '`maxChunkChars` либо другой разбор исходника',
      },
    ]);
  }

  const items: (PlacedSpeech | PlacedSilence)[] = [];
  const speechByChunk = new Map<string, PlacedSpeech>();
  const candidates: CutCandidate[] = [];
  const zeroPause = { chapter: [] as CompileProblem[], scene: [] as CompileProblem[] };

  /** Первый речевой клип каждой сцены и каждой главы — начало их областей. */
  const sceneFirst = new Map<string, Samples>();
  const chapterFirst = new Map<string, Samples>();
  /** Порядок появления областей: он же порядок их концов. */
  const sceneOrder: string[] = [];
  const chapterOrder: string[] = [];
  /** Конец последней речи каждой сцены — переписывается на каждом её речевом клипе. */
  const sceneSpeechEnd = new Map<string, Samples>();

  let cursor = 0;
  let planIndex = 0;
  let previous: Place | null = null;
  let pending: { ms: number; samples: Samples }[] = [];

  const flushPending = (boundary: BoundaryKind, place: Place, sceneId: string | null): void => {
    const authored = pending.reduce((sum, pause) => sum + pause.samples, 0);
    const length = pending.length > 0 ? authored : defaultGapOf(boundary, input.profile);
    const silenceKind: TimelineSilence['silenceKind'] = pending.length > 0 ? 'author' : 'gap';
    pending = [];
    if (length <= 0) return;
    const start = asSamples(cursor);
    const clip = silenceClip(silenceKind, asSamples(length), start, boundary, place.chapterId, sceneId);
    items.push(clip);
    cursor += length;
    // Кандидат на разрез — ТОЛЬКО тишина МЕЖДУ двумя речевыми клипами (T6). Ведущая и
    // хвостовая тишина кандидатами не бывают: разрез в них дал бы сегмент без единого кадра
    // речи, то есть пустую единицу рендера.
    candidates.push({
      atSample: start,
      durationSamples: asSamples(length),
      silenceKind,
      boundary,
      chapterId: place.chapterId,
      sceneId,
    });
  };

  for (const unit of units) {
    if (unit.kind === 'pause') {
      pending.push({ ms: unit.ms, samples: unit.samples });
      continue;
    }
    const place = unit.place;

    if (previous === null) {
      // Ведущая авторская пауза: клип есть, кандидатом не является (см. `flushPending`).
      const leading = pending.reduce((sum, pause) => sum + pause.samples, 0);
      pending = [];
      if (leading > 0) {
        items.push(
          silenceClip('author', asSamples(leading), asSamples(cursor), 'paragraph', place.chapterId, place.sceneId),
        );
        cursor += leading;
      }
    } else {
      const boundary = boundaryBetween(previous, place);
      assertNonZeroStructuralPause(boundary, pending, place, zeroPause);
      // Тишина стыка принадлежит стыку: у границы глав своей сцены у неё нет.
      flushPending(boundary, place, boundary === 'chapter' ? null : place.sceneId);
    }

    const chunk = input.plan.chunks[planIndex];
    if (chunk === undefined) throw new Error('недостижимо: длины сверены выше');
    const take = takes.get(chunk.chunkKey);
    if (take === undefined) throw new Error('недостижимо: наличие дублей проверено выше');
    const pcmStart = take.leadInSamples;
    const pcmEnd = asSamples(take.pcm.numSamples - take.tailSamples);
    const length = pcmEnd - pcmStart;
    const speech: PlacedSpeech = {
      kind: 'speech',
      clipId: `speech:${chunk.chunkKey}`,
      startSample: asSamples(cursor),
      endSample: asSamples(cursor + length),
      chunkKey: chunk.chunkKey,
      pcmSha256: take.pcm.sha256,
      pcmStartSample: pcmStart,
      pcmEndSample: pcmEnd,
    };
    items.push(speech);
    speechByChunk.set(chunk.chunkKey, speech);
    if (!sceneFirst.has(place.sceneId)) {
      sceneFirst.set(place.sceneId, speech.startSample);
      sceneOrder.push(place.sceneId);
    }
    sceneSpeechEnd.set(`sc:${place.sceneId}`, speech.endSample);
    if (!chapterFirst.has(place.chapterId)) {
      chapterFirst.set(place.chapterId, speech.startSample);
      chapterOrder.push(place.chapterId);
    }
    cursor += length;
    planIndex += 1;
    previous = place;
  }

  if (zeroPause.chapter.length > 0) {
    throw new CompileError('Charter V4', 'нулевая авторская пауза на границе главы', zeroPause.chapter);
  }
  if (zeroPause.scene.length > 0) {
    throw new CompileError('ADR-0003 T8', 'нулевая авторская пауза на границе сцены', zeroPause.scene);
  }
  if (previous === null) {
    throw new CompileError('ADR-0003 T5', 'в исходнике нет ни одного речевого чанка', [
      { address: input.document.file, message: 'дорожка речи пуста, а Timeline без речи не строится' },
    ]);
  }

  // Хвостовая авторская пауза: клип есть, кандидатом не является.
  const trailing = pending.reduce((sum, pause) => sum + pause.samples, 0);
  if (trailing > 0) {
    items.push(
      silenceClip('author', asSamples(trailing), asSamples(cursor), 'paragraph', previous.chapterId, previous.sceneId),
    );
    cursor += trailing;
  }

  const durationSamples = asSamples(cursor);
  assertTotalPartition(items, durationSamples);
  assertSpeechSum(items, input.plan, takes);

  return {
    items,
    durationSamples,
    cutCandidates: candidates,
    speechByChunk,
    sceneAreas: areasOf(sceneOrder, sceneFirst, durationSamples, 'sc'),
    sceneSpeechEnd,
    chapterAreas: areasOf(chapterOrder, chapterFirst, durationSamples, 'ch'),
  };
}

/**
 * Области сцен и глав — решение владельца 2026-08-26, вопрос 6.
 *
 * Область = `[начало первого речевого клипа, конец своего хвостового gap'а)`, а конец
 * хвостового gap'а есть НАЧАЛО первой речи следующей области; у последней области конец = `L`.
 * Довод: T6 говорит «gap принадлежит ПРЕДШЕСТВУЮЩЕМУ сегменту», то есть разрез стоит ЗА gap'ом.
 * Следствие, ради которого правило и выбрано: области дают тотальное разбиение `[0, L)` — визуал
 * сцены идёт сквозь паузу перед следующей, а визуал новой начинается ровно с её первого слова.
 *
 * У ПЕРВОЙ области начало принудительно `0`: ведущая авторская пауза иначе осталась бы ничьей.
 */
function areasOf(
  order: readonly string[],
  first: ReadonlyMap<string, Samples>,
  durationSamples: Samples,
  space: 'sc' | 'ch',
): ReadonlyMap<string, Area> {
  const out = new Map<string, Area>();
  order.forEach((id, index) => {
    const start = index === 0 ? asSamples(0) : (first.get(id) ?? asSamples(0));
    const nextId = order[index + 1];
    const end = nextId === undefined ? durationSamples : (first.get(nextId) ?? durationSamples);
    out.set(`${space}:${id}`, { id, startSample: start, endSample: end });
  });
  return out;
}

// ── Ассерты T5 ──────────────────────────────────────────────────────────────

/**
 * **T5, форма первая:** клипы тилят `[0, L)` без дыр и перекрытий, `Σ длительностей == L`.
 *
 * Это же — исполнимая форма второй половины строки **T7** реестра: «вся межчанковая тишина —
 * явные клипы `Silence`». Неучтённая тишина здесь невыразима: она была бы дырой между клипами.
 */
export function assertTotalPartition(
  items: readonly (PlacedSpeech | PlacedSilence)[],
  durationSamples: Samples,
): void {
  const problems: CompileProblem[] = [];
  let expected = 0;
  let sum = 0;
  for (const item of items) {
    if (item.startSample !== expected) {
      problems.push({
        address: item.clipId,
        message:
          `клип начинается на сэмпле ${String(item.startSample)}, а предыдущий кончился на ` +
          `${String(expected)}: ${item.startSample > expected ? 'дыра' : 'перекрытие'} в ` +
          `${String(Math.abs(item.startSample - expected))} сэмпл(ов)`,
      });
    }
    if (item.endSample <= item.startSample) {
      problems.push({
        address: item.clipId,
        message:
          `интервал [${String(item.startSample)}, ${String(item.endSample)}) пуст или вывернут ` +
          '(ADR-0003 T4: интервалы полуоткрыты, начало строго меньше конца)',
      });
    }
    sum += item.endSample - item.startSample;
    expected = item.endSample;
  }
  if (expected !== durationSamples) {
    problems.push({
      address: 'дорожка `speech`',
      message: `последний клип кончается на ${String(expected)}, а L = ${String(durationSamples)}`,
    });
  }
  if (sum !== durationSamples) {
    problems.push({
      address: 'дорожка `speech`',
      message: `Σ длительностей клипов = ${String(sum)}, а L = ${String(durationSamples)}`,
    });
  }
  if (problems.length > 0) {
    throw new CompileError(
      'ADR-0003 T5',
      'разбиение дорожки речи не тотально: аудио-дорожка непрерывна и никогда не режется, ' +
        'значит каждый её сэмпл принадлежит ровно одному клипу',
      problems,
    );
  }
}

/**
 * **T5, форма вторая:** `Σ длительностей РЕЧЕВЫХ клипов == Σ (numSamples − leadIn − tail)`.
 *
 * Первая форма тотальности этого не ловит: она сойдётся и на дорожке, где речь укорочена, а
 * тишина на столько же удлинена. Именно вторая форма и есть критерий roadmap
 * «`Σ длительностей speech == numSamples`» — с поправкой T7 на измеренные края.
 */
export function assertSpeechSum(
  items: readonly (PlacedSpeech | PlacedSilence)[],
  plan: SpeechPlan,
  takes: ReadonlyMap<string, Take>,
): void {
  const laid = items
    .filter((item): item is PlacedSpeech => item.kind === 'speech')
    .reduce((sum, item) => sum + (item.endSample - item.startSample), 0);
  const measured = plan.chunks.reduce((sum, chunk) => {
    const take = takes.get(chunk.chunkKey);
    if (take === undefined) return sum;
    return sum + (take.pcm.numSamples - take.leadInSamples - take.tailSamples);
  }, 0);
  if (laid === measured) return;
  throw new CompileError('ADR-0003 T5', 'уложенная речь не равна измеренной', [
    {
      address: plan.file,
      message:
        `Σ длительностей речевых клипов = ${String(laid)}, а Σ (numSamples − leadInSamples − ` +
        `tailSamples) по дублям = ${String(measured)}. Разница ${String(laid - measured)} ` +
        'сэмпл(ов) означает, что дорожка несёт не то, что измерено на импорте дубля',
    },
  ]);
}

// ГДЕ ЗДЕСЬ `msToSamples`. Его нет, и это не обход правила T1, а его исполнение: `[pause: Nms]`
// переведён в сэмплы ОДИН раз, лексером (`core-model/src/source/parse.ts`, `pauseSamples` →
// `msToSamples`), и узлы AST `Silence`/`ChunkBreak` несут уже готовое поле `samples`. Второй
// перевод здесь был бы второй точкой конверсии — ровно то, что T1 запрещает.
