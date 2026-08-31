// ЖИВОЙ ДУБЛЬ ЧЕРЕЗ ПРИЁМКУ `V-02` — ЕДИНСТВЕННЫЙ ФАЙЛ РЕПОЗИТОРИЯ, КОТОРЫЙ ТРАТИТ ДЕНЬГИ.
//
// ═══ ПОЧЕМУ ЗДЕСЬ ЗАКОНЕН `skip` ═══
// ADR-0010 §7 требует, чтобы весь контур гонялся на `tts:mock@1` — без ключа, без сети и без
// денег. Этот файл — объявленное исключение (roadmap `V-06`): он делает ПЛАТНЫЙ вызов, и
// потому идёт только за флагом `ELEVENLABS_LIVE=1`, взятым из НАСТОЯЩЕГО окружения (файл
// `.env` его не даёт — `tests/setup/env-file.ts`). Без флага тест пропускается с ПРИЧИНОЙ в
// выводе, а не молча: молчаливый `skip` неотличим от зелёного.
//
// ═══ ЧТО ЗДЕСЬ ПРОВЕРЯЕТСЯ, ЧЕГО НЕ ПРОВЕРИТЬ НА МОКЕ ═══
//   1. живой ответ проходит приёмку `V-02` (критерий готовности `V-06`);
//   2. `charIdentity` держится на настоящем провайдере (`FACT` SP-2: 56/56 — здесь 57-я);
//   3. единица alignment — CODE POINT, а не UTF-16 unit (`FACT` SP-2 U4.2);
//   4. охранник множителя тарифа: «списано / отправлено» против объявленной ставки
//      (закрывает долг SP-2 №13). `FACT` (SP-2): окно `usage/character-stats` обновляется с
//      задержкой 20–40 с, поэтому вердикт `not-settled` — НЕ отказ; тест это учитывает, а не
//      чинит.
//
// ═══ БЮДЖЕТ ═══
// Один вызов на коротком тексте. Числа печатаются в вывод — они и есть отчёт о расходе.

import { describe, expect, it } from 'vitest';

import {
  assessTake,
  billedInWindow,
  checkBilledRate,
  elevenLabsCapabilities,
  planTier,
  providerFor,
  providerSpeechSource,
  speechEdges,
  voiceCategory,
  type HttpRequest,
  type HttpResponse,
  type TakeAcceptance,
} from '../src/index.js';

const LIVE = process.env['ELEVENLABS_LIVE'] === '1';
const API_KEY = process.env['ELEVENLABS_API_KEY'] ?? '';
const VOICE_ENV = 'ELEVENLABS_VOICE_ID';
const RATE = Number(process.env['ELEVENLABS_RATE_PER_CODEPOINT'] ?? '');

/** Текст одного платного вызова. Короткий: цена измеряется в code points (`FACT` SP-2). */
const TEXT = 'Море держит свет, и берег отвечает ему тишиной. Мы записываем это ровно один раз.';

/** Причина пропуска печатается ВСЕГДА: молчаливый `skip` неотличим от зелёного. */
if (!LIVE) {
  console.log(
    '[V-06] живой тест ElevenLabs ПРОПУЩЕН: нет `ELEVENLABS_LIVE=1` в окружении процесса. ' +
      'Это единственный законный `skip` репозитория (ADR-0010 §7 + roadmap `V-06`): вызов ' +
      'платный. Запуск: `ELEVENLABS_LIVE=1 npx vitest run ' +
      'packages/voice/test/live-elevenlabs.test.ts`.',
  );
} else if (API_KEY.length === 0) {
  console.log('[V-06] живой тест ПРОПУЩЕН: флаг есть, а ключа в окружении нет.');
}

/** Пороги приёмки — те же, что у профиля фикстуры (`audio-profile/1`, `V-02`). */
const ACCEPTANCE: TakeAcceptance = { minUniqueTimestampRatio: 0.9, maxEqualRun: 8, maxRetries: 1 };
const SAMPLE_RATE = 24000;

/** Транспорт живого прогона. Он же считает вызовы: «сколько оплачено» — это их число. */
function liveTransport(): { transport: (r: HttpRequest) => Promise<HttpResponse>; calls: number } {
  const state = { calls: 0 };
  return {
    get calls() {
      return state.calls;
    },
    transport: async (request) => {
      if (request.method === 'POST') state.calls += 1;
      const response = await fetch(request.url, {
        method: request.method,
        headers: { ...request.headers },
        ...(request.body === undefined ? {} : { body: request.body }),
      });
      return { status: response.status, body: await response.text() };
    },
  };
}

