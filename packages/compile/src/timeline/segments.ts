// Сегментация (`CP-03`, roadmap §4.7; норма — ADR-0008 «Сегментация (механика V4)»).
//
// ЧТО ЗДЕСЬ ПРОИСХОДИТ. Дорожка речи `[0, L)` делится на СЕГМЕНТЫ — максимальные пробеги
// подряд идущих сцен, между которыми ничто не пересекает границу. Кандидат на разрез — только
// граница СЦЕНЫ (или главы); кандидат становится разрезом ⟺ (а) ничто не пересекает,
// (б) там есть клип тишины ненулевой длины, (в) обе части не короче
// `minSegmentDurationFrames`. Границы сегментов ⊇ границы глав (**V4**).
//
// ГДЕ СТОИТ РАЗРЕЗ. НЕ в начале клипа тишины, а в его КОНЦЕ: по ADR-0003 T6 gap принадлежит
// ПРЕДШЕСТВУЮЩЕМУ сегменту («он его хвост»). Поэтому `cut = candidate.atSample +
// candidate.durationSamples`, и это же число независимо считает `areasOf` (`speech-track.ts`)
// как стык областей сцен — совпадение проверяется, а не предполагается. Комментарий `CP-01`
// у `CutCandidate.atSample` говорил обратное и исправлен (наблюдение О1, решение владельца).
//
// ВЛАДЕЛЬЦА GAP'А НЕ ВЫВОДИТЬ ИЗ `sceneId`. У сценного кандидата `sceneId` — СЛЕДУЮЩЕЙ сцены
// (тишина принадлежит стыку), а по T6 сам gap принадлежит предыдущему сегменту. Читается
// поэтому `boundary`, и только он.
//
// КОМПИЛЯТОР НЕ ВЫДУМЫВАЕТ ВРЕМЯ И НЕ РЕШАЕТ ЗА АВТОРА. Клип, пересекающий границу ГЛАВЫ, —
// ошибка компиляции **R6** со списком, а не WARN и не «разрежу клип сам»: V4 объявлен «в
// исходной силе» (ADR-0008), а резать чужой клип значило бы менять произведение.
//
// НИ ОДНОЙ НОВОЙ ТОЧКИ КОНВЕРСИИ ВРЕМЕНИ. Порог задан в КАДРАХ и сравнивается с длинами в
// сэмплах через `frameStartSample(timeGrid(sampleRate, fps), asFrames(n))` — ДЛИНУ `n` кадров
// от нуля, той же одной функцией `core-model`, какой `CP-02` мерил минимум группы субтитров.
// Кадров в Timeline от этого не появляется: позиции не квантуются, T3 не задет (решение
// `CP-01`, вопрос 1 (в)). `d_i`, `A_i`, `δ_i` (T6) — это `CP-04`.
//
// АУДИО НЕ СЕГМЕНТИРУЕТСЯ НИКОГДА. Отсюда состав `CROSSING_TRACKS`: `music`/`sfx` границу
// сегмента не пересекают ПО ОПРЕДЕЛЕНИЮ — звук одна сплошная PCM на весь ролик, шва в
// аудио-домене не возникает вовсе (ADR-0008: «V4 — инвариант ВИДЕО-домена; сплошная музыка его
// не нарушает, потому что аудио не режется»).

import {
  asSamples,
  asFrames,
  frameStartSample,
  timeGrid,
  type Samples,
  type TrackKind,
} from '@vpe/core-model';

import { atLabel } from './anchors.js';
import { CompileError, type CompileProblem } from './errors.js';
import type { Area, SpeechTrackResult } from './speech-track.js';
import type {
  CaptionGroup,
  CompileProfileInput,
  CrossingClip,
  CutCandidate,
  CutReason,
  CutRow,
  CutTable,
  PlacedClip,
  PlacedSilence,
  RejectReason,
  Segment,
} from './types.js';

/**
 * `chapterParallelism = 1` — КОНСТАНТА, а не настройка (roadmap §4.7 `CP-03` дословно; поле
 * при этом остаётся в схеме `executionProfile`).
 *
 * Основание — ADR-0008, таблица «Бюджет AC2»: строка «`chapterParallelism = 1` | OOM-инвариант
 * | последовательный рендер сегментов | остаётся; альтернатива упирается в RAM». Машина одна,
 * механика параллельного рендера сегментов в v1 не строится.
 *
 * ПОТРЕБИТЕЛЯ У КОНСТАНТЫ СЕГОДНЯ НЕТ, и это названо ценой решения владельца (вопрос 4):
 * рендерер приезжает с `H-*`. Прецедент того же класса — `TAKES_DIR` до `L-01`.
 */
