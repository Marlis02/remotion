// `provider-timestamps@1` — дефолтный биндер v1 (ADR-0010 §5: «дефолт v1 — `provider-timestamps`
// (дешевле)»).
//
// ЧТО ОН ДЕЛАЕТ. Берёт таймкоды, которые провайдер уже прислал вместе с дублём, режет их на
// слова правилом §6 (`interval.ts`) и раздаёт токенам ИСХОДНИКА. Ни сети, ни модели, ни PCM:
// `requiresNetwork: false`, и параметр `pcm` он не читает вовсе — форма стадии одна на всех
// биндеров, иначе потребителю пришлось бы знать, кого он зовёт (**V16**).
//
// ТРИ ИСХОДА ДЛЯ ТОКЕНА, И ВСЕ ТРИ — ИЗ ADR-0010 §1/§5:
//   * произносимый токен, чьи слова нашлись в ответе, — `measured`, время ИЗМЕРЕНО;
//   * токен из одних непроизносимых code point'ов — `absent` (правило `V-02`: `FACT` SP-2 U6,
//     у провайдера такой code point получает интервал НУЛЕВОЙ длины, и записать его как
//     `[t, t]` значило бы дать субтитру слово нулевой длительности);
//   * произносимый токен, которого в ответе НЕТ, — тоже `absent`. Это второй генератор статуса
//     из §5 («TTS проглотил слово»), недостижимый до этой задачи по построению: привязки
//     выводились ИЗ ответа, а токенов исходника у стадии не было вовсе (долг №75).
// Четвёртого исхода нет: `interpolated` этот биндер не порождает — выдумывать время из соседей
// он права не имеет (**V8**), и охранник резервирования остаётся грепом.
//
// ПОЧЕМУ СОПОСТАВЛЕНИЕ ИДЁТ ПО ТЕКСТУ СЛОВ, А НЕ ПО ИНДЕКСАМ. Индексы `alignment.characters`
// равны индексам code point'ов `spokenText` ровно до тех пор, пока держится `charIdentity`
// (**V1**) — а дубль с ПРОГЛОЧЕННЫМ словом это ровно тот случай, когда она не держится, и
// индексы после пропуска съезжают. Биндер, доверившийся индексам, привязал бы соседние слова
// к чужому времени МОЛЧА — то есть выдумал бы его, только не арифметикой, а сдвигом. Поэтому
// два списка слов (исходника и ответа) сводятся двумя указателями по совпадению текста, а
// несведённое остаётся `absent`.
//
// ЕДИНСТВЕННАЯ КОНВЕРСИЯ ВРЕМЕНИ — `providerSecondsToSamples` (`V-01`). Второй точки перевода
// «секунды провайдера → сэмплы» в репозитории нет и не заводится.

import { pointLength, type Samples } from '@vpe/core-model';

import { VoiceError } from '../errors.js';
import { providerSecondsToSamples } from '../providers/time.js';
import type { ProviderAlignment, TokenBinding } from '../providers/types.js';

import { isPronounceable, tokenIntervals, wordsOf, type TokenInterval } from './interval.js';
import type { Binder, SourceTokenRef } from './types.js';

/** Имя биндера. Объявляется здесь и только здесь — в `if` не сравнивается нигде (**V16**). */
export const PROVIDER_TIMESTAMPS = 'provider-timestamps@1';

/** Вход чистого ядра биндера. `pcm` в нём нет: этот биндер звук не слушает. */
export interface ProviderTimestampsInput {
  readonly sampleRate: number;
  /** Фактически отправленный текст — он же домен `spokenStart` у ссылок на токены. */
  readonly spokenText: string;
  readonly tokens: readonly SourceTokenRef[];
  readonly providerAlignment: ProviderAlignment | undefined;
}

/** Слово исходника: чей токен и какой текст. Времени у него нет — оно приходит из ответа. */
interface SourceWord {
  readonly tokenIndex: number;
  readonly text: string;
}

/**
 * Привязки токенов по таймкодам провайдера — чистая функция, арифметическое ядро биндера.
 *
 * @throws {VoiceError} `ADR-0010 §5` — alignment не пришёл вовсе (измерять нечем), либо в
 *   ответе есть слово, которого нет в исходнике (`charIdentity` нарушена не пропуском, а
 *   подменой — приёмка `V-02` такой дубль отвергает, и выдумывать привязки для него нельзя),
 *   либо у произносимого слова нулевая длительность.
 */
