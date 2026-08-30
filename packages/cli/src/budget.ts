// **СУММА `msPerFrameBudget` ПО ПЕРЕСЕКАЮЩИМСЯ КЛИПАМ — ОТЧЁТ, А НЕ ПАДЕНИЕ**
// (решение владельца 9, RM1; ADR-0008 «Бюджет AC2»).
//
// ЧТО ЗДЕСЬ ЕСТЬ. Чистая функция: клипы с окнами кадров и бюджетами → отрезки, на которых
// набор клипов постоянен, сумма бюджета на каждом и пик. Печать — форматтер ниже.
//
// ЧЕГО ЗДЕСЬ НЕТ И НЕ БУДЕТ ДО `E-05`. Падения. «Компилятор складывает `msPerFrameBudget`
// манифестов тех клипов, которые пересекаются по кадрам, и печатает сумму в отчёте сборки —
// БЕЗ падения. Порог 250 мс/кадр используется как ОТМЕТКА в отчёте, а не как условие
// остановки» (ADR-0008 дословно). Условие перехода названо и оно не «когда-нибудь»: после
// регистрации пятого эффекта (`E-05`).
//
// ПОЧЕМУ СУММА — ОЦЕНКА СВЕРХУ И ПОЧЕМУ ЭТО ВАЖНО НАПЕЧАТАТЬ. `FACT` (SP-3f §2): стеклянная
// карточка дала **+0.9 мс/кадр** при разбросе серии ±4.7 %, то есть цена слоёв НЕ АДДИТИВНА.
// Падение по такой сумме давало бы ложные срабатывания раньше, чем поймало бы настоящее
// превышение. Отчёт печатает величину и её природу — иначе первый же читатель примет оценку
// сверху за измерение.
//
// ФОРМА ОКНА — `{frameStart, frameEnd}`, ПОЛУИНТЕРВАЛ. ~~`{start, end}`; вторая форма у
// модели и компилятора — долг №168, нормализует её ВЫЗЫВАЮЩИЙ~~ *(изменено: `L-01`,
// 2026-08-30 — долг №168 закрыт стороной модели, решение владельца `H-04`.)* Нормализовать
// больше нечего: форма ровно одна во всём репозитории — `FrameInterval` модели
// (`core-model/src/time/interval.ts`), — и держать здесь третью значило бы завести тот же
// долг заново, только в `cli`. Конец исключается: клип `[0, 6)` и клип `[6, 12)` НЕ
// пересекаются, и это то же правило, по которому `where` раскладывает кадры по окнам.

/** Порог отметки в отчёте: 250 мс/кадр = «≥ 4 кадра/с» (ADR-0008 «Бюджет AC2»). */
export const BUDGET_THRESHOLD_MS = 250;

/** Клип с бюджетом: окно кадров плюс `msPerFrameBudget` манифеста его шаблона. */
export interface BudgetClip {
  readonly clipId: string;
  /** Каноническое имя вызова — оно печатается в таблице. */
  readonly template: string;
  /** Полуинтервал кадров `[frameStart, frameEnd)` — форма `FrameInterval` модели. */
  readonly frames: { readonly frameStart: number; readonly frameEnd: number };
  readonly msPerFrameBudget: number;
}

/** Отрезок кадров, на котором набор клипов постоянен. */
export interface BudgetSpan {
  readonly start: number;
  readonly end: number;
  /** Сумма `msPerFrameBudget` активных клипов. */
  readonly total: number;
  /** Активные клипы, в порядке подачи. */
  readonly clips: readonly BudgetClip[];
}

export interface BudgetReport {
  readonly spans: readonly BudgetSpan[];
  /** Отрезок с наибольшей суммой; `null` — клипов нет вовсе. */
  readonly peak: BudgetSpan | null;
  /**
   * Есть ли хоть одно ПЕРЕСЕЧЕНИЕ (отрезок с двумя и более клипами).
   *
   * `false` означает «суммы нет»: каждый кадр рисует не больше одного слоя, и складывать
   * нечего. Это не то же самое, что «сумма мала», и печатается отдельной строкой.
   */
  readonly hasOverlap: boolean;
}

