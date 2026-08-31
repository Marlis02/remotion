// Лестница ретраев приёмки (`V-02`, ADR-0010 §1 в редакции M12).
//
// ЧЕГО ЭТА ЛЕСТНИЦА НЕ ДЕЛАЕТ И ПОЧЕМУ ЭТО ГЛАВНОЕ В ФАЙЛЕ. Она **не делит чанк** и не
// порождает ни одного нового `chunkKey`. В первой редакции ADR-0010 провал приёмки вызывал
// автоматическое деление; деление меняет `chunkKey`, а с ним ключи стадии `voice`. Тогда
// границы чанков становятся функцией НЕДЕТЕРМИНИРОВАННОГО ответа сети: следующий прогон даёт
// другое разбиение, кэш промахивается без единого изменения входов, и дубли оплачиваются
// повторно — то есть §3 ADR-0010 («множество границ зависит только от байтов абзаца и его
// структурного адреса») нарушается ПЕРВЫМ ЖЕ срабатыванием аварийной лестницы из §1. Два
// правила одного ADR противоречили друг другу; побеждает §3, на нём стоит предсказуемость
// стоимости правки. Решение о делении принимает человек и записывает его в ТЕКСТ (`[pause:]`
// на границе предложения) либо в ПРОФИЛЬ (`maxChunkChars`) — в обоих случаях границы остаются
// функцией зафиксированных байтов, а не события.
//
// Исполнимая форма этого запрета: `chunkKey` — вход лестницы и он же уходит в каждую попытку
// НЕИЗМЕННЫМ; функции, способной его изменить, здесь нет ни одной. Охранник — инвариант **V2**:
// два прогона с подставным «больным» ответом дают одинаковое множество `chunkKey`.
//
// ПОЧЕМУ РЕТРАЙ ТЕМ ЖЕ ЗАПРОСОМ. `FACT` (r1 §2.3): вендор объявляет «Determinism is not
// guaranteed» даже при фиксированном seed, то есть второй ответ на ТОТ ЖЕ запрос может быть
// здоровым. Менять запрос между попытками нельзя по другой причине: изменённый текст — это
// другой `voiceKey` и другой дубль, а лестница чинит ответ, а не задание.
//
// ПРОВАЙДЕР ВНЕДРЯЕТСЯ, А НЕ ИМПОРТИРУЕТСЯ. Лестница не знает ни одного `providerId`
// (ADR-0010 §8, **V16**): источник дубля приходит функцией. Это же делает её исполнимой в
// тестовом контуре без сети и без ключа (**V9**).

import { VoiceError } from '../errors.js';
// ТИПОВЫЙ импорт, и потому стираемый: `EffectiveVoice` живёт в каталоге стадии, которая её
// вычисляет (`plan/`), а лестница только ПЕРЕДАЁТ её источнику неизменной. Тот же приём и по
// той же причине, что у `providers/types.ts` с `TakeBind` (`V-05`).
import type { EffectiveVoice } from '../plan/speech-plan.js';
import type { ProviderAlignment, TakeHealth } from '../providers/types.js';

import { assessTake, explainRejection, type TakeAcceptance } from './health.js';

/** Что лестница спрашивает у источника дубля. Запрос ТОТ ЖЕ на каждой попытке. */
export interface TakeAttemptRequest {
  /** Проходит сквозь лестницу неизменным: делить и переименовывать чанк она права не имеет. */
  readonly chunkKey: string;
  readonly spokenText: string;
  /** `0` — первая попытка, дальше ретраи. Существует для журнала, а не для ветвления запроса. */
  readonly attemptIndex: number;
  /**
   * Чем сказано (`V-06`): модель, голос, seed и `voice_settings` ЭТОГО чанка.
   *
   * ПОЛЕ ЗАВЕДЕНО НЕ ДЛЯ УДОБСТВА, А ПРОТИВ ЛЖИ В АРТЕФАКТЕ. Провенанс дубля пишет
   * `chunk.voice` (укладка, ADR-0010 §2), а источник до этой задачи получал только текст —
   * то есть живой провайдер обязан был бы взять голос откуда-то ещё. При роли, перекрывающей
   * голос проекта (ADR-0010 §3a-bis), take-файл утверждал бы одно, а звучало бы другое, и
   * различить это было бы нечем. Теперь «чем сказано» приезжает вместе с текстом.
   *
   * `undefined` законен и означает «источник голоса не спрашивает» (так живут все подделки
   * тестов и `tts:mock@1`).
   */
  readonly voice?: EffectiveVoice;
  /**
   * Сшивка ТОЛЬКО ТЕКСТОМ (ADR-0010 §4, **V5**): текст соседних чанков той же сцены.
   *
   * `FACT` (SP-2 U5): контекст **не тарифицируется** — 264 символа не попали в списание, — и
   * `FACT` (SP-2): он возвращает половину расхождения на шве. В ключи стадии `voice` контекст
   * НЕ входит (`speech-plan.ts`), иначе ключи образовали бы транзитивную цепочку — ровно то,
   * из-за чего отвергнуты `previous_request_ids`.
   */
  readonly previousText?: string;
  readonly nextText?: string;
}