export function bindProviderTimestamps(input: ProviderTimestampsInput): readonly TokenBinding[] {
  const { sampleRate, spokenText, tokens, providerAlignment } = input;
  assertTokensFitSpokenText(spokenText, tokens);
  if (providerAlignment === undefined) {
    throw new VoiceError(
      'ADR-0010 §5',
      'биндер по таймкодам провайдера позван без `alignment`. Оба поля ответа nullable ' +
        '(`FACT` r1 §1.3), и это законный отказ приёмки (`no-alignment`), а не повод ' +
        'привязать токены к выдуманному времени. Провайдер без пословных таймкодов обязан ' +
        'работать в паре с акустическим биндером (ADR-0010 §8).',
    );
  }

  // Слова ответа — только произносимые: непроизносимое слово времени не несёт по правилу §6,
  // и сопоставлять с ним нечего.
  const answer = tokenIntervals(providerAlignment).filter(
    (word): word is Extract<TokenInterval, { status: 'measured' }> => word.status === 'measured',
  );
  const source = sourceWords(tokens);
  const matched = matchInOrder(source, answer);

  return tokens.map((token, tokenIndex): TokenBinding => {
    const words = source
      .map((word, index) => ({ word, interval: matched[index] }))
      .filter((entry) => entry.word.tokenIndex === tokenIndex && entry.interval !== undefined);

    if (words.length === 0) {
      // Оба генератора `absent` сходятся здесь: у токена нет произносимых слов ВОВСЕ либо ни
      // одно из них не нашлось в ответе. Различать их полем незачем — время отсутствует
      // одинаково, а причину видно по самому токену.
      return { anchorId: token.anchorId, startSample: null, endSample: null, status: 'absent', confidence: null };
    }

    // Объединение интервалов произнесённых слов токена (ADR-0010 §6, третье предложение).
    // Слова идут по порядку и сведены по порядку, поэтому объединение — первое и последнее.
    const first = words[0]?.interval;
    const last = words[words.length - 1]?.interval;
    if (first === undefined || last === undefined) {
      throw new VoiceError(
        'ADR-0010 §6',
        `токен \`${token.surface}\`: список совпавших слов непуст, но его края не читаются — ` +
          'дефект сведения, а не входа.',
      );
    }
    const startSample = providerSecondsToSamples(first.start, sampleRate);
    const endSample = providerSecondsToSamples(last.end, sampleRate);
    assertPositiveLength(token, startSample, endSample);
    return { anchorId: token.anchorId, startSample, endSample, status: 'measured', confidence: null };
  });
}

/**
 * Ссылки на токены обязаны описывать ИМЕННО ЭТОТ отправленный текст.
 *
 * Проверка стоит здесь, а не в тесте, потому что ловит она молчаливую ошибку адресации:
 * ссылки, пересчитанные на границу СОСЕДНЕЙ части абзаца, дают правдоподобные привязки к
 * чужим словам. `spokenStart` — единственное, чем токен указывает на своё место в отправленном
 * тексте, и если срез по нему не равен `spoken` токена, то ссылки и текст — из разных чанков.
 *
 * @throws {VoiceError} `ADR-0010 §5`
 */
function assertTokensFitSpokenText(spokenText: string, tokens: readonly SourceTokenRef[]): void {
  const points = [...spokenText];
  for (const token of tokens) {
    const from = token.spokenStart;
    const slice = points.slice(from, from + pointLength(token.spoken)).join('');
    if (slice === token.spoken) continue;
    throw new VoiceError(
      'ADR-0010 §5',
      `ссылка на токен \`${token.surface}\` указывает на смещение ${String(from)} ` +
        `отправленного текста, но там лежит \`${slice}\`, а не \`${token.spoken}\`. Токены и ` +
        'текст пришли из разных чанков: смещение отсчитывается от начала того `spokenText`, ' +
        'который ушёл провайдеру, а не от начала абзаца.',
    );
  }
}

/** Произносимые слова токенов исходника, плоским списком в порядке исходника. */
function sourceWords(tokens: readonly SourceTokenRef[]): readonly SourceWord[] {
  const out: SourceWord[] = [];
  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
    const token = tokens[tokenIndex];
    if (token === undefined) continue;
    for (const word of wordsOf([...token.spoken])) {
      if (isPronounceable(word.text)) out.push({ tokenIndex, text: word.text });
    }
  }
  return out;
}

