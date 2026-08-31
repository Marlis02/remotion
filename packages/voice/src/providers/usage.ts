// СНИМОК АККАУНТА И ОХРАННИК МНОЖИТЕЛЯ ТАРИФА (`V-06`; ADR-0010 §2; SP-2 долг №13).
//
// ЗАЧЕМ ЭТОТ ФАЙЛ СУЩЕСТВУЕТ ОТДЕЛЬНО ОТ ПРОВАЙДЕРА. Всё, что здесь есть, — БЕСПЛАТНЫЕ
// справочные вызовы и арифметика над их ответами: тариф, класс голоса, сумма списаний за
// временное окно. Ни одного code point'а отсюда не отправляется, то есть файл не может стоить
// денег ни при какой ошибке — и это единственная причина, по которой он не лежит внутри
// `elevenlabs.ts`.
//
// ═══ ТРИ ИЗМЕРЕННЫХ ФАКТА, КОТОРЫЕ ЗДЕСЬ ИСПОЛНЯЮТСЯ, А НЕ ПЕРЕМЕРЯЮТСЯ ═══
//   * `FACT` (SP-2, findings «Тарификация и учёт»): единица тарификации — **code points**
//     отправленного текста, не UTF-16 units и не графемы (668 против 670 на строке с эмодзи);
//   * `FACT` (SP-2b.7): число СПИСАННЫХ единиц тарифо-зависимо — Free ×1.00, Creator
//     `round(codePoints × 0.55)` **покалльно**; `floor`, `ceil` и округление от суммы блока
//     отсеяны на трёх независимых окнах. Откуда берётся 0.55 — `UNKNOWN`: в ответах API его
//     нет (`token_cost_factor` модели равен 1 в обоих снимках аккаунта). Поэтому множитель
//     **не зашивается константой в код** (ADR-0010 §2 дословно): он приезжает снимком
//     аккаунта — переменной `ELEVENLABS_RATE_PER_CODEPOINT` — и записывается в провенанс
//     дубля рядом с `planTierAtGeneration`;
//   * `FACT` (SP-2): подписка обновляет `character_count` с задержкой **20–40 секунд**, и
//     дельта, снятая вокруг вызова, читается как **0**. Отсюда источник сверки —
//     `GET /v1/usage/character-stats` по ВРЕМЕННОМУ ОКНУ, и отсюда же третий вердикт
//     охранника: «окно ещё не осело» — это НЕ расхождение ставки. Тест это учитывает, а не
//     чинит (roadmap `V-06` дословно).

import { VoiceError } from '../errors.js';

import { redactSecrets, type HttpTransport } from './http.js';
import { ELEVENLABS_API_BASE } from './elevenlabs.js';
import type { VoiceCategory } from './types.js';

/** Чем спрашивают аккаунт. Те же входы, что у провайдера, и ни одного своего. */
export interface AccountOptions {
  readonly apiKey: string;
  readonly transport: HttpTransport;
  readonly baseUrl?: string;
}

/** Окно сверки в миллисекундах эпохи. Границы — ВХОД: часов у пакета нет (**D9**). */
export interface UsageWindow {
  readonly fromMs: number;
  readonly toMs: number;
}

/** Классы голоса провайдера → перечень ADR-0010 §2. Перевод, а не догадка. */
const VOICE_CATEGORY: Readonly<Record<string, VoiceCategory>> = Object.freeze({
  premade: 'premade',
  professional: 'professional',
  cloned: 'cloned',
});

