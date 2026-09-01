// **ДИАГНОСТИКА НЕДОШЕДШЕГО ВЫЗОВА** (`F-01`, дыра, найденная владельцем на живом прогоне).
//
// ЧТО ЗДЕСЬ ПРОВЕРЯЕТСЯ. Транспорт ОТКЛОНЁН — это не отказ провайдера (кода нет, тела нет), и
// до правки автор получал наружу голое `TypeError: fetch failed`: ни хоста, ни причины, ни
// ответа на единственный практический вопрос «списались ли деньги». Настоящая причина лежит
// в `cause` — `getaddrinfo ENOTFOUND api.elevenlabs.io`, `ECONNREFUSED`, отказ TLS, — и
// разворачивает её `callTransport`.
//
// СЕТИ ЗДЕСЬ НЕТ НИ ОДНОЙ СТРОКОЙ (**V9**): транспорт — вход провайдера, и подставляется
// функция, ОТКЛОНЯЮЩАЯСЯ той же формой, какой отклоняется настоящий `fetch` (`TypeError` с
// `cause`). Форма взята у Node, а не выдумана: `fetch` отклоняется именно так.
//
// ═══ ПОЧЕМУ ТЕСТ ТРЕБУЕТ ИМЕННО ТРИ ВЕЩИ ═══
// Хост — «куда не дошло» (и он же отличает опечатку в `baseUrl` от мёртвой сети); `cause` —
// «почему»; подсказка — «что делать». Отказ без любой из трёх возвращает автора ровно туда,
// где он был: к трём словам без диагноза.

import { describe, expect, it } from 'vitest';

import {
  ELEVENLABS_MODEL,
  VoiceError,
  accountSnapshot,
  callTransport,
  causeChain,
  elevenLabsProvider,
  ttsRequest,
  voiceCategory,
  type HttpTransport,
} from '../src/index.js';

/** Ключ и голос ЗАВЕДОМО ненастоящие: тест не читает окружения (CLAUDE.md §2). */
const FAKE_KEY = 'test-not-a-key';
const FAKE_VOICE = 'test-not-a-voice';

/**
 * Транспорт, отклоняющийся ТОЧНО ТАК ЖЕ, КАК `fetch` НА МЁРТВОЙ СЕТИ.
 *
 * `TypeError: fetch failed` + `cause` с системным кодом — форма Node, воспроизведённая
 * дословно. Подделка вида `new Error('нет сети')` проверяла бы не то: весь смысл правки в
 * том, что верхнее сообщение бесполезно, а полезное лежит ВНУТРИ.
 */
function deadNetwork(code = 'ENOTFOUND'): HttpTransport {
  return () => {
    const cause = Object.assign(new Error(`getaddrinfo ${code} api.elevenlabs.io`), { code });
    return Promise.reject(Object.assign(new TypeError('fetch failed'), { cause }));
  };
}

const request = ttsRequest({
  spokenText: 'The cellar keeps a lathe.',
  modelId: ELEVENLABS_MODEL,
  voiceId: FAKE_VOICE,
  seed: 7,
  outputFormat: 'pcm_24000',
});

describe('`causeChain` — причина, а не верхнее сообщение', () => {
  it('разворачивает цепочку и несёт системный код', () => {
    const chain = causeChain(
      Object.assign(new TypeError('fetch failed'), {
        cause: Object.assign(new Error('getaddrinfo ENOTFOUND api.elevenlabs.io'), {
          code: 'ENOTFOUND',
        }),
      }),
    );
    expect(chain).toContain('TypeError: fetch failed');
    expect(chain).toContain('ENOTFOUND');
    expect(chain).toContain('→');
  });

  it('цикл `cause` не зацикливает диагностику', () => {
    const loop: Error & { cause?: unknown } = new Error('петля');
    loop.cause = loop;
    expect(causeChain(loop)).toBe('Error: петля');
  });

  it('ошибка без `cause` — одна строка, а не пустота', () => {
    expect(causeChain(new TypeError('fetch failed'))).toBe('TypeError: fetch failed');
  });
});