/**
 * **Сумма бюджета по пересекающимся клипам.** Развёртка по границам окон: набор активных
 * клипов меняется только в точках `start`/`end`, поэтому между соседними границами сумма
 * постоянна и считается один раз.
 *
 * Пустые отрезки (ни одного активного клипа) в отчёт не попадают: «на кадрах 6–9 бюджет 0»
 * — строка, не несущая ничего.
 */
export function overlappingBudget(clips: readonly BudgetClip[]): BudgetReport {
  const usable = clips.filter((clip) => clip.frames.frameEnd > clip.frames.frameStart);
  if (usable.length === 0) return { spans: [], peak: null, hasOverlap: false };

  const edges = [
    ...new Set(usable.flatMap((clip) => [clip.frames.frameStart, clip.frames.frameEnd])),
  ].sort(
    (a, b) => a - b,
  );

  const spans: BudgetSpan[] = [];
  for (let i = 0; i + 1 < edges.length; i += 1) {
    const start = edges[i] ?? 0;
    const end = edges[i + 1] ?? 0;
    const active = usable.filter(
      (clip) => clip.frames.frameStart <= start && clip.frames.frameEnd >= end,
    );
    if (active.length === 0) continue;
    const total = active.reduce((sum, clip) => sum + clip.msPerFrameBudget, 0);
    const previous = spans[spans.length - 1];
    // Соседние отрезки с ОДНИМ И ТЕМ ЖЕ набором клипов склеиваются: граница, на которой
    // ничего не изменилось, — артефакт развёртки, а не факт режиссуры.
    if (
      previous !== undefined &&
      previous.end === start &&
      previous.clips.length === active.length &&
      previous.clips.every((clip, index) => clip === active[index])
    ) {
      spans[spans.length - 1] = { ...previous, end };
      continue;
    }
    spans.push({ start, end, total, clips: active });
  }

  const peak = spans.reduce<BudgetSpan | null>(
    (best, span) => (best === null || span.total > best.total ? span : best),
    null,
  );
  return { spans, peak, hasOverlap: spans.some((span) => span.clips.length > 1) };
}

/**
 * Печать отчёта бюджета: отрезки, суммы, отметка порога — и НИ ОДНОГО падения.
 *
 * Строка про оценку сверху печатается ВСЕГДА, а не только при превышении: читатель, увидевший
 * сумму один раз, запомнит её как измерение, если ему не сказать обратное в том же месте.
 */
export function formatBudgetReport(
  report: BudgetReport,
  threshold: number = BUDGET_THRESHOLD_MS,
): string {
  const lines: string[] = [];
  lines.push(`БЮДЖЕТ СЦЕНЫ: сумма \`msPerFrameBudget\` по пересекающимся клипам (порог ${String(threshold)} мс/кадр)`);

  if (report.spans.length === 0) {
    lines.push('  клипов с ненулевым окном нет — складывать нечего');
    return lines.join('\n');
  }

  lines.push('  кадры        | мс/кадр | клипы');
  for (const span of report.spans) {
    const mark = span.total > threshold ? ' ⚠' : '';
    const window = `${String(span.start)}–${String(span.end)}`;
    lines.push(
      `  ${window.padEnd(12, ' ')} | ${(String(span.total) + mark).padStart(7, ' ')} | ` +
        span.clips.map((clip) => `${clip.template} (${clip.clipId})`).join(' + '),
    );
  }

  if (!report.hasOverlap) {
    lines.push(
      '  ПЕРЕСЕЧЕНИЙ НЕТ: ни на одном кадре не рисуется больше одного клипа, то есть суммы ' +
        'по сцене не существует — печатаются бюджеты слоёв поодиночке',
    );
  }
  if (report.peak !== null) {
    lines.push(
      `  пик: ${String(report.peak.total)} мс/кадр на кадрах ${String(report.peak.start)}–` +
        `${String(report.peak.end)}` +
        (report.peak.total > threshold ? ` — ВЫШЕ порога ${String(threshold)}` : ''),
    );
  }
  lines.push(
    '  сумма — ОЦЕНКА СВЕРХУ и заведомо пессимистична: `FACT` (SP-3f §2) стеклянная карточка ' +
      'дала +0.9 мс/кадр при разбросе серии ±4.7 %, цена слоёв НЕ аддитивна',
  );
  lines.push(
    '  превышение порога НЕ роняет сборку (решение владельца 9, RM1); падение при компиляции ' +
      'включается после регистрации пятого эффекта (`E-05`)',
  );
  return lines.join('\n');
}