export const CHAPTER_PARALLELISM = 1 as const;

/**
 * Дорожки, клип которых МОЖЕТ пересечь разрез (решение владельца 2026-08-26, вопрос 3).
 *
 * Список закрыт и проверяется на ТОТАЛЬНОСТЬ тестом: каждое имя `TRACK_KINDS` обязано лежать
 * либо здесь, либо в `NON_CROSSING_TRACKS` — иначе восьмая дорожка появилась бы молча и не
 * охранялась бы ничем.
 */
export const CROSSING_TRACKS: readonly TrackKind[] = ['caption', 'visual', 'effect'];

/**
 * Дорожки, которые разрез пересечь не могут, и причина у каждой СВОЯ.
 *
 * `speech` — тотальное разбиение `[0, L)`, а разрез стоит в конце клипа ТИШИНЫ: речь через него
 * не идёт по построению. `music`/`sfx` — аудио не сегментируется никогда (ADR-0008). `voice` —
 * директивная дорожка, клипов на ней не бывает вовсе (ADR-0001, RM2 решение владельца 1).
 * Первые две причины проверяются ассертами ниже, третья — типом.
 */
export const NON_CROSSING_TRACKS: readonly TrackKind[] = ['speech', 'music', 'sfx', 'voice'];

/** Вход сегментации. Ни диска, ни часов, ни случайности: всё приходит значениями. */
export interface SegmentsInput {
  /** Дорожка речи: её клипы, области сцен и глав, кандидаты на разрез. */
  readonly track: SpeechTrackResult;
  /** Клипы режиссуры по дорожкам (`recordTracks`) — по ним считается «пересекает». */
  readonly byTrack: ReadonlyMap<string, readonly PlacedClip[]>;
  /** Группы субтитров (`CP-02`) — только ради ассерта «границу сегмента не пересекают». */
  readonly captionGroups: readonly CaptionGroup[];
  readonly profile: CompileProfileInput;
}

/** Выход стадии: тотальное разбиение и таблица, объясняющая КАЖДОГО кандидата. */
export interface SegmentsResult {
  readonly segments: readonly Segment[];
  readonly table: CutTable;
}

/** Решение по одному сценному или главному кандидату — до сборки строки таблицы. */
interface Verdict {
  readonly decision: 'cut' | 'rejected';
  readonly reason: CutReason | null;
  readonly crossedBy: readonly CrossingClip[];
  readonly leftSamples: Samples;
  readonly rightSamples: Samples;
}

// ── Пересечение ─────────────────────────────────────────────────────────────

/**
 * Клипы, идущие СКВОЗЬ точку разреза: `start < cut < end`.
 *
 * НЕРАВЕНСТВА СТРОГИЕ С ОБЕИХ СТОРОН, и это прямое следствие T4 (интервалы полуоткрыты):
 * клип, который КОНЧАЕТСЯ ровно на разрезе, последним своим сэмплом лежит слева от него, а
 * клип, который НАЧИНАЕТСЯ на разрезе, целиком справа. На `fixtures/minimal` это не теория:
 * вокруг 551760 так стоят сразу три клипа — `img:b:img-harbour-1` `[0, 551760)`, `r:7b20de44`
 * `[269880, 551760)` и `img:b:img-ledger-1` `[551760, 1060080)`, — и нестрогое сравнение
 * запретило бы единственный законный разрез фикстуры.
 */
function crossingClips(cut: Samples, byTrack: SegmentsInput['byTrack']): CrossingClip[] {
  const out: CrossingClip[] = [];
  // Обход в порядке `CROSSING_TRACKS`, а не по ключам Map: порядок строк отчёта обязан быть
  // функцией контракта, а не порядка вставки в `recordTracks`.
  for (const kind of CROSSING_TRACKS) {
    for (const clip of byTrack.get(kind) ?? []) {
      if (clip.startSample < cut && cut < clip.endSample) {
        out.push({
          clipId: clip.clipId,
          track: kind,
          at: atLabel(clip.at),
          startSample: clip.startSample,
          endSample: clip.endSample,
        });
      }
    }
  }
  return out;
}

