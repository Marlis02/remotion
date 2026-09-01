// **`build/reports/voice.txt` — РАСХОД ГОЛОСА СБОРКИ** (`F-01`, дыра, найденная владельцем на
// первой живой сборке `examples/ai-test-1`).
//
// ЧТО БЫЛО НЕ ТАК. Отчёт печатал две величины — `sourceCalls` и `cacheHits`, — и на сборке,
// взявшей все четыре дубля из `voice/takes/`, обе равнялись нулю: «обращений к источнику 0,
// попаданий кэша 0». Из такого отчёта нельзя узнать ни что дубли нашлись, ни сколько стоил
// ролик. Причина в том, что попаданий бывает ТРИ РОДА, а считалось два:
//   * **дубль на диске** — take-файл лежал к началу стадии (`reusedTakes`, `F-01`);
//   * **межсборочный кэш** (`cacheHits`, `M-05`) — сборка его пока не подключает вовсе;
//   * **рефрен внутри прогона** (**V4**) — один оплаченный дубль на два чанка; он виден как
//     разница «чанков» и «обращений к источнику».
//
// ═══ ЧИСЛА — ИЗ TAKE-ФАЙЛОВ, А НЕ ИЗ СЕТИ ═══
// `billedUnits` дубля — «сколько code points ОТПРАВЛЕНО» (ADR-0010 §2), величина, вычислимая
// офлайн из самого дубля; `planRateAtGeneration` — ставка НА ДАТУ ГЕНЕРАЦИИ, лежащая рядом
// (`FACT` r3 §3.2: ретроспективно тариф не восстановить). Отчёт складывает то, что записано в
// артефактах, и не спрашивает провайдера ни одним вызовом: сборка на готовых дублях обязана
// идти без сети вовсе, а отчёт о ней — тем более.
//
// СПИСАНИЕ СЧИТАЕТСЯ `expectedBilled` ИЗ `@vpe/voice` — той же функцией, которой охранник
// `assertBilledRate` сверяет окно `usage/character-stats` (`V-06`). Второе выражение того же
// правила («сумма ПОКАЛЛЬНЫХ округлений, а не округление суммы» — `FACT` SP-2b.7) разошлось бы
// с первым на первой же дробной ставке: 3 вызова по 101 code point при 0.55 дают 168, а
// округление суммы — 167.

import { expectedBilled } from '@vpe/voice';

/** Один чанк плана в отчёте: что отправлено и по какой ставке это записано в дубле. */
export interface VoiceReportChunk {
  readonly chunkKey: string;
  /** Отправленные code points из провенанса дубля. `null` — дубля нет (промах). */
  readonly billedUnits: number | null;
  /** Ставка на дату генерации. `null` — не объявлена (герметичный провайдер либо старый дубль). */
  readonly rate: number | null;
  /** Дубль лежал на диске к началу стадии — за него эта сборка не платила. */
  readonly reused: boolean;
}

export interface VoiceReportInput {
  readonly chunks: readonly VoiceReportChunk[];
  /** Сколько раз позван источник дубля — «сколько оплачено ЭТОЙ сборкой» (**K3**). */
  readonly sourceCalls: number;
  /** Попадания МЕЖСБОРОЧНОГО кэша (`M-05`). Сборка его пока не подключает — ноль всегда. */
  readonly cacheHits: number;
  /** Дубли с чужим `voiceKey`: лежали, но описывают другое содержимое (`V-06`). */
  readonly staleTakes: readonly string[];
  /** WARN дрейфа краёв (`V-04`) либо `null`. */
  readonly edgeDrift: string | null;
}

/** Итог по расходу: то, что печатается строкой ИТОГО и цитируется в отчёте задачи. */
export interface VoiceSpend {
  /** Σ `billedUnits` по чанкам с дублями — «сколько отправлено за этот ролик всего». */
  readonly sent: number;
  /**
   * Σ покалльных округлений `round(cp × rate)` по чанкам, у которых ставка ОБЪЯВЛЕНА.
   * `null` — ставки нет ни у одного дубля: «списано 0» было бы утверждением о деньгах,
   * которого никто не делал (ADR-0010 §2, то же правило, что у `planRateAtGeneration`).
   */
  readonly billed: number | null;
  /** Сколько чанков без объявленной ставки — их вклад в `billed` не входит. */
  readonly withoutRate: number;
  /** Чанков без дубля вовсе (промах): в суммы не входят и названы отдельно. */
  readonly missing: number;
}

