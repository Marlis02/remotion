// Межсборочный кэш стадии `voice` (`M-05`; ADR-0006 §1, §8, §9; долг №89).
//
// ЧТО ЭТО ЗАКРЫВАЕТ. До `M-05` индекс `voiceKey → sha256` жил В ПАМЯТИ ОДНОГО ПРОГОНА
// `recordSpeechPlan` (`V-03`): рефрен внутри одной сборки оплачивался один раз (**V4**), а
// вторая сборка того же проекта платила за всё заново. Долг №89 назывался «попадание в УЖЕ
// ОПЛАЧЕННЫЙ дубль прошлой сборки не реализовано» — здесь оно реализовано.
//
// ЗНАЧЕНИЕ КЭША — ЗАПИСЬ, А НЕ БАЙТЫ, и это граница `.cache` ↔ `.store` (ADR-0005 §2).
// Оплаченный PCM невоспроизводим, живёт в CAS `kind: voice` и не подлежит вытеснению никогда
// (**K10**). Копировать его ещё и в `.cache` значило бы держать одни байты в двух местах,
// причём одно из них — вытесняемое. Поэтому здесь лежит маленькая каноническая запись: адрес
// байтов плюс всё, что иначе пришлось бы считать заново (вердикт приёмки, измеренные края,
// ответ провайдера). Каждое из этих полей — результат работы, которую попадание обязано НЕ
// повторять, а не украшение: `health` — вердикт лестницы (`V-02`), `edges` — проход детектора
// по дорожке (`V-04`), `alignment` — то, из чего стадия `bind` считает привязки (`V-05`).
//
// ПОЧЕМУ ЗАПИСЬ ХРАНИТ `alignment` ЦЕЛИКОМ. У рефрена один звук на два места, и привязки у
// них РАЗНЫЕ (**V4**): не сохрани мы ответ провайдера, второй чанк на попадании остался бы
// без привязок молча — ровно тот дефект, ради которого `V-05` завела отказ на пустых
// `bindings[]`.
//
// СЕТИ ЗДЕСЬ НЕТ. Промах не зовёт источник (ADR-0006 §9, **K8**) — он просто возвращает
// `undefined`; решение «ходить ли в сеть» принимает вызывающий, у которого стоит гейт
// `--allow-tts`. Два места, принимающих это решение, — одно место лишнее.
//
// ВОССТАНОВИМОСТЬ. `.cache` в git не идёт, а `voice/takes/*.json` идут. Поэтому take-файл с
// `M-05` несёт `voiceKey` полем (решение владельца, вопрос 3): манифест кэша — ПРОИЗВОДНОЕ,
// восстановимое сканом каталога дублей (`voiceCacheFromTakes`), а `rm -rf .cache` перестал
// стоить денег. Без этого поля пересчитать `voiceKey` из take-файла нечем: в нём нет ни
// `providerOpts`, ни `roleDigest`, ни версии тракта.

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { canonicalJson } from '@vpe/core-model';
import { StageCache, asBlobSha, type Store } from '@vpe/media';

import { VoiceError } from '../errors.js';

import type { ProviderAlignment, Take } from '../providers/types.js';

import { TAKES_DIR } from './take-file.js';

/**
 * Запись кэша: РОВНО ТО, ЧТО НЕЛЬЗЯ ПЕРЕСЧИТАТЬ, и ни одним полем больше.
 *
 * ЭТО ГЛАВНОЕ РЕШЕНИЕ ФАЙЛА, и оно найдено охранником, а не замыслом. Первая редакция клала
 * сюда ещё и вердикт приёмки, и измеренные края — «чтобы попадание не пересчитывало». Красным
 * стал линт `V-04` (`tests/lints/adr0003-t7-acoustic.test.ts`, долг №85): поле типа
 * `SpeechEdges` рядом с укладкой — это возможность записать в КОММИТИМЫЙ артефакт измерение,
 * которого не было. Охранник прав: кэш — файл в рабочем дереве, и правка `.cache/voice/<key>`
 * вручную подставила бы в take-файл выдуманный лид-ин, неотличимый от измеренного.
 *
 * Отсюда правило: **в кэше живёт только невоспроизводимое.**
 *   * `sha256`, `numSamples`, `sampleRate` — адрес и форма оплаченных байтов; это и ЕСТЬ кэш;
 *   * `alignment` — ответ провайдера. Пересчитать его нечем: он пришёл из сети и стоил денег.
 *
 * Всё остальное на попадании ВЫЧИСЛЯЕТСЯ из этих байтов теми же функциями, что на промахе:
 * края — `speechEdges` (`V-04`), вердикт — `assessTake` (`V-02`). Цена названа: один проход
 * RMS по дорожке и один проход по таймкодам, то есть микросекунды против секунд сети. Выгода
 * не в них: «попадание == промах» (**K3**) перестаёт быть утверждением про хранение и
 * становится свойством ПОСТРОЕНИЯ — пересчитанное значение неоткуда подменить.
 */