async function getJson(options: AccountOptions, path: string): Promise<Record<string, unknown>> {
  const response = await options.transport({
    url: `${options.baseUrl ?? ELEVENLABS_API_BASE}${path}`,
    method: 'GET',
    headers: { 'xi-api-key': options.apiKey },
  });
  const body = redactSecrets(response.body, [options.apiKey]);
  if (response.status !== 200) {
    throw new VoiceError(
      'ADR-0010 §2',
      `справочный вызов \`${path.split('?')[0] ?? path}\` отказал: HTTP ` +
        `${String(response.status)} (${body.slice(0, 400)})`,
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw new VoiceError('ADR-0010 §2', `справочный вызов \`${path}\`: ответ не разобрался как JSON`);
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new VoiceError('ADR-0010 §2', `справочный вызов \`${path}\`: ответ — не объект`);
  }
  return value as Record<string, unknown>;
}

/**
 * Тариф на ДАТУ ГЕНЕРАЦИИ (ADR-0010 §2, `FACT` r3 §3.2: ретроспективно не восстановить).
 *
 * Пишется в провенанс как есть, строкой провайдера: перевод в свой перечень сделал бы
 * «creator» и «creator_business» одинаковыми, а коммерческие права у них разные.
 */
export async function planTier(options: AccountOptions): Promise<string> {
  const raw = await getJson(options, '/v1/user/subscription');
  const tier = raw['tier'];
  if (typeof tier !== 'string' || tier.length === 0) {
    throw new VoiceError(
      'ADR-0010 §2',
      'в снимке аккаунта нет `tier`. Провенанс без тарифа записать нельзя: `FACT` (r3 §3.2) ' +
        'коммерческие права на аудио даёт только платный план, и тариф на дату генерации ' +
        'ретроспективно не восстановить',
    );
  }
  return tier;
}

/**
 * Класс голоса (ADR-0010 §2). Незнакомый класс — ОТКАЗ, а не `'none'`.
 *
 * `'none'` означает «голоса нет вовсе» (так пишет `tts:mock@1`), и подставить его вместо
 * неизвестного значило бы записать в коммитимый артефакт утверждение, которого провайдер не
 * делал. `FACT` (SP-2): класс определяет доступность голоса на тарифе, а не только вкус.
 */
export async function voiceCategory(options: AccountOptions, voiceId: string): Promise<VoiceCategory> {
  const raw = await getJson(options, `/v1/voices/${encodeURIComponent(voiceId)}`);
  const category = raw['category'];
  const mapped = typeof category === 'string' ? VOICE_CATEGORY[category] : undefined;
  if (mapped === undefined) {
    throw new VoiceError(
      'ADR-0010 §2',
      `класс голоса \`${String(category)}\` не входит в перечень ADR-0010 §2 ` +
        `(${Object.keys(VOICE_CATEGORY).join(', ')}). Записать вместо него \`none\` нельзя: ` +
        '`none` означает «голоса нет вовсе», а не «класс неизвестен»',
    );
  }
  return mapped;
}

/**
 * Сумма списанных единиц за окно — `GET /v1/usage/character-stats`.
 *
 * Ответ приходит картой рядов (разбивка провайдера меняется от параметров запроса), поэтому
 * суммируются ВСЕ ряды: нас интересует итог окна, а не его разложение. Границы окна —
 * миллисекунды, эндпойнт принимает секунды: `floor` слева и `ceil` справа, чтобы окно
 * гарантированно НАКРЫВАЛО вызовы, а не обрезало их (приём SP-2, `billing-prod.mjs`).
 */
export async function billedInWindow(options: AccountOptions, window: UsageWindow): Promise<number> {
  const startUnix = Math.floor(window.fromMs);
  const endUnix = Math.ceil(window.toMs);
  const raw = await getJson(
    options,
    `/v1/usage/character-stats?start_unix=${String(startUnix)}&end_unix=${String(endUnix)}`,
  );
  const usage = raw['usage'];
  if (usage === null || typeof usage !== 'object') {
    throw new VoiceError('ADR-0010 §2', 'в ответе `usage/character-stats` нет поля `usage`');
  }
  let total = 0;
  for (const row of Object.values(usage as Record<string, unknown>)) {
    if (!Array.isArray(row)) continue;
    for (const cell of row) if (typeof cell === 'number' && Number.isFinite(cell)) total += cell;
  }
  return total;
}

/**
 * СНИМОК АККАУНТА на момент прогона: тариф, класс голоса и ставка (`V-06`).
 *
 * ТРИ ВЕЛИЧИНЫ ВМЕСТЕ, ПОТОМУ ЧТО ВМЕСТЕ ОНИ И ПИШУТСЯ — в провенанс дубля (ADR-0010 §2). Две
 * первые спрашиваются у провайдера бесплатно; третья у него не спрашивается ВООБЩЕ, потому что
 * её там нет (`UNKNOWN` SP-2b.7), и приезжает входом.
 */
export interface AccountSnapshot {
  readonly planTier: string;
  readonly voiceCategory: VoiceCategory;
  /** Ставка из окружения (`ELEVENLABS_RATE_PER_CODEPOINT`). `null` — не объявлена. */
  readonly ratePerCodePoint: number | null;
}

/** Два бесплатных справочных вызова плюс объявленная ставка. Ноль отправленных code points. */
export async function accountSnapshot(
  options: AccountOptions,
  voiceId: string,
  ratePerCodePoint: number | null,
): Promise<AccountSnapshot> {
  return {
    planTier: await planTier(options),
    voiceCategory: await voiceCategory(options, voiceId),
    ratePerCodePoint,
  };
}

// ── Охранник множителя тарифа (закрывает SP-2 №13) ──────────────────────────

/** Вход охранника: сколько отправлено ПОКАЛЛЬНО, сколько списано, какая ставка объявлена. */
export interface BilledRateCheck {
  /** Code points каждого платного вызова окна. Покалльно — потому что округление покалльное. */
  readonly sentPerCall: readonly number[];
  /** Что показало окно `usage/character-stats`. */
  readonly billed: number;
  /**
   * Ставка из снимка аккаунта. Не константа кода (ADR-0010 §2).
   *
   * `null` — «ставка НЕ ОБЪЯВЛЕНА», и это НЕ то же самое, что «ставка 1.00». Подставить сюда
   * единицу значило бы сверять списание с выдуманным числом: на Creator оно даёт «ставка
   * уехала» на каждом честном прогоне (`FACT` SP-2b.7: там ×0.55), то есть охранник кричал бы
   * на здоровом. Не объявлена — не сверяем и говорим об этом вслух.
   */
  readonly rate: number | null;
}

/**
 * Четыре исхода, и падение ровно одно.
 *
 * `'match'` — списание равно ожидаемому по объявленной ставке;
 * `'not-settled'` — окно показало **0** при непустой отправке: `FACT` (SP-2) подписка
 * обновляется с задержкой 20–40 с, и это НЕ расхождение ставки;
 * `'not-declared'` — ставки нет в снимке аккаунта: сверять НЕ С ЧЕМ. Молчаливое умолчание
 * здесь было бы хуже отсутствия охранника — оно называло бы здоровый прогон больным;
 * `'moved'` — ставка уехала. Ровно на этом исходе охранник падает (roadmap `V-06`, критерий).
 */
export type BilledRateVerdict = 'match' | 'not-settled' | 'not-declared' | 'moved';

export interface BilledRateReport {
  readonly verdict: BilledRateVerdict;
  readonly sent: number;
  readonly billed: number;
  /** Ожидаемое списание. `null`, когда ставка не объявлена: считать его не из чего. */
  readonly expected: number | null;
  /** Фактическая ставка окна — `billed / sent`. `null`, если отправлено ноль. */
  readonly observedRate: number | null;
  readonly rate: number | null;
}

/**
 * Ожидаемое списание: **сумма покалльных округлений**, а не округление суммы.
 *
 * `FACT` (SP-2b.7): формы `floor`, `ceil` и «округление от суммы блока» отсеяны на трёх
 * независимых окнах; выжила ровно `Σ round(cp_i × rate)`. Разница видна на числах: 3 вызова
 * по 101 code point при 0.55 дают 3 × 56 = 168, а округление суммы — 167.
 */
export function expectedBilled(sentPerCall: readonly number[], rate: number): number {
  return sentPerCall.reduce((sum, cp) => sum + Math.round(cp * rate), 0);
}

/**
 * Отчёт охранника. САМ НЕ БРОСАЕТ — вердикт нужен и живому тесту, и отчёту сборки.
 *
 * Допуск — **одна единица на вызов**: округление покалльное, и на границе `.5` формы
 * округления расходятся ровно на единицу. Больше допуска — ставка уехала.
 */
export function checkBilledRate(input: BilledRateCheck): BilledRateReport {
  const sent = input.sentPerCall.reduce((a, b) => a + b, 0);
  const rate = input.rate;
  const expected = rate === null ? null : expectedBilled(input.sentPerCall, rate);
  const observedRate = sent === 0 ? null : input.billed / sent;
  const base = { sent, billed: input.billed, expected, observedRate, rate };
  // Порядок вопросов значим: сначала «есть ли чем сверять», потом «осело ли окно», и только
  // потом «сошлось ли». Иначе необъявленная ставка читалась бы как уехавшая.
  if (expected === null) return { ...base, verdict: 'not-declared' };
  if (sent > 0 && input.billed === 0) return { ...base, verdict: 'not-settled' };
  const slop = input.sentPerCall.length;
  if (Math.abs(input.billed - expected) > slop) return { ...base, verdict: 'moved' };
  return { ...base, verdict: 'match' };
}

/**
 * Тот же охранник, но падением (закрывает SP-2 №13: «сверять при каждом прогоне и падать,
 * если множитель уехал»).
 *
 * @throws {VoiceError} `V-06 ставка тарифа (SP-2 №13)` — списание разошлось с объявленной
 *   ставкой больше, чем на единицу на вызов.
 */
export function assertBilledRate(input: BilledRateCheck): BilledRateReport {
  const report = checkBilledRate(input);
  if (report.verdict === 'moved') {
    throw new VoiceError(
      'V-06 ставка тарифа (SP-2 №13)',
      `множитель тарифа уехал: отправлено ${String(report.sent)} code points за ` +
        `${String(input.sentPerCall.length)} вызов(ов), объявленная ставка ` +
        `${String(report.rate)} обещает ${String(report.expected)} списанных единиц, а окно ` +
        `\`usage/character-stats\` показало ${String(report.billed)} ` +
        `(фактическая ставка ${report.observedRate === null ? '—' : report.observedRate.toFixed(4)}). ` +
        'Откуда берётся множитель, в ответах API нет (`UNKNOWN` SP-2b.7), поэтому он живёт ' +
        'снимком аккаунта: обновите `ELEVENLABS_RATE_PER_CODEPOINT` — и запишите новое ' +
        'значение в отчёт, потому что оно только что изменило цену каждого дубля',
    );
  }
  return report;
}