// ── Ассерты, которые задание требует ассертами, а не ветками ────────────────

/**
 * **Речь разрез не пересекает** — по построению, и потому это ассерт, а не проверка.
 *
 * Разрез стоит в конце клипа ТИШИНЫ, а разбиение дорожки тотально (`CP-01`, T5): значит между
 * речевым клипом и разрезом всегда лежит хотя бы один клип тишины. Если бы ассерт покраснел,
 * сломанным был бы `speechTrack`, а не сегментация.
 */
function assertSpeechNotCrossed(cuts: readonly Samples[], track: SpeechTrackResult): void {
  const problems: CompileProblem[] = [];
  for (const item of track.items) {
    if (item.kind !== 'speech') continue;
    for (const cut of cuts) {
      if (item.startSample < cut && cut < item.endSample) {
        problems.push({
          address: item.clipId,
          message:
            `речевой клип [${String(item.startSample)}, ${String(item.endSample)}) идёт сквозь ` +
            `разрез на сэмпле ${String(cut)}. Разрез стоит в конце клипа ТИШИНЫ, а разбиение ` +
            'дорожки тотально (T5) — значит сломана дорожка речи, а не сегментация',
        });
      }
    }
  }
  if (problems.length > 0) {
    throw new CompileError('ADR-0003 T5', 'разрез пересекает речь', problems);
  }
}

/**
 * **Группа субтитров разрез не пересекает** — тоже по построению (`CP-02`).
 *
 * Группа лежит целиком внутри одного речевого клипа («Речевой клип, внутри которого группа
 * лежит целиком. Границу клипа она не пересекает» — `CaptionGroup.chunkKey`), а речь разрез не
 * пересекает по ассерту выше. Проверка стоит отдельно, потому что цепочка из двух правил —
 * это два места, где можно ошибиться.
 */
function assertCaptionsNotCrossed(cuts: readonly Samples[], groups: readonly CaptionGroup[]): void {
  const problems: CompileProblem[] = [];
  for (const group of groups) {
    for (const cut of cuts) {
      if (group.startSample < cut && cut < group.endSample) {
        problems.push({
          address: `"${group.text}"`,
          message:
            `группа [${String(group.startSample)}, ${String(group.endSample)}) идёт сквозь ` +
            `разрез на сэмпле ${String(cut)}, хотя лежит внутри речевого клипа ` +
            `\`${group.chunkKey}\`, который разрез не пересекает`,
        });
      }
    }
  }
  if (problems.length > 0) {
    throw new CompileError('ADR-0003 «Субтитры (M6)»', 'разрез пересекает группу субтитров', problems);
  }
}

/**
 * **Клипов поправки на дорожке нет** — `CP-01`/`CP-03` их не порождают (решение владельца
 * 2026-08-26, вопрос 2 `CP-01`).
 *
 * Без этого ассерта `L_i` считался бы молча неверно: `δ` по определению (ADR-0001, T6) не
 * входит НИ В ОДИН `L`, и появление клипа `boundary-correction` до `CP-04` означало бы, что
 * сумма номинальных длин перестала быть суммой номинальных длин.
 */
function assertNoCorrection(track: SpeechTrackResult): void {
  const problems: CompileProblem[] = [];
  for (const item of track.items) {
    if (item.kind !== 'silence') continue;
    if (item.silence.silenceKind !== 'boundary-correction') continue;
    problems.push({
      address: item.clipId,
      message:
        'клип `boundary-correction` на дорожке речи: поправка `δ` определена НА СЕГМЕНТ (T6) и ' +
        'материализуется в `CP-04`. `L_i` — сумма НОМИНАЛЬНЫХ длин, и поправка в неё не входит',
    });
  }
  if (problems.length > 0) {
    throw new CompileError('ADR-0003 T6', 'на дорожке речи есть клип поправки', problems);
  }
}

// ── Сборка сегмента ─────────────────────────────────────────────────────────

/**
 * `L_i` — сумма номинальных длин клипов дорожки внутри `[start, end)`.
 *
 * СУММИРОВАНИЕМ, А НЕ ВЫЧИТАНИЕМ: см. шапку поля `Segment.nominalSamples`.
 */
