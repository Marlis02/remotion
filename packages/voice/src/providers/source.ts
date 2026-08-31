// АДАПТЕР «ПРОВАЙДЕР → ИСТОЧНИК ДУБЛЯ» (`V-06`): `TtsProvider` → `SpeechSource`.
//
// ЗАЧЕМ ОН НУЖЕН И ПОЧЕМУ ОН ОДИН НА ВСЕХ ПРОВАЙДЕРОВ. Укладка (`plan/record.ts`) спрашивает у
// источника ДВЕ вещи: ответ провайдера и фактические байты дорожки. Провайдер по ADR-0010 §8
// отдаёт `audio_base64` и alignment. Разница между ними — ровно декодирование base64 и сборка
// запроса, и если бы это делал каждый провайдер сам, то `tts:mock@1` и `tts:elevenlabs@1`
// разошлись бы в том, ЧТО именно уходит в приёмку. Здесь этого места одно.
//
// ═══ ЧТО ЗДЕСЬ ВЕТВИТСЯ И ПО ЧЕМУ ═══
// Формат PCM выбирается `pcmFormatFor` — вопросом к `capabilities.pcmFormats`, а не к имени
// провайдера (ADR-0010 §8). Домен выравнивания проверяется `assertOriginalDomain`: привязки
// строятся только по `original`, а `normalized_alignment` в дубль не попадает (ADR-0010, Риски).
// Разрешать ли имя переменной окружения в значение — вопрос к `requiresNetwork`, и это тоже
// capability, а не имя: герметичному провайдеру голос провайдера не нужен вовсе, и для него
// имя переменной проходит насквозь (так `tts:mock@1` живёт с `VPE_MOCK_VOICE_ID`, которого в
// окружении нет и быть не должно).
//
// ═══ СЕКРЕТЫ ═══
// `project.yaml → voice.voiceId` держит ИМЯ переменной окружения, а не значение (решение
// владельца `S-02`, валидатор `^[A-Z][A-Z0-9_]*$` в `families/project.ts`). Разрешает имя в
// значение ЭТОТ файл — единственный, — и берёт его у ВХОДА `secrets`, а не из `process.env`:
// окружение читает граница процесса (`bin/vpe.ts`), как часы и случайность. Само значение не
// печатается ни в одном сообщении: в отказе стоит ИМЯ переменной (CLAUDE.md §2).

import { pcmFromBytes } from '@vpe/media';

import { VoiceError } from '../errors.js';

import type { SpeechSource, VoiceSynthesis } from '../plan/record.js';
import { assertOriginalDomain, pcmFormatFor } from './capabilities.js';
import { ttsRequest } from './request.js';
import type { TtsProvider } from './types.js';

/** Чем создают источник. Провайдер, частота проекта и способ разрешить имя переменной. */
export interface ProviderSpeechSourceInput {
  readonly provider: TtsProvider;
  /** `projectSampleRate` — речь запрашивается сразу нужной частоты (ADR-0010 §9, **V6**). */
  readonly sampleRate: number;
  /**
   * Имя переменной окружения → её значение. ВХОД, а не `process.env`: см. шапку.
   *
   * Умолчания нет намеренно. Источник без него молча слал бы имя переменной вместо id голоса —
   * то есть платил бы за отказ провайдера.
   */
  readonly secrets: (envName: string) => string | undefined;
}

/**
 * Источник дубля поверх провайдера.
 *
 * @throws {VoiceError} `ADR-0010 §5` — запрос пришёл без «чем сказано»; `CLAUDE.md §2` — имя
 *   переменной голоса не разрешилось; `ADR-0010 §9` — провайдер не умеет частоту проекта.
 */
export function providerSpeechSource(input: ProviderSpeechSourceInput): SpeechSource {
  const caps = input.provider.capabilities;
  assertOriginalDomain(caps);
  const outputFormat = pcmFormatFor(caps, input.sampleRate);

  return async (request): Promise<VoiceSynthesis> => {
    const voice = request.voice;
    if (voice === undefined) {
      throw new VoiceError(
        'ADR-0010 §5',
        `чанк ${request.chunkKey}: источник позван без «чем сказано» (\`voice\`). Провенанс ` +
          'дубля запишет модель, голос и seed чанка — синтезировать его другими значит ' +
          'записать в коммитимый артефакт утверждение, которого не было',
      );
    }

    const response = await input.provider.synthesize(
      ttsRequest({
        spokenText: request.spokenText,
        modelId: voice.modelId,
        voiceId: resolveVoiceId(caps.requiresNetwork, voice.voiceId, input.secrets),
        seed: voice.seed,
        outputFormat,
        // Стичинг ТОЛЬКО текстом (ADR-0010 §4, **V5**). Контекста нет — полей нет вовсе:
        // при `exactOptionalPropertyTypes` «поля нет» и «поле есть со значением `undefined`» —
        // разные типы, и в тело запроса второе ушло бы пустой строкой.
        ...(request.previousText === undefined ? {} : { previousText: request.previousText }),
        ...(request.nextText === undefined ? {} : { nextText: request.nextText }),
        ...(Object.keys(voice.providerOpts).length === 0 ? {} : { providerOpts: voice.providerOpts }),
      }),
    );

    return {
      alignment: response.alignment,
      // Байты — сырой s16le той частоты, которую мы запросили форматом. Второго места, где
      // base64 превращается в дорожку, в репозитории нет: длина PCM входит в приёмку (T7),
      // и разойтись этим двум местам было бы нечем, кроме молчания.
      pcm: pcmFromBytes(input.sampleRate, Buffer.from(response.audio_base64, 'base64')),
    };
  };
}

/** Имя переменной → значение; герметичному провайдеру — имя как есть (см. шапку). */
function resolveVoiceId(
  requiresNetwork: boolean,
  envName: string,
  secrets: (name: string) => string | undefined,
): string {
  if (!requiresNetwork) return envName;
  const value = secrets(envName);
  if (value === undefined || value.length === 0) {
    throw new VoiceError(
      'CLAUDE.md §2',
      `голос назван переменной окружения \`${envName}\`, а её в окружении нет. Значение id ` +
        'голоса берётся ТОЛЬКО из окружения процесса и в репозиторий не попадает ни в каком ' +
        'виде; в `project.yaml` лежит ИМЯ переменной, и подставить вместо него что-либо ' +
        'нельзя — дубль чужим голосом неотличим от нашего по всем полям, кроме звука',
    );
  }
  return value;
}
