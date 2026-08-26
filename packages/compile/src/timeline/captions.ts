// Субтитры: `CaptionGroup` (`CP-02`, roadmap §4.7; норма — ADR-0003 «Субтитры (M6)»).
//
// ЧТО ЗДЕСЬ ПРОИСХОДИТ. Токены исходника в порядке прозы набиваются в группы по 1–3 слова,
// каждая — ОДНА строка без переносов. Время группы не вычисляется: `start` — начало первого
// токена, `end` — конец последнего (**T10** буквально). Ни сдвига «ради минимума», ни
// растяжения, ни интерполяции: компилятор не выдумывает время (норма `V-05`, `CP-01`).
//
// ЧТЕНИЕ «б» — РЕШЕНИЕ ВЛАДЕЛЬЦА 2026-08-26, ВОПРОС 1. Группа набирается ЖАДНО до
// `tokensPerGroupMax`, пока строка не превысила `maxGroupChars` и пока не кончился речевой
// клип; потолок символов дробит группу числом слов (3 → 2 → 1) и ПОБЕЖДАЕТ минимум
// длительности — строка, не влезающая в полосу, хуже короткой группы.
// `minGroupDurationFrames` — ПОРОГ ЗАПИСИ В ОТЧЁТ, а не цель, и это не смягчение ADR, а
// измерение: при одном и том же стартовом токене жадная набивка даёт группу НЕ КОРОЧЕ, чем
// «расти, пока короче минимума», то есть ранняя остановка минимуму ничего не добавляет, а
// потолок символов при ней не срабатывает НИ РАЗУ (измерено на фикстуре: 113 групп против 58,
// самая длинная строка 13 символов против 21). Разбор и кандидат в правку ADR — отчёт `CP-02`.
//
// НИ ОДНОЙ НОВОЙ ТОЧКИ КОНВЕРСИИ ВРЕМЕНИ. Порог сравнивается с длиной группы в сэмплах через
// `frameStartSample(grid, n)` — длину `n` кадров от нуля, ОДНОЙ функцией `core-model`, а не
// формулой на месте (линт T1). Позиции при этом не квантуются: кадров в Timeline нет
// (решение `CP-01`, вопрос 1 (в)), и `fps` здесь — про ДЛИНУ, а не про позицию.
//
// СЛИЯНИЯ ТОКЕНОВ НЕ ПРОИСХОДИТ НИКОГДА (**T11**). Группа — это СПИСОК токенов, каждый со
// своим `anchorId` и своей подсветкой; ни одна ветка ниже не складывает два `anchorId` в один
// и не выбрасывает токен из состава. Единственное, что склеивается, — ПОВЕРХНОСТНАЯ ФОРМА
// непроизносимого `absent`-соседа (вопрос 4 (г)), у которого своего якоря во времени нет вовсе.

import {
  asFrames,
  asSamples,
  chunksOf,
  frameStartSample,
  isSentenceEnd,
  timeGrid,
  type AnchorBinding,
  type AnchorId,
  type Chunk,
  type Samples,
  type SourceDocument,
  type TokenNode,
} from '@vpe/core-model';
import { anchorIdByToken, isPronounceable } from '@vpe/voice';

import type { AnchorTimes } from './anchors.js';
import { CompileError, type CompileProblem } from './errors.js';
import type { SpeechTrackResult } from './speech-track.js';
import type {
  CaptionGroup,
  CaptionGroupToken,
  CaptionReport,
  CaptionShortGroup,
  CompileProfileInput,
  PlacedSpeech,
} from './types.js';

/** Вход стадии субтитров. Всё — значения; диска, часов и случайности здесь нет. */
export interface CaptionsInput {
  readonly document: SourceDocument;
  /** `SyncResult.bindings` (`C-04`) — кто какой якорь получил. */
  readonly anchors: readonly AnchorBinding[];
  /** Разрешённые якоря (`anchorTimes`, `CP-01`): времена и множество `absent`. */
  readonly times: AnchorTimes;
  /** Дорожка речи: её клипы — границы, через которые группа не проходит. */
  readonly track: SpeechTrackResult;
  readonly profile: CompileProfileInput;
}