function nominalOf(track: SpeechTrackResult, start: Samples, end: Samples): Samples {
  let sum = 0;
  for (const item of track.items) {
    if (item.startSample < start || item.endSample > end) continue;
    sum += item.endSample - item.startSample;
  }
  return asSamples(sum);
}

/**
 * Глава, которой сегмент принадлежит целиком, — она же **исполнимая форма «границы сегментов
 * ⊇ границы глав»** (V4).
 *
 * Условие проверяется не «сегмент начинается там же, где глава», а сильнее: сегмент обязан
 * лежать ВНУТРИ ровно одной области главы. Разрез, потерянный на границе глав, красит именно
 * здесь — сегмент оказался бы в двух областях сразу.
 */
function chapterOf(
  segmentId: string,
  start: Samples,
  end: Samples,
  chapterAreas: ReadonlyMap<string, Area>,
): string {
  const inside = [...chapterAreas.values()].filter(
    (area) => area.startSample <= start && end <= area.endSample,
  );
  const only = inside[0];
  if (inside.length !== 1 || only === undefined) {
    throw new CompileError('Charter V4', 'сегмент не лежит внутри одной главы', [
      {
        address: segmentId,
        message:
          `сегмент [${String(start)}, ${String(end)}) лежит внутри ${String(inside.length)} ` +
          'глав(ы), а обязан внутри ровно одной: `границы сегментов ⊇ границы глав` (**V4**). ' +
          'Значит потерян разрез на границе глав',
      },
    ]);
  }
  return only.id;
}

/** Глава, кончающаяся на этом стыке, — для текста ошибки R6: она называет ОБЕ главы. */
function previousChapterOf(track: SpeechTrackResult, cut: number): string {
  for (const area of track.chapterAreas.values()) {
    if (area.endSample === cut) return area.id;
  }
  return '<неизвестна>';
}

// ── Стадия ──────────────────────────────────────────────────────────────────

/**
 * Строит сегменты и таблицу кандидатов.
 *
 * @throws {CompileError} **R6** — клип пересекает границу главы; плюс ассерты тотальности.
 */
