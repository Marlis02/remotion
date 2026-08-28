// Сумма `msPerFrameBudget` по ПЕРЕСЕКАЮЩИМСЯ клипам — чистая функция для отчёта сборки
// (решение владельца 9, RM1; вызывающий — `vpe build`, `L-01`).
//
// Главный тест здесь — НЕ «сумма считается», а «непересекающиеся клипы суммы не дают»:
// сложить бюджеты слоёв, которые никогда не рисуются одновременно, значит получить число,
// которого в ролике не бывает ни на одном кадре.

import { describe, expect, it } from 'vitest';

import { BUDGET_THRESHOLD_MS, formatBudgetReport, overlappingBudget, type BudgetClip } from '../src/index.js';

const clip = (clipId: string, start: number, end: number, msPerFrameBudget: number): BudgetClip => ({
  clipId,
  template: `${clipId}@1`,
  frames: { start, end },
  msPerFrameBudget,
});

describe('сумма бюджета по пересекающимся клипам', () => {
  it('два клипа с общим окном: на пересечении сумма, по краям — поодиночке', () => {
    const report = overlappingBudget([clip('bg', 0, 12, 14), clip('card', 6, 18, 37)]);
    expect(report.spans.map((span) => [span.start, span.end, span.total])).toEqual([
      [0, 6, 14],
      [6, 12, 51],
      [12, 18, 37],
    ]);
    expect(report.peak?.total).toBe(51);
    expect(report.hasOverlap).toBe(true);
  });

  it('**непересекающиеся клипы — СУММЫ НЕТ**, и это печатается словами', () => {
    const report = overlappingBudget([clip('a', 0, 10, 100), clip('b', 10, 20, 200)]);
    expect(report.hasOverlap).toBe(false);
    // Каждый отрезок — один клип; пик равен наибольшему БЮДЖЕТУ, а не сумме двух.
    expect(report.spans.every((span) => span.clips.length === 1)).toBe(true);
    expect(report.peak?.total).toBe(200);
    expect(formatBudgetReport(report)).toMatch(/ПЕРЕСЕЧЕНИЙ НЕТ/u);
  });

  it('смежные окна `[0,6)` и `[6,12)` не пересекаются: конец исключается', () => {
    expect(overlappingBudget([clip('a', 0, 6, 10), clip('b', 6, 12, 10)]).hasOverlap).toBe(false);
    expect(overlappingBudget([clip('a', 0, 7, 10), clip('b', 6, 12, 10)]).hasOverlap).toBe(true);
  });

  it('три слоя на одном окне складываются целиком; пустое окно клипа игнорируется', () => {
    const report = overlappingBudget([
      clip('shader', 0, 90, 14),
      clip('particles', 0, 90, 37),
      clip('glass', 0, 90, 1),
      clip('пустой', 30, 30, 999),
    ]);
    expect(report.spans).toHaveLength(1);
    expect(report.peak?.total).toBe(52);
    expect(report.peak?.clips.map((c) => c.clipId)).toEqual(['shader', 'particles', 'glass']);
  });

  it('клипов нет — отчёт пуст и не притворяется нулём', () => {
    const report = overlappingBudget([]);
    expect(report).toEqual({ spans: [], peak: null, hasOverlap: false });
    expect(formatBudgetReport(report)).toMatch(/складывать нечего/u);
  });

  it('порог 250 — ОТМЕТКА: превышение печатается и НЕ роняет ничего', () => {
    const report = overlappingBudget([clip('a', 0, 10, 200), clip('b', 0, 10, 100)]);
    expect(BUDGET_THRESHOLD_MS).toBe(250);
    const text = formatBudgetReport(report);
    expect(text).toMatch(/⚠/u);
    expect(text).toMatch(/ВЫШЕ порога 250/u);
    expect(text).toMatch(/НЕ роняет сборку/u);
    expect(text).toMatch(/после регистрации пятого эффекта \(`E-05`\)/u);
    // Функция ВОЗВРАЩАЕТ отчёт и на превышении: падения нет ни в каком виде.
    expect(report.peak?.total).toBe(300);
  });

  it('оговорка «оценка сверху» печатается ВСЕГДА, а не только при превышении', () => {
    expect(formatBudgetReport(overlappingBudget([clip('a', 0, 10, 1)]))).toMatch(/ОЦЕНКА СВЕРХУ/u);
  });
});