/** Что источник дубля возвращает: ответ провайдера плюс фактическая дорожка. */
export interface TakeAttempt {
  readonly alignment: ProviderAlignment | null;
  readonly numSamples: number;
  readonly sampleRate: number;
}

/** Источник дубля — провайдер, `synthesize` или подделка теста. Сеть здесь не обязательна. */
export type TakeSource = (request: TakeAttemptRequest) => Promise<TakeAttempt> | TakeAttempt;

export interface AcceptTakeInput {
  readonly chunkKey: string;
  readonly spokenText: string;
  readonly acceptance: TakeAcceptance;
  readonly source: TakeSource;
  /** Уходит в КАЖДУЮ попытку неизменным — ровно как `chunkKey` (`V-06`). */
  readonly voice?: EffectiveVoice;
  readonly previousText?: string;
  readonly nextText?: string;
}

/** Принятый дубль: тот же `chunkKey`, метрики принятой попытки и её номер. */
export interface AcceptedTake {
  readonly chunkKey: string;
  readonly attempt: TakeAttempt;
  readonly health: TakeHealth;
  /** Сколько попыток ПОТРАЧЕНО, включая принятую. `1` — принят с первого раза. */
  readonly attempts: number;
}

/**
 * «Ретрай ×N → падение сборки» (ADR-0010 §1, M12).
 *
 * Всего попыток — `maxRetries + 1`: одна штатная и `maxRetries` ретраев. `maxRetries: 0` —
 * законное значение профиля и означает «ретраев нет», а не «попыток нет».
 *
 * @throws {VoiceError} `rule` = `ADR-0010 §1 (M12)` — лестница исчерпана. Сообщение несёт
 * `chunkKey`, число попыток, метрики и причину ПОСЛЕДНЕГО отказа, а также совет автору из
 * ADR-0010 §1. Деления чанка не происходит ни при каком исходе.
 */
export async function acceptTakeWithRetries(input: AcceptTakeInput): Promise<AcceptedTake> {
  const { chunkKey, spokenText, acceptance, source } = input;
  // Всё, что описывает ЗАДАНИЕ (голос и контекст сшивки), собирается ОДИН раз и уходит в
  // каждую попытку тем же значением: лестница чинит ОТВЕТ, а не задание (см. шапку). Изменить
  // задание между попытками значило бы получить другой `voiceKey` и другой дубль.
  const task = {
    ...(input.voice === undefined ? {} : { voice: input.voice }),
    ...(input.previousText === undefined ? {} : { previousText: input.previousText }),
    ...(input.nextText === undefined ? {} : { nextText: input.nextText }),
  };

  let lastHealth: TakeHealth | null = null;
  let lastAttempt: TakeAttempt | null = null;

  const total = acceptance.maxRetries + 1;
  for (let attemptIndex = 0; attemptIndex < total; attemptIndex += 1) {
    // `chunkKey` уходит В КАЖДУЮ попытку тем же значением, каким пришёл.
    const attempt = await source({ chunkKey, spokenText, attemptIndex, ...task });
    const health = assessTake({
      spokenText,
      alignment: attempt.alignment,
      numSamples: attempt.numSamples,
      sampleRate: attempt.sampleRate,
      acceptance,
    });
    if (health.verdict === 'accepted') {
      return { chunkKey, attempt, health, attempts: attemptIndex + 1 };
    }
    lastHealth = health;
    lastAttempt = attempt;
  }

  if (lastHealth === null || lastAttempt === null) {
    // Недостижимо при `maxRetries >= 0` (схема профиля требует неотрицательное целое), но
    // «недостижимо» обязано быть сказано ошибкой, а не молчанием: иначе отрицательное значение
    // порога превратило бы отказ приёмки в тихо принятый дубль.
    throw new VoiceError(
      'ADR-0010 §1 (M12)',
      `чанк ${chunkKey}: лестница не сделала ни одной попытки — ` +
        `maxRetries = ${String(acceptance.maxRetries)}. Приёмка обязана оценить хотя бы один дубль.`,
    );
  }

  const rejection = explainRejection(
    { spokenText, alignment: lastAttempt.alignment },
    lastHealth,
  );
  throw new VoiceError(
    'ADR-0010 §1 (M12)',
    `чанк ${chunkKey} не прошёл приёмку за ${String(total)} ` +
      `попыт${total === 1 ? 'ку' : 'ок'} (причина последнего отказа: ` +
      `${String(lastHealth.rejectReason)}; uniqueTimestampRatio ` +
      `${String(lastHealth.uniqueTimestampRatio)}, maxEqualRun ${String(lastHealth.maxEqualRun)}). ` +
      `${rejection === null ? '' : rejection.message} ` +
      'Что делать (ADR-0010 §1): сократи абзац, поставь `[pause:]` на границе предложения или ' +
      'включи `bind: forced-alignment` в профиле. Чанк НЕ делится автоматически (M12): ' +
      'деление сделало бы границы функцией недетерминированного ответа сети.',
  );
}