export function segments(input: SegmentsInput): SegmentsResult {
  const { track, profile } = input;
  assertNoCorrection(track);

  // ДЛИНА, А НЕ ПОЗИЦИЯ (тот же приём, что у порога группы субтитров, `CP-02` вопрос 7):
  // `frameStartSample(grid, n)` — первый сэмпл кадра `n`, то есть длина `n` кадров ОТ НУЛЯ.
  // `asFrames` — конструктор бренда, а не каст: «бренд, снимаемый кастом, — не бренд».
  const grid = timeGrid(profile.projectSampleRate, profile.fps);
  const minSegmentSamples = frameStartSample(grid, asFrames(profile.minSegmentDurationFrames));

  const sceneList = [...track.sceneAreas.values()];
  // Кандидат ищется по КОНЦУ своего клипа тишины: разрез стоит там (T6).
  const structural = new Map<number, CutCandidate>();
  for (const candidate of track.cutCandidates) {
    if (candidate.boundary !== 'scene' && candidate.boundary !== 'chapter') continue;
    structural.set(candidate.atSample + candidate.durationSamples, candidate);
  }
  const silenceAt = new Map<number, PlacedSilence>();
  for (const item of track.items) {
    if (item.kind === 'silence') silenceAt.set(item.startSample, item);
  }

  // Границы глав — разрезы по построению (**V4**). Они же — правая опора проверки (в)
  // (поправка владельца П1): правая часть меряется ДО ближайшей из них, а не до конца ролика.
  const chapterCuts: number[] = [];
  [...track.chapterAreas.values()].forEach((area, index) => {
    if (index > 0) chapterCuts.push(area.startSample);
  });
  const rightBoundOf = (cut: number): number =>
    chapterCuts.find((point) => point > cut) ?? track.durationSamples;

  const verdicts = new Map<number, Verdict>();
  const crossedChapters: CompileProblem[] = [];
  const out: Segment[] = [];
  const acceptedCuts: Samples[] = [];

  let segmentStart = asSamples(0);
  let runScenes: string[] = [];

  const close = (end: Samples, tailGap: PlacedSilence | null): void => {
    const first = runScenes[0];
    if (first === undefined) throw new Error('недостижимо: пробег сцен пуст');
    const segmentId = `seg:${first}`;
    out.push({
      segmentId,
      startSample: segmentStart,
      endSample: end,
      chapterId: chapterOf(segmentId, segmentStart, end, track.chapterAreas),
      sceneIds: runScenes,
      nominalSamples: nominalOf(track, segmentStart, end),
      tailGap,
    });
    segmentStart = end;
    runScenes = [];
  };

  sceneList.forEach((scene, index) => {
    runScenes.push(scene.id);
    if (index === sceneList.length - 1) return;
    const cut = scene.endSample;
    const candidate = structural.get(cut);
    // ПРОВЕРКА (б) — АССЕРТОМ, А НЕ ВЕТКОЙ. После `CP-01` тишина нулевой длины на структурной
    // границе невозможна: `assertNonZeroStructuralPause` роняет компиляцию раньше, а
    // `defaultSceneGapSamples > 0` — инвариант корректности профиля (T8).
    if (candidate === undefined) {
      throw new CompileError('ADR-0003 T6', 'на границе сцен нет кандидата на разрез', [
        {
          address: `sc:${scene.id}`,
          message:
            `стык сцен на сэмпле ${String(cut)} не несёт клипа тишины ненулевой длины. Разрез ` +
            'по **T6** требует такого клипа, а `CP-01` обязан был упасть раньше: нулевая ' +
            'авторская пауза на границе сцены — ошибка `ADR-0003 T8`',
        },
      ]);
    }

    const crossedBy = crossingClips(asSamples(cut), input.byTrack);
    const leftSamples = asSamples(cut - segmentStart);
    const rightSamples = asSamples(rightBoundOf(cut) - cut);

    let verdict: Verdict;
    if (candidate.boundary === 'chapter') {
      // **V4 в исходной силе**: граница главы режет БЕЗУСЛОВНО. Пересечение здесь — не отказ от
      // разреза, а ошибка компиляции R6; проверка (в) не применяется (вопрос 2, вариант (а)).
      for (const clip of crossedBy) {
        crossedChapters.push({
          address: clip.clipId,
          message:
            `клип дорожки \`${clip.track}\` (\`at\` = \`${clip.at}\`) занимает ` +
            `[${String(clip.startSample)}, ${String(clip.endSample)}) и идёт СКВОЗЬ границу ` +
            `глав \`ch:${previousChapterOf(track, cut)}\` → \`ch:${candidate.chapterId}\` на ` +
            `сэмпле ${String(cut)}. Пересечение границы главы эффектом или анимацией — ошибка ` +
            'компиляции (**V4** в исходной силе, ADR-0008), а не WARN: граница главы обязана ' +
            'быть границей сегмента, и разрезать чужой клип на шве компилятор не вправе — ' +
            'это меняло бы произведение. Укороти `until` до конца главы либо перенеси запись',
        });
      }
      verdict = { decision: 'cut', reason: 'chapter-forced', crossedBy, leftSamples, rightSamples };
    } else if (crossedBy.length > 0) {
      verdict = { decision: 'rejected', reason: 'crossed-by-clips', crossedBy, leftSamples, rightSamples };
    } else if (leftSamples < minSegmentSamples) {
      verdict = { decision: 'rejected', reason: 'left-too-short', crossedBy, leftSamples, rightSamples };
    } else if (rightSamples < minSegmentSamples) {
      verdict = { decision: 'rejected', reason: 'right-too-short', crossedBy, leftSamples, rightSamples };
    } else {
      verdict = { decision: 'cut', reason: null, crossedBy, leftSamples, rightSamples };
    }
    verdicts.set(candidate.atSample, verdict);

    if (verdict.decision === 'cut') {
      acceptedCuts.push(asSamples(cut));
      close(asSamples(cut), silenceAt.get(candidate.atSample) ?? null);
    }
  });

  if (crossedChapters.length > 0) {
    throw new CompileError('Charter V4', 'клип пересекает границу главы', crossedChapters);
  }
  close(track.durationSamples, null);

  assertSpeechNotCrossed(acceptedCuts, track);
  assertCaptionsNotCrossed(acceptedCuts, input.captionGroups);
  assertTotalSegments(out, track.durationSamples);
  // Обратная сторона проверки (б): каждый структурный кандидат обязан быть РАССМОТРЕН. Иначе
  // граница сцены могла бы не совпасть со стыком областей и тихо выпасть из таблицы.
  if (verdicts.size !== structural.size) {
    throw new CompileError('ADR-0008 «Сегментация (механика V4)»', 'структурный кандидат не рассмотрен', [
      {
        address: 'дорожка `speech`',
        message:
          `кандидатов с границей сцены или главы — ${String(structural.size)}, а рассмотрено ` +
          `${String(verdicts.size)}: точка разреза кандидата не совпала со стыком областей сцен`,
      },
    ]);
  }

  const rows: CutRow[] = track.cutCandidates.map((candidate) => {
    const verdict = verdicts.get(candidate.atSample);
    const cutSample = asSamples(candidate.atSample + candidate.durationSamples);
    if (verdict === undefined) {
      return {
        atSample: candidate.atSample,
        cutSample,
        boundary: candidate.boundary,
        silenceKind: candidate.silenceKind,
        durationSamples: candidate.durationSamples,
        decision: 'rejected',
        reason: 'not-scene-boundary',
        crossedBy: [],
        leftSamples: null,
        rightSamples: null,
      };
    }
    return {
      atSample: candidate.atSample,
      cutSample,
      boundary: candidate.boundary,
      silenceKind: candidate.silenceKind,
      durationSamples: candidate.durationSamples,
      decision: verdict.decision,
      reason: verdict.reason,
      crossedBy: verdict.crossedBy,
      leftSamples: verdict.leftSamples,
      rightSamples: verdict.rightSamples,
    };
  });

  const rejectedByReason: Record<RejectReason, number> = {
    'not-scene-boundary': 0,
    'crossed-by-clips': 0,
    'left-too-short': 0,
    'right-too-short': 0,
  };
  for (const row of rows) {
    if (row.decision !== 'rejected') continue;
    if (row.reason === null || row.reason === 'chapter-forced') continue;
    rejectedByReason[row.reason] += 1;
  }

  return {
    segments: out,
    table: {
      rows,
      segments: out.length,
      cutsAccepted: rows.filter((row) => row.decision === 'cut').length,
      rejectedByReason,
      minSegmentSamples,
    },
  };
}


