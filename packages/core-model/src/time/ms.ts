// `msToSamples` — ЕДИНСТВЕННАЯ разрешённая функция перевода времени (ADR-0003 T1).
//
// ЕДИНСТВЕННЫЙ ФАЙЛ РЕПОЗИТОРИЯ, КОТОРОМУ РАЗРЕШЕНЫ `* sampleRate` И `/ 1000`
// (исключение в `eslint.config.js`). Причина исключения та же, по которой `canonical/json.ts`
// один имеет право на `JSON.stringify` (`S-01`): правило должно быть исполнимым, а не
// декларативным, и для этого у него обязано быть ровно одно названное место-исключение.
//
// ПОЧЕМУ ЭТО ВООБЩЕ ПРАВИЛО. ADR-0003, Context п. 4: `[pause: 400ms]` — единственная единица
// времени авторского слоя и единственное место, где в компилятор может просочиться float
// (1 мс = 44.1 сэмпла при 44100). Секунд в API нет вовсе — ни на входе, ни на выходе.
//
// МИЛЛИСЕКУНДЫ НЕ БРЕНДИРОВАНЫ, И ЭТО РЕШЕНИЕ ВЛАДЕЛЬЦА (`C-01`): T1 называет их **сахаром
// авторского слоя**, а бренд закрепил бы их как физическую единицу наравне с `Samples`.
// Поэтому вход — проверяемый `number`, выход — `Samples`.
//
// ОТРИЦАТЕЛЬНЫЕ МИЛЛИСЕКУНДЫ ОТВЕРГАЮТСЯ, А НЕ ОКРУГЛЯЮТСЯ К НУЛЮ. ADR-0003 про их знак
// молчит, но `[pause: −400ms]` не имеет смысла в авторском слое, а `floorDiv` на отрицательных
// уводил бы результат ОТ нуля (−1 мс при 24000 ⇒ −24 сэмпла), после чего `asSamples` всё равно
// отказал бы — но уже сообщением про бренд, а не про правило. Отказ здесь называет причину.

import { asSamples, type Samples } from '@vpe/schema';

import { TimeModelError } from './errors.js';
import { assertSafeInteger, floorDiv } from './integer.js';

/**
 * `msToSamples(ms) = floorDiv(ms * sampleRate, 1000)` — дословно ADR-0003 T1.
 *
 * @param ms целое ≥ 0; миллисекунды авторского слоя.
 * @param sampleRate целое > 0; `projectSampleRate` из `compileProfile`.
 * @throws `TimeModelError` (T1/T2) на отрицательных, нецелых и на переполнении произведения.
 */
export function msToSamples(ms: number, sampleRate: number): Samples {
  assertSafeInteger(ms, 'ms');
  assertSafeInteger(sampleRate, 'sampleRate');
  if (ms < 0) {
    throw new TimeModelError(
      'ADR-0003 T1',
      `\`ms\` = ${String(ms)}: миллисекунды авторского слоя неотрицательны. ` +
        'Отрицательный сдвиг выражается не длительностью, а `nudgeSamples` у `TimePoint` (ADR-0001).',
    );
  }
  if (sampleRate <= 0) {
    throw new TimeModelError('ADR-0003 T1', `\`sampleRate\` = ${String(sampleRate)}: ожидалось целое > 0`);
  }

  // Единственное место репозитория, где `* sampleRate` написано оператором. Проверка T2
  // стоит здесь вручную ровно потому, что здесь не используется `mulExact`: формула
  // ADR-0003 T1 воспроизведена буквально, чтобы её можно было сверить глазами со строкой ADR.
  const product = ms * sampleRate;
  assertSafeInteger(product, 'ms · sampleRate');

  return asSamples(floorDiv(product, 1000));
}
