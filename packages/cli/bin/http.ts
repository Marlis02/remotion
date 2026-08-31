// НАСТОЯЩАЯ СЕТЬ — ГРАНИЦА ПРОЦЕССА (`V-06`), рядом с часами, случайностью и stdin.
//
// ЗДЕСЬ ЕДИНСТВЕННЫЙ `fetch` ВО ВСЁМ ДВИЖКЕ. Пакеты его не зовут ни один: `@vpe/voice`
// получает транспорт функцией (`HttpTransport`), остальным семи сеть запрещена ESLint'ом
// (ADR-0009 тест 7, `tests/boundaries/m4-network-only-voice.test.ts`). Приём тот же, что у
// `Date.now` (**D4**) и `randomBytes`: недетерминизм и внешний мир живут в `bin/`, а внутрь
// приезжают значением, — и ровно поэтому весь контур исполним в тестах без сети (**V9**).
//
// ФЛАГ ВЫШЕ ФУНКЦИИ. Транспорт создаётся только при `ELEVENLABS_LIVE=1`, и флаг берётся из
// НАСТОЯЩЕГО окружения процесса: файл `.env` его не даёт (решение владельца 2026-08-31).
// Секрет из файла — умолчание, разрешение ПОТРАТИТЬ ДЕНЬГИ — только командная строка.

import type { HttpTransport } from '@vpe/voice';

/** Имя флага живого прогона. Из файла `.env` не читается — см. `env-file.ts`. */
export const LIVE_FLAG = 'ELEVENLABS_LIVE';

/**
 * Транспорт поверх `fetch` — либо `undefined`, если живой прогон не разрешён.
 *
 * `undefined` — не «выключено», а НЕЧЕМ ЗВАТЬ: живой провайдер без транспорта не создаётся
 * вовсе (реестр `@vpe/voice`), поэтому забытый флаг не может обернуться тихой оплатой.
 */
export function liveTransport(env: NodeJS.ProcessEnv): HttpTransport | undefined {
  if (env[LIVE_FLAG] !== '1') return undefined;
  return async (request) => {
    const response = await fetch(request.url, {
      method: request.method,
      headers: { ...request.headers },
      ...(request.body === undefined ? {} : { body: request.body }),
    });
    // Тело читается ВСЕГДА, включая отказы: `HTTP 402 paid_plan_required` объясняет себя
    // телом, и выбросить его значило бы оставить автора с одним числом (`FACT` SP-2).
    return { status: response.status, body: await response.text() };
  };
}