/** Выход стадии: группы в порядке исходника и отчёт сборки. */
export interface CaptionsResult {
  readonly groups: readonly CaptionGroup[];
  readonly report: CaptionReport;
}

/**
 * Закрывающие знаки, которые ДОПУСКАЮТСЯ после точки/восклицательного/вопросительного.
 *
 * `isSentenceEnd` (`core-model`, `C-02`) отвечает на ПЕРВУЮ половину вопроса — «этот code point
 * есть знак конца предложения», — и его шапка прямо говорит: «вторая половина — про то, что
 * стоит справа, — у каждого потребителя своя». Здесь потребитель — субтитр, и его вторая
 * половина ровно эта: `waiting”.` кончает предложение так же, как `waiting.`, потому что
 * закрывающая кавычка предложения не продолжает. Второй копии НАБОРА ЗНАКОВ не заводится —
 * решение владельца `V-03` (вопрос 2) требует, чтобы правило границы предложения было одно.
 */
const CLOSERS = new Set(['"', "'", '”', '’', '»', ')', ']', '›']);

/**
 * Кончается ли display-форма токена концом предложения.
 *
 * Известное ограничение, названное вслух: сокращение вида `Mr.` неотличимо от конца
 * предложения по одному только последнему знаку. Это ровно та же граница, что у `C-02` и
 * `V-03` (там она уже принята решением владельца), и своего правила субтитры не заводят.
 */
function endsSentence(surface: string): boolean {
  const points = [...surface];
  for (let i = points.length - 1; i >= 0; i -= 1) {
    const point = points[i] ?? '';
    if (CLOSERS.has(point)) continue;
    return isSentenceEnd(point);
  }
  return false;
}

/** Токен, готовый к набивке: display-форма, измеренное время, клип и адрес. */
interface DisplayToken {
  readonly anchorId: AnchorId;
  surface: string;
  readonly emph: boolean;
  readonly sceneId: string;
  readonly chunk: Chunk;
  readonly startSample: Samples;
  readonly endSample: Samples;
  readonly clip: PlacedSpeech;
}

/** Токен исходника вместе с тем, что о нём знает документ (но ещё не знает дорожка). */
interface SourceToken {
  readonly node: TokenNode;
  readonly anchorId: AnchorId;
  readonly emph: boolean;
  readonly sceneId: string;
  readonly chunk: Chunk;
}

/**
 * Токены документа в порядке прозы, с якорем и флагом `[emph]`.
 *
 * СОЕДИНЕНИЕ «ТОКЕН ↔ ЯКОРЬ» БЕРЁТСЯ ГОТОВЫМ. `anchorIdByToken` (`@vpe/voice`, `bind/tokens.ts`)
 * уже делает ровно это, ключом по САМОМУ УЗЛУ AST, и уже несёт двойную сверку (длиной списков
 * и поверхностной формой на каждом индексе). Второй копии соединения в репозитории быть не
 * должно — тот же довод, по которому `V-03` зовёт `isSentenceEnd`, а не копирует его.
 *
 * НО ЭТО СОЕДИНЕНИЕ — ZIP ПО ПОРЯДКУ, И ПОРЯДОК ЕМУ НАДО ДАТЬ. `anchorIdByToken` сверяет
 * i-й токен обхода с i-м слотом ВХОДНОГО МАССИВА, то есть зависит от порядка чтения ledger'а;
 * критерий же `CP-01` требует, чтобы перестановка входных массивов не меняла Timeline
 * (перестановка ловится тестом «два `compose` … перестановка входов»; на ней это и вскрылось).
 * Канонический порядок уже посчитан стадией якорей — `AnchorTimes.ordinalById`, `(глава, сцена,
 * ordinal слота)`, — и берётся оттуда. Третьей сортировки в репозитории не заводится.
 *
 * SCOPE `[emph]` НАЗВАН ЗДЕСЬ И ТОЛЬКО ЗДЕСЬ: «следующий токен того же чанка». Он ВРЕМЕННЫЙ —
 * настоящий выбирает `CP-05` (решение `C-02`: в AST у маркера scope нет вовсе; дрейф roadmap
 * §11.2 строка 16). Долг №128.
 */
