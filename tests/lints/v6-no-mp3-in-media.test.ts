// **V6** (половина) — в `packages/media/src/**` нет mp3-энкодеров и mp3-декодеров.
//
// ЧЕСТНО О ГРАНИЦАХ ЭТОГО ОХРАННИКА. Правило реестра звучит «внутри пайплайна нет mp3 ни на
// одном шаге», а охранником назван «тест: ни один промежуточный артефакт не имеет
// mp3-контейнера». Артефакты, кроме тех, что производит и потребляет сам PCM-тракт, ещё не
// существуют: пакет `voice` пуст (`V-01`), мукса нет (`M-04`), кэша нет (`M-05`). Поэтому
// охранник разделён на две половины, и обе названы вслух:
//
//   * ВОЗМОЖНОСТЬ — здесь: пока ни один файл `media/src/**` не зовёт mp3-кодек и не пишет
//     mp3-расширение, mp3 не может появиться в пайплайне ни по ошибке, ни «на время». Греп
//     краснеет в тот день, когда кто-нибудь добавит `-f mp3` или `libmp3lame`;
//   * ПОВЕДЕНИЕ — в `packages/media/test/audio-{v6,wav,resample}.test.ts`: байты mp3
//     отвергаются на входе тракта, mp3 внутри RIFF (`audioFormat` 0x0055) отвергается
//     отдельно, и охранник стоит на обеих границах — на чтении и на записи.
//
// Строка V6 реестра остаётся `named`: половина «ни на одном шаге» покрыта настолько,
// насколько существуют шаги, и натягивать это до `guarded` не за что.

import { describe, expect, it } from 'vitest';

import { codeLines, readSource, sourceFiles } from '../boundaries/repo';

/** Единственный файл, которому разрешено знать про mp3, — детектор V6. */
const EXEMPT = 'packages/media/src/audio/v6.ts';

/** Сосед по каталогу: он обязан остаться ПОД правилом, иначе исключение не узкое. */
const NEIGHBOUR = 'packages/media/src/audio/wav.ts';

/**
 * Кодеки, библиотеки и формы вызова, которыми mp3 попадает в пайплайн. Расширение файла и
 * MIME-имя — в том же списке: артефакт с именем `*.mp3` есть нарушение независимо от того,
 * чем он получен.
 */
const MP3 = /(libmp3lame|lamejs|node-lame|libmad|\bmadplay\b|mpg123|twolame|shine\b|audio\/mpeg|\.mp3\b|-f\s+mp3|codec[^\n]*\bmp3\b)/i;

/** Границы, на которых охранник обязан стоять вызовом, а не намерением. */
const CALL_SITES = [
  'packages/media/src/audio/wav.ts',
  'packages/media/src/audio/resample.ts',
];

function mediaSources(): string[] {
  return sourceFiles('media');
}

function offendingLines(relPath: string): { number: number; text: string }[] {
  const out: { number: number; text: string }[] = [];
  for (const [index, line] of codeLines(readSource(relPath)).entries()) {
    if (MP3.test(line)) out.push({ number: index + 1, text: line.trim() });
  }
  return out;
}

describe('**V6** — mp3 не может появиться в `media/src/**`', () => {
  it('охранник стережёт непустое множество файлов, и файл-исключение в нём есть', () => {
    const files = mediaSources();
    expect(files.length).toBeGreaterThan(0);
    expect(files).toContain(EXEMPT);
    expect(files).toContain(NEIGHBOUR);
  });

  it('ни один файл `media/src/**`, кроме детектора V6, не упоминает mp3-кодек', () => {
    const offenders: string[] = [];
    for (const file of mediaSources()) {
      if (file === EXEMPT) continue;
      for (const line of offendingLines(file)) offenders.push(`${file}:${String(line.number)} — ${line.text}`);
    }
    expect(
      offenders,
      'V6 (ADR-0010 §9): внутри пайплайна нет mp3 ни на одном шаге — речь запрашивается в ' +
        '`pcm_*`, музыка приводится к `projectSampleRate` на ingest, финал кодируется один ' +
        'раз при муксе (`aac`). Найдено: ' + offenders.join('; '),
    ).toEqual([]);
  });

  it('исключение НЕ мёртвое: детектор обязан содержать запрещённую форму', () => {
    // Если из `v6.ts` исчезнут имена форматов, предыдущая проверка начнёт охранять пустоту.
    expect(offendingLines(EXEMPT).length).toBeGreaterThan(0);
  });

  it('исключение УЗКОЕ: сосед по каталогу остаётся под правилом', () => {
    expect(offendingLines(NEIGHBOUR)).toEqual([]);
  });

  it('охранник стоит вызовом на обеих границах тракта, а не намерением', () => {
    for (const file of CALL_SITES) {
      const source = codeLines(readSource(file)).join('\n');
      expect(source, `${file}: пропал вызов \`assertNotMp3\` — граница тракта перестала проверяться`).toContain(
        'assertNotMp3',
      );
    }
    // Чтение и запись — два РАЗНЫХ вызова: снятие одного из них не должно проходить молча.
    const wav = codeLines(readSource('packages/media/src/audio/wav.ts')).join('\n');
    expect(wav.match(/assertNotMp3\(/g) ?? []).toHaveLength(2);
  });
});