export interface VoiceCacheRecord {
  /** Адрес оплаченных байтов в CAS. Сами байты лежат там и только там. */
  readonly sha256: string;
  /** Длина дорожки. Дублирует `bytes.length / 2` НАМЕРЕННО: расхождение ловит чужой адрес. */
  readonly numSamples: number;
  readonly sampleRate: number;
  /** Ответ провайдера — вход стадии `bind` (`V-05`). `null` — законное значение. */
  readonly alignment: ProviderAlignment | null;
}

/**
 * Кэш стадии `voice` как контракт.
 *
 * ИНТЕРФЕЙС, А НЕ КЛАСС, ровно по тем же доводам, что у `Store` и `Binder`: `recordSpeechPlan`
 * получает его ЗНАЧЕНИЕМ, поэтому тестовый контур подставляет счётчик обращений, а сборка —
 * диск, и ни одна строка укладки от этого не меняется.
 */
export interface VoiceCache {
  get(voiceKey: string): Promise<VoiceCacheRecord | undefined>;
  put(voiceKey: string, record: VoiceCacheRecord): Promise<void>;
}

/** Разбор записи с ПРОВЕРКОЙ формы: испорченный кэш обязан быть слышен, а не подставлен. */
function parseRecord(voiceKey: string, text: string): VoiceCacheRecord {
  const parsed: unknown = JSON.parse(text);
  if (parsed === null || typeof parsed !== 'object') {
    throw new VoiceError(
      'ADR-0006 §8',
      `кэш стадии \`voice\`, ключ \`${voiceKey}\`: значение не является записью`,
    );
  }
  const record = parsed as Partial<VoiceCacheRecord>;
  if (
    typeof record.sha256 !== 'string' ||
    typeof record.numSamples !== 'number' ||
    typeof record.sampleRate !== 'number' ||
    record.alignment === undefined
  ) {
    throw new VoiceError(
      'ADR-0006 §8',
      `кэш стадии \`voice\`, ключ \`${voiceKey}\`: в записи не хватает полей. Дописать её ` +
        'умолчаниями нельзя ни одним полем: отсутствующий `alignment` и `alignment: null` — ' +
        'разные утверждения («записи нет» против «провайдер не вернул таймкодов»), и первое, ' +
        'подставленное вторым, дало бы дубль без привязок молча',
    );
  }
  return record as VoiceCacheRecord;
}

/**
 * Кэш стадии `voice` поверх механизма `M-05`: `.cache/voice/` (одно пространство имён).
 *
 * `profileId` у стадии не применим — `voiceKey` не содержит ни одного поля профиля рендера,
 * и `draft` с `final` слушают ОДИН оплаченный дубль (разбор — шапка `media/src/cache/layout.ts`).
 */
export function stageVoiceCache(projectRoot: string): VoiceCache {
  const cache = new StageCache(projectRoot, { stage: 'voice' });
  return {
    async get(voiceKey: string): Promise<VoiceCacheRecord | undefined> {
      const bytes = await cache.get(voiceKey);
      if (bytes === undefined) return undefined;
      return parseRecord(voiceKey, new TextDecoder().decode(bytes));
    },
    async put(voiceKey: string, record: VoiceCacheRecord): Promise<void> {
      await cache.put(voiceKey, new TextEncoder().encode(`${canonicalJson(record)}\n`));
    },
  };
}

/**
 * Байты оплаченного дубля по записи кэша.
 *
 * Адрес приходит СТРОКОЙ (из манифеста или take-файла), поэтому в бренд он превращается на
 * границе `media` (`asBlobSha`), а не кастом здесь: каст в бренд запрещён линтом во всём
 * репозитории, и запрещён по делу — иначе проверка «64 строчных hex» стала бы обещанием.
 */
export async function readTakeBytes(store: Store, record: VoiceCacheRecord): Promise<Uint8Array> {
  return store.read(asBlobSha(record.sha256));
}