/** Расход по чанкам — ЧИСТАЯ функция над тем, что прочитано из take-файлов. */
export function voiceSpend(chunks: readonly VoiceReportChunk[]): VoiceSpend {
  let sent = 0;
  let withoutRate = 0;
  let missing = 0;
  const billedPerCall = new Map<number, number[]>();
  for (const chunk of chunks) {
    if (chunk.billedUnits === null) {
      missing += 1;
      continue;
    }
    sent += chunk.billedUnits;
    if (chunk.rate === null) {
      withoutRate += 1;
      continue;
    }
    // Ставка группируется ПО ЗНАЧЕНИЮ: дубли одного ролика могли быть сняты на разных
    // тарифах (`FACT` SP-2b.7 — на Free ставка была 1.00, на Creator 0.55), и складывать их
    // одним `expectedBilled` значило бы посчитать половину дублей по чужой цене.
    const bucket = billedPerCall.get(chunk.rate) ?? [];
    bucket.push(chunk.billedUnits);
    billedPerCall.set(chunk.rate, bucket);
  }
  const billed =
    billedPerCall.size === 0
      ? null
      : [...billedPerCall.entries()].reduce(
          (sum, [rate, calls]) => sum + expectedBilled(calls, rate),
          0,
        );
  return { sent, billed, withoutRate, missing };
}

const cell = (value: string, width: number): string => value.padStart(width);

/**
 * Текст отчёта. Формат — таблица плюс две строки итога; читатель у него один — автор канала,
 * и вопрос у него один: «сколько это стоило и за что заплатила ЭТА сборка».
 */
export function formatVoiceReport(input: VoiceReportInput): string {
  const spend = voiceSpend(input.chunks);
  const reused = input.chunks.filter((chunk) => chunk.reused).length;
  const total = input.chunks.length;

  const keyWidth = Math.max(10, ...input.chunks.map((chunk) => chunk.chunkKey.length));
  const rows = input.chunks.map((chunk) => {
    const sent = chunk.billedUnits === null ? '—' : String(chunk.billedUnits);
    const rate = chunk.rate === null ? '—' : chunk.rate.toFixed(2);
    const billed =
      chunk.billedUnits === null || chunk.rate === null
        ? '—'
        : String(expectedBilled([chunk.billedUnits], chunk.rate));
    return (
      `  ${chunk.chunkKey.padEnd(keyWidth)} | ${cell(sent, 10)} | ${cell(rate, 6)} | ` +
      `${cell(billed, 8)} | ${chunk.reused ? 'дубль с диска' : 'снят этой сборкой'}`
    );
  });

  return [
    `ГОЛОС: чанков ${String(total)}, попаданий ${String(reused)}/${String(total)} ` +
      `(дубли с диска), обращений к источнику ${String(input.sourceCalls)}, ` +
      `межсборочный кэш ${String(input.cacheHits)}`,
    '',
    'РАСХОД ПО ДУБЛЯМ — из take-файлов, не из сети (ADR-0010 §2):',
    `  ${'чанк'.padEnd(keyWidth)} | ${cell('отправлено', 10)} | ${cell('ставка', 6)} | ` +
      `${cell('списано', 8)} | происхождение`,
    ...rows,
    `  ${'ИТОГО'.padEnd(keyWidth)} | ${cell(String(spend.sent), 10)} | ${cell('', 6)} | ` +
      `${cell(spend.billed === null ? '—' : String(spend.billed), 8)} |`,
    '',
    `отправлено (code points) ${String(spend.sent)}; списано ` +
      `${spend.billed === null ? '— (ставка не объявлена ни одним дублем)' : String(spend.billed)}` +
      `${spend.withoutRate === 0 ? '' : `, без объявленной ставки чанков: ${String(spend.withoutRate)}`}` +
      `${spend.missing === 0 ? '' : `, без дубля чанков: ${String(spend.missing)}`}`,
    'ЭТА СБОРКА отправила: ' +
      (input.sourceCalls === 0
        ? '0 code points — источник не звался ни разу, дубли взяты готовыми'
        : `${String(input.sourceCalls)} обращени(й) к источнику; «отправлено» выше — сумма по ` +
          'ВСЕМ дублям ролика, включая оплаченные прежде'),
    ...(input.staleTakes.length === 0
      ? []
      : [
          `дублей с чужим \`voiceKey\` (пересняты): ${String(input.staleTakes.length)} — ` +
            input.staleTakes.join(', '),
        ]),
    `дрейф краёв: ${input.edgeDrift ?? 'нет'}`,
    '',
    'ЧИСЛА — ИЗ TAKE-ФАЙЛОВ. «Отправлено» — code points `spokenText` (ADR-0010 §2); «списано» —',
    'сумма ПОКАЛЛЬНЫХ округлений `round(cp × ставка)` (`FACT` SP-2b.7), ставка берётся из',
    'провенанса дубля, а не из константы в коде. Сеть при составлении отчёта не звалась.',
  ].join('\n');
}