function sourceTokens(input: CaptionsInput): readonly SourceToken[] {
  const ordered = [...input.anchors].sort(
    (left, right) =>
      (input.times.ordinalById.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
      (input.times.ordinalById.get(right.id) ?? Number.MAX_SAFE_INTEGER),
  );
  const anchorOf = anchorIdByToken(input.document, ordered);
  const out: SourceToken[] = [];
  for (const chapter of input.document.chapters) {
    for (const scene of chapter.scenes) {
      for (const block of scene.blocks) {
        if (block.kind !== 'paragraph') continue;
        for (const chunk of chunksOf(block)) {
          let emphPending = false;
          for (const node of chunk.nodes) {
            if (node.kind === 'emph') {
              emphPending = true;
              continue;
            }
            if (node.kind !== 'token') continue;
            const anchorId = anchorOf.get(node);
            if (anchorId === undefined) continue;
            out.push({ node, anchorId, emph: emphPending, sceneId: scene.id, chunk });
            emphPending = false;
          }
        }
      }
    }
  }
  return out;
}

/**
 * Речевой клип, внутри которого лежит интервал токена.
 *
 * Клип ищется ПО ВРЕМЕНИ, а не по `chunkKey` документа, и это не окольный путь: план речи
 * вправе разрезать длинный абзац по `maxChunkChars` (ADR-0010 §3), и тогда один `Chunk` AST
 * даёт НЕСКОЛЬКО клипов. Время же принадлежит ровно одному клипу по построению дорожки
 * (тотальное разбиение, `CP-01`), поэтому вхождение и есть ответ.
 */
function clipAt(clips: readonly PlacedSpeech[], sample: Samples): PlacedSpeech | null {
  let low = 0;
  let high = clips.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const clip = clips[mid];
    if (clip === undefined) break;
    if (sample < clip.startSample) high = mid - 1;
    else if (sample >= clip.endSample) low = mid + 1;
    else return clip;
  }
  return null;
}

/**
 * Токены со временем и клипом; непроизносимые `absent` приклеены к соседу слева.
 *
 * ДВА ПРОИСХОЖДЕНИЯ `absent` РАЗВЕДЕНЫ ПРЕДИКАТОМ, КОТОРЫЙ УЖЕ НАПИСАН (решение владельца
 * 2026-08-26, вопрос 4 (г); `isPronounceable` — `@vpe/voice`, `/[\p{L}\p{N}]/u`):
 *   * непроизносимая форма (одни знаки препинания) — времени у неё нет и не было бы даже у
 *     идеального провайдера (`FACT` SP-2 U6). Она приклеивается к `surface` ПРЕДЫДУЩЕГО токена
 *     того же чанка без пробела и без подсветки. Группу такой токен НИКОГДА не начинает,
 *     поэтому **T10** остаётся буквальным: края группы по-прежнему равны краям её первого и
 *     последнего ИЗМЕРЕННЫХ токенов;
 *   * произносимая форма — провайдер проглотил настоящее слово. Это ОШИБКА КОМПИЛЯЦИИ со
 *     списком: показать слово без времени нельзя (зритель прочтёт не то, что слышит), вывести
 *     время из соседей нельзя (`V8`, ADR-0010 §5). Время принесёт `A-03`; долг №126.
 *
 * @throws {CompileError} `absent` под произносимым токеном; `absent` в начале чанка;
 *   токен, не попавший ни в один речевой клип либо вылезающий за его конец.
 */