describe('синтез: сеть не дошла — отказ называет хост, причину и что делать', () => {
  it('`fetch failed` разворачивается в диагноз', async () => {
    const provider = elevenLabsProvider({ apiKey: FAKE_KEY, transport: deadNetwork() });
    const error = await provider.synthesize(request).catch((e: unknown) => e);

    expect(error, 'отказ обязан быть договорным, а не чужим `TypeError`').toBeInstanceOf(VoiceError);
    const message = error instanceof Error ? error.message : String(error);
    // (1) КУДА не дошло.
    expect(message, 'отказ не называет хост').toContain('api.elevenlabs.io');
    // (2) ПОЧЕМУ — из `cause`, а не из верхнего сообщения.
    expect(message, 'отказ не разворачивает `cause`').toContain('ENOTFOUND');
    expect(message).toContain('fetch failed');
    // (3) ЧТО ДЕЛАТЬ.
    expect(message, 'отказ не даёт подсказки окружения').toMatch(/VPN/u);
    expect(message, 'отказ не говорит про DNS').toMatch(/DNS/u);
    // (4) Деньги: недошедший вызов не оплачен, и это обязано быть сказано словами.
    expect(message).toMatch(/не списываются/u);
    // Правило названо своё, а не «провайдер отказал»: решения у этих двух случаев разные.
    expect(error instanceof VoiceError ? error.rule : '').toBe('V-06 сеть недоступна');
  });

  it('`ECONNREFUSED` — тот же диагноз с другим кодом, а не общая фраза', async () => {
    const provider = elevenLabsProvider({ apiKey: FAKE_KEY, transport: deadNetwork('ECONNREFUSED') });
    await expect(provider.synthesize(request)).rejects.toThrow(/ECONNREFUSED/u);
  });

  it('в тексте нет ни ключа, ни id голоса — даже когда они попали в причину', async () => {
    const transport: HttpTransport = () =>
      Promise.reject(
        Object.assign(new TypeError('fetch failed'), {
          cause: new Error(`connect ECONNREFUSED while POST /v1/text-to-speech/${FAKE_VOICE} key ${FAKE_KEY}`),
        }),
      );
    const provider = elevenLabsProvider({ apiKey: FAKE_KEY, transport });
    const error = await provider.synthesize(request).catch((e: unknown) => e);
    const message = error instanceof Error ? error.message : String(error);
    expect(message).not.toContain(FAKE_KEY);
    expect(message).not.toContain(FAKE_VOICE);
    expect(message).toContain('<REDACTED>');
  });
});

describe('снимок аккаунта: та же диагностика на СПРАВОЧНОМ вызове', () => {
  it('первый же вызов живого прогона объясняет мёртвую сеть, а не падает `TypeError`', async () => {
    // Снимок аккаунта зовётся ПЕРВЫМ (`vpe build` спрашивает его до синтеза), то есть это
    // первое место, где автор узнаёт про недоступную сеть. Отказ там обязан быть тем же.
    const error = await accountSnapshot(
      { apiKey: FAKE_KEY, transport: deadNetwork() },
      FAKE_VOICE,
      null,
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VoiceError);
    const message = error instanceof Error ? error.message : String(error);
    expect(message).toContain('api.elevenlabs.io');
    expect(message).toContain('ENOTFOUND');
    expect(message).toMatch(/VPN/u);
  });

  it('id голоса затирается и здесь: он стоит в ПУТИ `/v1/voices/<id>`', async () => {
    // Справочный вызов класса голоса — единственный, чей АДРЕС несёт секрет (CLAUDE.md §2).
    // Хост в тексте отказа секретом не является, а вот причина, процитировавшая путь, — да.
    const transport: HttpTransport = () =>
      Promise.reject(
        Object.assign(new TypeError('fetch failed'), {
          cause: new Error(`request to /v1/voices/${FAKE_VOICE} failed, reason: ENOTFOUND`),
        }),
      );
    // Зовётся ИМЕННО `voiceCategory`, а не снимок целиком: снимок начинает с
    // `/v1/user/subscription`, где id голоса не участвует вовсе, и мёртвая сеть оборвала бы
    // его на первом же вызове — то есть проверялся бы не тот вызов.
    const error = await voiceCategory({ apiKey: FAKE_KEY, transport }, FAKE_VOICE).catch(
      (e: unknown) => e,
    );
    const message = error instanceof Error ? error.message : String(error);
    expect(message).not.toContain(FAKE_VOICE);
    expect(message).toContain('<REDACTED>');
  });
});

describe('`callTransport` — успех проходит насквозь', () => {
  it('ответ отдаётся как есть: обёртка ловит ОТКЛОНЕНИЕ, а не переписывает ответы', async () => {
    const response = await callTransport(
      () => Promise.resolve({ status: 402, body: '{"detail":{"status":"paid_plan_required"}}' }),
      { url: 'https://api.elevenlabs.io/v1/x', method: 'GET', headers: {} },
      [],
    );
    // HTTP 402 — это ОТВЕТ. Его читает `refuse` в провайдере, и подменять его сетевым
    // отказом значило бы потерять единственную ветку, которая объясняет тариф.
    expect(response.status).toBe(402);
    expect(response.body).toContain('paid_plan_required');
  });
});