describe.skipIf(!LIVE || API_KEY.length === 0)('живой дубль `tts:elevenlabs@1`', () => {
  it(
    'проходит приёмку `V-02`, и множитель тарифа не уехал',
    { timeout: 180_000 },
    async () => {
      const { transport } = liveTransport();
      const options = { apiKey: API_KEY, transport };

      // ── снимок аккаунта: бесплатно, ноль отправленных code points ──────────
      const tier = await planTier(options);
      const voiceId = process.env[VOICE_ENV] ?? '';
      const category = await voiceCategory(options, voiceId);
      console.log(`[V-06] тариф: ${tier}; класс голоса: ${category}`);
      // `FACT` (SP-2): голос класса `professional` на Free отвечает 402 — смена тарифа вниз
      // ЛОМАЕТ сборку, а не деградирует её. Здесь это утверждение наблюдается, а не верится.
      expect(['premade', 'professional', 'cloned']).toContain(category);

      // ── один платный вызов ────────────────────────────────────────────────
      const sent = [...TEXT].length;
      const from = Date.now() - 1000;
      const source = providerSpeechSource({
        provider: providerFor(elevenLabsCapabilities.providerId, options),
        sampleRate: SAMPLE_RATE,
        secrets: (name: string) => process.env[name],
      });
      const synthesis = await source({
        chunkKey: 'live-v06',
        spokenText: TEXT,
        attemptIndex: 0,
        voice: {
          providerId: elevenLabsCapabilities.providerId,
          modelId: 'eleven_multilingual_v2',
          voiceId: VOICE_ENV,
          seed: 20260831,
          providerOpts: {},
        },
      });
      const to = Date.now() + 1000;

      // ── приёмка `V-02` — тот же судья, что и у мока ────────────────────────
      const health = assessTake({
        spokenText: TEXT,
        alignment: synthesis.alignment,
        numSamples: synthesis.pcm.samples.length,
        sampleRate: synthesis.pcm.sampleRate,
        acceptance: ACCEPTANCE,
      });
      // Параметры детектора — те же, что в профиле демо (`profiles/audio.yaml`): окно 10 мс
      // при 24 кГц и порог −45 dBFS. Числа взяты у профиля, а не подобраны здесь: их адрес —
      // `audio-profile/1`, и вторая их запись разошлась бы с первой.
      const edges = speechEdges(synthesis.pcm, {
        windowSamples: 240,
        thresholdDbFs: -45,
        sides: 'both',
      });
      console.log(
        `[V-06] отправлено code points: ${String(sent)}; вердикт: ${health.verdict}; ` +
          `charIdentity: ${String(health.charIdentity)}; uniqueRatio: ${String(health.uniqueTimestampRatio)}; ` +
          `maxEqualRun: ${String(health.maxEqualRun)}; tailResidual: ${String(health.tailResidualSamples)} сэмплов; ` +
          `лид-ин: ${String(edges.leadInSamples)} сэмплов (${(edges.leadInSamples / SAMPLE_RATE * 1000).toFixed(1)} мс)`,
      );

      expect(health.verdict).toBe('accepted');
      // `FACT` (SP-2 U4.1): тождество держится — это 57-е наблюдение подряд.
      expect(health.charIdentity).toBe(true);
      // `FACT` (SP-2 U4.2): единица — code point, а не UTF-16 unit.
      expect(synthesis.alignment?.characters.length).toBe(sent);

      // ── охранник множителя тарифа (закрывает SP-2 №13) ────────────────────
      // Окно осядет не сразу: `FACT` (SP-2) подписка обновляется 20–40 с. Ждём дважды по 25 с
      // и печатаем ЧТО ИМЕННО прочитали; вердикт `not-settled` отказом не считается.
      let billed = 0;
      for (let attempt = 0; attempt < 2 && billed === 0; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 25_000));
        billed = await billedInWindow(options, { fromMs: from, toMs: to });
      }
      // Ставка не объявлена — сверять НЕ С ЧЕМ, и подставлять 1.00 нельзя: на Creator это
      // назвало бы здоровый прогон больным (`FACT` SP-2b.7: там ×0.55). Вердикт скажет вслух.
      const report = checkBilledRate({
        sentPerCall: [sent],
        billed,
        rate: Number.isFinite(RATE) && RATE > 0 ? RATE : null,
      });
      console.log(
        `[V-06] окно usage/character-stats: списано ${String(report.billed)} при отправленных ` +
          `${String(report.sent)}; объявленная ставка ${String(report.rate)} обещает ` +
          `${String(report.expected)}; фактическая ставка ` +
          `${report.observedRate === null ? '—' : report.observedRate.toFixed(4)}; вердикт: ${report.verdict}`,
      );
      expect(
        report.verdict,
        'множитель тарифа уехал от объявленной ставки — цена каждого дубля изменилась',
      ).not.toBe('moved');
      // «Сверять нечем» — законный исход прогона, но он обязан быть ВИДЕН, а не проглочен.
      if (report.verdict === 'not-declared') {
        console.log(
          '[V-06] ставка не объявлена (`ELEVENLABS_RATE_PER_CODEPOINT` пуста) — сверка ' +
            'списания НЕ ВЫПОЛНЕНА. Это не «сошлось», это «не с чем сравнивать».',
        );
      }
    },
  );
});