function displayTokens(input: CaptionsInput): readonly DisplayToken[] {
  const clips = [...input.track.speechByChunk.values()].sort(
    (left, right) => left.startSample - right.startSample,
  );
  const problems: CompileProblem[] = [];
  const out: DisplayToken[] = [];

  for (const token of sourceTokens(input)) {
    const time = input.times.byId.get(token.anchorId);
    if (time === undefined) {
      if (!input.times.absent.has(token.anchorId)) {
        problems.push({
          address: token.anchorId,
          message:
            `токен \`${token.node.surface}\` не разрешается во время, и статуса \`absent\` у ` +
            'него тоже нет: субтитру нечего показать и нечем это объяснить',
        });
        continue;
      }
      if (isPronounceable(token.node.surface)) {
        problems.push({
          address: token.anchorId,
          message:
            `слово \`${token.node.surface}\` несёт привязку со статусом \`absent\`: провайдер ` +
            'его проглотил, времени у него НЕТ (ADR-0010 §5, **V8**). Субтитр обязан показать ' +
            'то, что слышно, а компилятор не имеет права ни поставить ноль, ни вывести время ' +
            'из соседей — перегенерируй дубль либо исправь исходник',
        });
        continue;
      }
      const previous = out.at(-1);
      if (previous === undefined || previous.chunk !== token.chunk) {
        problems.push({
          address: token.anchorId,
          message:
            `непроизносимый токен \`${token.node.surface}\` стоит первым в своём чанке: ` +
            'времени у него нет, а приклеить его к предыдущему слову нельзя — предыдущего ' +
            'слова в этом речевом клипе не существует',
        });
        continue;
      }
      previous.surface += token.node.surface;
      continue;
    }

    const clip = clipAt(clips, time.startSample);
    if (clip === null || time.endSample > clip.endSample) {
      problems.push({
        address: token.anchorId,
        message:
          `интервал токена \`${token.node.surface}\` [${String(time.startSample)}, ` +
          `${String(time.endSample)}) не лежит целиком ни в одном речевом клипе дорожки. ` +
          'Группа субтитров не имеет права пересекать границу клипа, а токен, торчащий за неё, ' +
          'сделал бы это по построению',
      });
      continue;
    }
    out.push({
      anchorId: token.anchorId,
      surface: token.node.surface,
      emph: token.emph,
      sceneId: token.sceneId,
      chunk: token.chunk,
      startSample: time.startSample,
      endSample: time.endSample,
      clip,
    });
  }

  if (problems.length > 0) {
    throw new CompileError('ADR-0003 «Субтитры (M6)»', 'токены не складываются в субтитры', problems);
  }
  return out;
}

/** Одна строка группы: display-формы через пробел, без переносов. */
function textOf(tokens: readonly DisplayToken[]): string {
  return tokens.map((token) => token.surface).join(' ');
}

/**
 * Можно ли добавить `next` к уже набранной группе.
 *
 * Порядок условий — это и есть приоритет правил, и он назван решением владельца:
 *   1. граница речевого клипа непроходима ВСЕГДА;
 *   2. `tokensPerGroupMax` — жёсткий потолок числа слов;
 *   3. `maxGroupChars` — жёсткий потолок строки; он и дробит группу 3 → 2 → 1;
 *   4. конец предложения закрывает группу — но СЛАБЕЕ, чем `tokensPerGroupMin`: пока в группе
 *      меньше минимума слов, правило предложения молчит. При `tokensPerGroupMin: 1` фикстуры
 *      эта оговорка инертна, и это сказано здесь, а не спрятано.
 */