/**
 * **Разбиение на сегменты тотально:** сегменты тилят `[0, L)` встык, и `Σ L_i == L`.
 *
 * Две формы, и вторая не следует из первой: разбиение сойдётся и на сегментах, чей
 * `nominalSamples` посчитан по неполному набору клипов. Именно поэтому `L_i` считается
 * суммированием (см. `nominalOf`), а не разностью границ.
 */
export function assertTotalSegments(list: readonly Segment[], durationSamples: Samples): void {
  const problems: CompileProblem[] = [];
  let expected = 0;
  let nominal = 0;
  for (const segment of list) {
    if (segment.startSample !== expected) {
      problems.push({
        address: segment.segmentId,
        message:
          `сегмент начинается на сэмпле ${String(segment.startSample)}, а предыдущий кончился ` +
          `на ${String(expected)}: ${segment.startSample > expected ? 'дыра' : 'перекрытие'} в ` +
          `${String(Math.abs(segment.startSample - expected))} сэмпл(ов)`,
      });
    }
    if (segment.endSample <= segment.startSample) {
      problems.push({
        address: segment.segmentId,
        message:
          `интервал [${String(segment.startSample)}, ${String(segment.endSample)}) пуст или ` +
          'вывернут (ADR-0003 T4)',
      });
    }
    if (segment.sceneIds.length === 0) {
      problems.push({ address: segment.segmentId, message: 'сегмент без единой сцены' });
    }
    nominal += segment.nominalSamples;
    expected = segment.endSample;
  }
  if (expected !== durationSamples) {
    problems.push({
      address: 'сегменты',
      message: `последний сегмент кончается на ${String(expected)}, а L = ${String(durationSamples)}`,
    });
  }
  if (nominal !== durationSamples) {
    problems.push({
      address: 'сегменты',
      message:
        `Σ nominalSamples = ${String(nominal)}, а L = ${String(durationSamples)}. ` +
        '`L_i` — сумма НОМИНАЛЬНЫХ длин клипов сегмента (речь + `[pause:]` + gap, ADR-0003 T6), ' +
        'и хвостовой gap принадлежит ПРЕДШЕСТВУЮЩЕМУ сегменту: потерять его значит потерять ' +
        'сэмплы, которые кто-то обязан отрендерить',
    });
  }
  if (problems.length > 0) {
    throw new CompileError('ADR-0003 T6', 'разбиение на сегменты не тотально', problems);
  }
}
