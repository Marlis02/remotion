// Разбор аргументов `vpe` — БЕЗ браузера, без диска, без гейта.
//
// Что здесь проверяется: закрытые списки (две команды, два профиля), обязательность трёх
// входов гейта и то, что молчаливых умолчаний нет ни у одного из них.

import { describe, expect, it } from 'vitest';

import { CliError, EXIT, parseArgv } from '../src/index.js';

const GATE = [
  'template',
  'gate',
  'still@1',
  '--profile',
  'draftHalf',
  '--request',
  '/tmp/req.json',
  '--render-profile',
  '/tmp/render.draft.yaml',
] as const;

/** Отказ разбора: правило `argv` и код выхода 2 — «мы говорим на разных языках». */
function refusal(argv: readonly string[]): CliError {
  try {
    parseArgv(argv);
  } catch (error) {
    if (error instanceof CliError) return error;
    throw error;
  }
  throw new Error(`ожидался отказ на: ${argv.join(' ')}`);
}

describe('`vpe template gate` — разбор', () => {
  it('полная форма разбирается во все поля', () => {
    expect(parseArgv([...GATE, '--gates-dir', '/tmp/gates', '--run-root', '/tmp/runs'])).toEqual({
      command: 'template gate',
      template: 'still@1',
      profileId: 'draftHalf',
      requestPath: '/tmp/req.json',
      renderProfilePath: '/tmp/render.draft.yaml',
      gatesDir: '/tmp/gates',
      runRoot: '/tmp/runs',
    });
  });

  it('минимальная форма: два необязательных флага — `null`, а не выдуманный путь', () => {
    const parsed = parseArgv(GATE);
    expect(parsed.command).toBe('template gate');
    if (parsed.command !== 'template gate') return;
    expect(parsed.gatesDir).toBeNull();
    expect(parsed.runRoot).toBeNull();
  });

  it('`local:` разбирается как законное имя вызова (форк, ADR-0008)', () => {
    const parsed = parseArgv(['template', 'gate', 'local:kenburns@2', ...GATE.slice(3)]);
    expect(parsed.command === 'template gate' && parsed.template).toBe('local:kenburns@2');
  });

  it('каждый из трёх входов обязателен, и отказ говорит ЗАЧЕМ он нужен', () => {
    expect(refusal(['template', 'gate']).message).toMatch(/шаблон не назван/u);
    expect(
      refusal(['template', 'gate', 'still@1', '--request', '/tmp/r', '--render-profile', '/tmp/p']).message,
    ).toMatch(/N \(10 на `final`, 3 на `draftHalf`\)/u);
    expect(
      refusal(['template', 'gate', 'still@1', '--profile', 'final', '--render-profile', '/tmp/p']).message,
    ).toMatch(/ФИКСТУРЕ ШАБЛОНА/u);
    expect(
      refusal(['template', 'gate', 'still@1', '--profile', 'final', '--request', '/tmp/r']).message,
    ).toMatch(/ПОЛНЫМ `pixelProfile`/u);
  });

  it('**`--profile ac4` — отказ, и он объясняет, чем `ac4` является на самом деле**', () => {
    const error = refusal(['template', 'gate', 'still@1', '--profile', 'ac4', '--request', '/r', '--render-profile', '/p']);
    expect(error.exitCode).toBe(EXIT.input);
    expect(error.message).toMatch(/ПОЛНЫМ ПРОГОНОМ ФИКСТУРНОГО ПРОЕКТА/u);
    expect(error.message).toContain('final, draftHalf');
  });

  it('чужой профиль — отказ со списком тех двух, что есть', () => {
    expect(
      refusal(['template', 'gate', 'still@1', '--profile', 'draft', '--request', '/r', '--render-profile', '/p'])
        .message,
    ).toMatch(/не профиль гейта; их ровно два: final, draftHalf/u);
  });

  it('неизвестный флаг и флаг без значения — отказы, а не молчание', () => {
    expect(refusal(['template', 'gate', 'still@1', '--profil', 'final']).message).toMatch(
      /неизвестный флаг `--profil`/u,
    );
    // `--profile --request` — значение «съедено» следующим флагом: это ошибка ввода.
    expect(refusal(['template', 'gate', 'still@1', '--profile', '--request']).message).toMatch(
      /`--profile` требует значения/u,
    );
  });

  it('второй позиционный аргумент — отказ: гейт снимается с ОДНОГО шаблона за вызов', () => {
    expect(refusal([...GATE, 'flash@1']).message).toMatch(/лишний аргумент `flash@1`/u);
  });

  it('все отказы разбора несут код `2`, а не общий `1`', () => {
    for (const argv of [
      [],
      ['build'],
      ['template'],
      ['template', 'gates'],
      ['template', 'gate'],
      ['template', 'list', '--dir', '/tmp'],
    ]) {
      expect(refusal(argv).exitCode, argv.join(' ')).toBe(EXIT.input);
    }
  });
});

describe('`vpe template list` — разбор', () => {
  it('без флагов и с `--gates-dir`', () => {
    expect(parseArgv(['template', 'list'])).toEqual({ command: 'template list', gatesDir: null });
    expect(parseArgv(['template', 'list', '--gates-dir', '/tmp/g'])).toEqual({
      command: 'template list',
      gatesDir: '/tmp/g',
    });
  });
});