function fits(
  current: readonly DisplayToken[],
  next: DisplayToken,
  captions: CompileProfileInput['captions'],
): boolean {
  const first = current[0];
  const last = current.at(-1);
  if (first === undefined || last === undefined) return true;
  if (first.clip !== next.clip) return false;
  if (current.length >= captions.tokensPerGroupMax) return false;
  if ([...textOf([...current, next])].length > captions.maxGroupChars) return false;
  if (current.length >= captions.tokensPerGroupMin && endsSentence(last.surface)) return false;
  return true;
}

/** Группа из набранных токенов. Время — края первого и последнего, буквально (**T10**). */
function groupOf(tokens: readonly DisplayToken[], minDurationSamples: Samples): CaptionGroup {
  const first = tokens[0];
  const last = tokens.at(-1);
  if (first === undefined || last === undefined) {
    throw new CompileError('ADR-0003 «Субтитры (M6)»', 'пустая группа субтитров', [
      { address: 'captions', message: 'группа без токенов непредставима: набивка сломана' },
    ]);
  }
  const items: CaptionGroupToken[] = tokens.map((token) => ({
    anchorId: token.anchorId,
    surface: token.surface,
    startSample: token.startSample,
    endSample: token.endSample,
    emph: token.emph,
  }));
  return {
    startSample: first.startSample,
    endSample: last.endSample,
    tokens: items,
    text: textOf(tokens),
    chunkKey: first.clip.chunkKey,
    sceneId: first.sceneId,
    belowMinimum: last.endSample - first.startSample < minDurationSamples,
  };
}

/**
 * Строит группы субтитров и отчёт стадии.
 *
 * @throws {CompileError} со СПИСКОМ — `absent` под произносимым словом, непроизносимый токен
 *   первым в чанке, токен вне речевого клипа.
 */
export function captionGroups(input: CaptionsInput): CaptionsResult {
  const captions = input.profile.captions;
  // ДЛИНА, А НЕ ПОЗИЦИЯ: `frameStartSample(grid, n)` — это первый сэмпл кадра `n`, то есть
  // ровно длина `n` кадров от нуля. Одной функцией `core-model`, без формулы на месте (T1).
  const grid = timeGrid(input.profile.projectSampleRate, input.profile.fps);
  // `asFrames` — КОНСТРУКТОР бренда, а не каст: «бренд, снимаемый кастом, — не бренд»
  // (`S-01`, долг №3), и надеваемый кастом — тем более. Реэкспорт из `core-model` третьим
  // адресным блоком заведён решением владельца 2026-08-26 ровно под этот вызов.
  const minDurationSamples = frameStartSample(grid, asFrames(captions.minGroupDurationFrames));

  const tokens = displayTokens(input);
  const groups: CaptionGroup[] = [];
  let current: DisplayToken[] = [];
  for (const token of tokens) {
    if (current.length > 0 && !fits(current, token, captions)) {
      groups.push(groupOf(current, minDurationSamples));
      current = [];
    }
    current.push(token);
  }
  if (current.length > 0) groups.push(groupOf(current, minDurationSamples));

  const short: CaptionShortGroup[] = groups
    .filter((group) => group.belowMinimum)
    .map((group) => ({
      startSample: group.startSample,
      endSample: group.endSample,
      text: group.text,
      tokens: group.tokens.length,
      durationSamples: asSamples(group.endSample - group.startSample),
      minDurationSamples,
    }));

  // Хвостовой огрызок — последняя группа клипа из ОДНОГО слова при том, что групп в клипе
  // больше одной (набивка 3 + 1). Счётчик, а не порог: он ничего не меняет в компиляции и
  // существует ради чтения (в) при пересмотре после первого ролика (**X3**, долг №124).
  let tailSingletons = 0;
  groups.forEach((group, index) => {
    const next = groups[index + 1];
    const previous = groups[index - 1];
    const lastOfClip = next === undefined || next.chunkKey !== group.chunkKey;
    const alone = previous === undefined || previous.chunkKey !== group.chunkKey;
    if (lastOfClip && !alone && group.tokens.length === 1) tailSingletons += 1;
  });

  return { groups, report: { short, tailSingletons } };
}