/** Итог пересборки: сколько записей восстановлено и какие файлы восстановить нечем. */
export interface VoiceCacheRebuild {
  readonly restored: number;
  /** Пропущенные ГРОМКО: печатает их вызывающий, а не проглатывает эта функция. */
  readonly unrestorable: readonly { readonly file: string; readonly why: string }[];
}

/**
 * Пересборка кэша `voice` из коммитимых take-файлов — то, чем `.cache` перестаёт быть деньгами.
 *
 * ЧТО ЭТО ДОКАЗЫВАЕТ. Утверждение «манифест кэша — производное» ценно ровно настолько,
 * насколько существует функция, которая его производит. Она здесь: каталог `voice/takes/`
 * лежит в git, и каждого его файла хватает на полную запись кэша — `voiceKey` (поле,
 * добавленное `M-05`), адрес байтов, обе величины дорожки, вердикт приёмки, измеренные края и
 * ответ провайдера. Байты при этом не трогаются: они в `.store`, который не подлежит
 * вытеснению никогда (**K10**).
 *
 * ОТКАЗ ГРОМЧЕ ПОТЕРИ. Take-файл без `voiceKey` (такие писались до `M-05`) пересобрать в
 * запись нечем: пересчитать ключ из содержимого файла невозможно — в нём нет ни
 * `providerOpts`, ни `roleDigest`, ни версии тракта. Пропустить его молча значило бы вернуть
 * ровно тот дефект, ради которого поле и заведено: следующая сборка заплатила бы за уже
 * оплаченное и не сказала бы об этом ни слова.
 *
 * @throws {VoiceError} `ADR-0006 §8` — take-файл без `voiceKey`.
 */
export async function voiceCacheFromTakes(
  projectRoot: string,
  cache: VoiceCache,
): Promise<VoiceCacheRebuild> {
  const dir = path.join(projectRoot, TAKES_DIR);
  let names: string[];
  try {
    names = (await readdir(dir)).filter((name) => name.endsWith('.json')).sort();
  } catch {
    return { restored: 0, unrestorable: [] };
  }

  let restored = 0;
  const unrestorable: { file: string; why: string }[] = [];
  for (const name of names) {
    const text = await readFile(path.join(dir, name), 'utf8');
    const take = JSON.parse(text) as Partial<Take>;
    if (typeof take.voiceKey !== 'string' || take.voiceKey === '') {
      throw new VoiceError(
        'ADR-0006 §8',
        `take-файл \`${TAKES_DIR}/${name}\` не несёт \`voiceKey\`, и пересчитать его из ` +
          'содержимого файла нечем: в дубле нет ни `providerOpts`, ни `roleDigest`, ни версии ' +
          'тракта. Пропустить его молча значило бы заплатить за уже оплаченный дубль второй раз',
      );
    }
    if (take.pcm?.sha256 == null) {
      throw new VoiceError(
        'ADR-0006 §8',
        `take-файл \`${TAKES_DIR}/${name}\` не несёт адреса байтов (\`pcm.sha256\`): запись ` +
          'кэша без адреса указывала бы в пустоту',
      );
    }
    // ГРАНИЦА, НАЙДЕННАЯ ПРИ РЕАЛИЗАЦИИ И НАЗВАННАЯ ВСЛУХ (долг заведён отчётом `M-05`).
    // Дубль без блока `bind` законен (решение владельца, `V-05` вопрос 5: `bindings: []` и
    // `bind: null`), но ответа провайдера в файле тогда НЕТ — а он невоспроизводим. Из такого
    // take-файла запись кэша не собирается: положи мы `alignment: null`, попадание пересчитало
    // бы вердикт приёмки на пустом ответе и получило бы `rejected` — то есть кэш «вспомнил» бы
    // оплаченный дубль как негодный. Файл пропускается ГРОМКО, списком в результате.
    if (take.bind == null) {
      unrestorable.push({
        file: `${TAKES_DIR}/${name}`,
        why:
          'дубль записан без блока `bind`, то есть без ответа провайдера. Ответ ' +
          'невоспроизводим (он стоил денег и пришёл из сети), а без него запись кэша ' +
          'заставила бы попадание пересчитать вердикт приёмки на пустом `alignment`',
      });
      continue;
    }
    await cache.put(take.voiceKey, {
      sha256: take.pcm.sha256,
      numSamples: take.pcm.numSamples as number,
      sampleRate: take.pcm.sampleRate,
      alignment: take.bind.providerAlignment,
    });
    restored += 1;
  }
  return { restored, unrestorable };
}