/**
 * Сведение двух списков слов двумя указателями: какое слово ответа досталось какому слову
 * исходника.
 *
 * ПРАВИЛО ОДНО: слова сводятся ПО ПОРЯДКУ и только при точном совпадении текста. Не совпало —
 * значит слова исходника до ближайшего совпадения в ответе НЕ ПРОЗВУЧАЛИ, и они остаются без
 * интервала (`absent`). Обратный случай — слово ответа, которого нет в остатке исходника —
 * это не пропуск, а подмена: `charIdentity` (**V1**) нарушена так, что чинить её сдвигом
 * нельзя, и биндер отказывается, а не угадывает.
 *
 * ЦЕНА, НАЗВАННАЯ ЯВНО: при повторяющихся словах («the … the», а прозвучало одно) совпадение
 * достаётся ПЕРВОМУ вхождению. Различить их без второго источника времени нечем; долг записан.
 */
function matchInOrder(
  source: readonly SourceWord[],
  answer: readonly Extract<TokenInterval, { status: 'measured' }>[],
): readonly (Extract<TokenInterval, { status: 'measured' }> | undefined)[] {
  const out = new Array<Extract<TokenInterval, { status: 'measured' }> | undefined>(source.length);
  let i = 0;
  let j = 0;

  while (i < source.length && j < answer.length) {
    const word = source[i];
    const interval = answer[j];
    if (word === undefined || interval === undefined) break;
    if (word.text === interval.text) {
      out[i] = interval;
      i += 1;
      j += 1;
      continue;
    }
    let k = i + 1;
    while (k < source.length && source[k]?.text !== interval.text) k += 1;
    if (k >= source.length) {
      throw new VoiceError(
        'ADR-0010 §5',
        `в ответе провайдера есть слово \`${interval.text}\`, которого нет в остатке ` +
          `отправленного текста (слово исходника на этом месте — \`${word.text}\`). Это не ` +
          'проглоченное слово, а подмена: приёмка отвергает такой дубль по `char-identity` ' +
          '(**V1**), и привязывать токены к чужому времени вместо отказа нельзя.',
      );
    }
    i = k;
  }
  return out;
}

/**
 * Интервал `measured` обязан быть непустым.
 *
 * `[t, t]` у произносимого слова — ровно то, что запрещает ADR-0010 §1: субтитр получил бы
 * слово нулевой длительности, а AC5-b — точку в статистике вместо пропуска. У `absent` такой
 * интервал НЕ ТИПИЗИРУЕТСЯ (размеченное объединение), у `measured` он невозможен потому, что
 * биндер отказывается его выдать.
 */
function assertPositiveLength(token: SourceTokenRef, startSample: Samples, endSample: Samples): void {
  if (endSample > startSample) return;
  throw new VoiceError(
    'ADR-0010 §1',
    `токен \`${token.surface}\`: таймкоды провайдера дают интервал ` +
      `[${String(startSample)}, ${String(endSample)}) — нулевой либо обратный. Произносимое ` +
      'слово нулевой длительности — это `[t, t]`, запрещённый §1; либо ответ испорчен, либо ' +
      'слово на самом деле непроизносимо, и тогда его статус обязан быть `absent`.',
  );
}

/**
 * Биндер по интерфейсу ADR-0010 §5.
 *
 * Обёртка над чистой функцией, а не вторая реализация: `Promise` в подписи интерфейса стоит
 * ради акустического биндера (внешний процесс), а этот арифметичен. Тест сверяет, что обёртка
 * отдаёт ровно то же, что `bindProviderTimestamps` — прецедент `mockProvider` (`V-01`).
 */
export const providerTimestampsBinder: Binder = Object.freeze({
  binderId: PROVIDER_TIMESTAMPS,
  requiresNetwork: false,
  // `_pcm` — звук этот биндер не слушает вовсе; подчёркивание стоит потому, что
  // `noUnusedParameters` в `tsconfig.base.json` включён, а параметр обязан остаться на своём
  // месте: форма стадии одна на всех биндеров (ADR-0010 §5), и акустический прочтёт его.
  async bind(
    _pcm: Uint8Array,
    sampleRate: number,
    spokenText: string,
    tokens: readonly SourceTokenRef[],
    providerAlignment?: ProviderAlignment,
  ): Promise<readonly TokenBinding[]> {
    return bindProviderTimestamps({ sampleRate, spokenText, tokens, providerAlignment });
  },
});
