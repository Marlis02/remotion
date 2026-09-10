// **`vpe asset add|list`** (`ASSET-01`) и **паспорт видео** (`VID-01`) — восемь охранников §3.
//
// ═══ ЧТО ЗДЕСЬ ОХРАНЯЕТСЯ И ПОЧЕМУ ИМЕННО ЭТО ═══
// Команда пишет в ЧЕТЫРЕ места сразу, три из которых — файлы в git (запись, alias,
// `store.lock`), а четвёртое — CAS, из которого ничего нельзя удалить (**K10**). Цена
// полу-выполненной операции здесь поэтому не «неудобно», а «в репозитории лежит алиас без
// записи» либо «в сторе байты, которых не называет ни один файл». Отсюда состав охранников:
// первые два — про ЦЕЛОСТНОСТЬ (атомарность, идемпотентность), третий-пятый — про ПРИБОР
// (детерминизм, поворот, VFR), шестой — про КОНТРАКТ компилятора, седьмой-восьмой — про то,
// что отказы называют причину, а не ворчат.
//
// ФАЙЛЫ — СИНТЕТИКА, СГЕНЕРИРОВАННАЯ ЗДЕСЬ ЖЕ. Ни одного файла владельца, ни одного из
// `fixtures/`: `work/in/demo.mp4` лежит вне git и на машине, где его нет, тест был бы красным
// ни от чего. Приём — тот же, что у `makePng` в `build-fixture.ts`.
//
// СТОР — ВРЕМЕННЫЙ, ПРОЕКТ — ВРЕМЕННЫЙ. `~/.vpe/store` владельца тесты не видят: `--store-dir`
// подаётся явно, а `resolveStorePath` (**P8**) отвергает путь внутри дерева проекта. Ни один
// тест этого файла физически не может записать ни в настоящий стор, ни в `fixtures/minimal`.
//
// БРАУЗЕР НЕ НУЖЕН НИ ОДНОМУ ТЕСТУ ФАЙЛА. ffmpeg/ffprobe нужны: предмет половины охранников —
// ИЗМЕРЕНИЕ, и подменять прибор его же ожидаемым ответом значило бы проверять тест тестом.
// Оба бинарника входят в отпечаток окружения проекта и берутся по абсолютному пути.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { normalizeRotation, pixFmtHasAlpha } from '@vpe/media';

import { EXIT, runCli, type CliDeps } from '../src/index.js';

import { cleanupRoots, makePng, makeProject, type TestProject } from './build-fixture.js';

/** Приборы — по абсолютному пути: они в отпечатке окружения, а не «что найдётся в PATH». */
const FFMPEG = '/usr/local/bin/ffmpeg';
const FFPROBE = '/usr/local/bin/ffprobe';

afterAll(() => {
  cleanupRoots();
});

interface Run {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

async function run(argv: readonly string[]): Promise<Run> {
  let out = '';
  let err = '';
  const deps: CliDeps = {
    // Часы ФИКСИРОВАНЫ: `retrievedAt` — единственное поле записи, приходящее не из файла, и
    // подвижное значение здесь сделало бы «две записи равны» вопросом скорости прогона.
    now: () => '2026-09-10T15:00:00.000Z',
    clock: () => 0,
    randomBytes: (byteLength: number) => new Uint8Array(byteLength),
    stdin: () => '',
    env: {},
    out: (text) => (out += text),
    err: (text) => (err += text),
  };
  return { code: await runCli(argv, deps), out, err };
}

/** Синтетическое видео: `testsrc2`, CFR, столько кадров, сколько попросили. */
function makeVideo(file: string, extra: readonly string[] = [], frames = 12, fps = 12): string {
  execFileSync(FFMPEG, [
    '-v', 'error', '-y',
    ...extra,
    '-f', 'lavfi',
    '-i', `testsrc2=size=64x48:rate=${String(fps)}:duration=${String(frames / fps)}`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-fps_mode', 'cfr',
    file,
  ]);
  return file;
}

/** JPEG — тем же прибором, что и видео: второго генератора картинок в тестах не заводится. */
function makeJpeg(file: string): string {
  execFileSync(FFMPEG, [
    '-v', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=64x48:rate=1:duration=1',
    '-frames:v', '1', file,
  ]);
  return file;
}

/** Снимок каталога: относительный путь → sha256 содержимого. Основа сравнения «до/после». */
function snapshot(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (current: string): void => {
    for (const name of readdirSync(current).sort()) {
      const full = path.join(current, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      out.set(path.relative(dir, full), createHash('sha256').update(readFileSync(full)).digest('hex'));
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

interface Bench {
  readonly project: TestProject;
  readonly media: string;
  readonly png: string;
  readonly jpeg: string;
  readonly mp4: string;
}

/** Проект-копия фикстуры, временный стор и три синтетических файла рядом. */
function bench(): Bench {
  const project = makeProject();
  const media = path.join(project.root, 'media');
  mkdirSync(media, { recursive: true });
  const png = path.join(media, 'square.png');
  writeFileSync(png, makePng(8));
  return {
    project,
    media,
    png,
    jpeg: makeJpeg(path.join(media, 'still.jpg')),
    mp4: makeVideo(path.join(media, 'clip.mp4')),
  };
}

/** Полный набор аргументов `add` — тесты меняют в нём одно поле за раз. */
function addArgv(b: Bench, file: string, alias: string, extra: readonly string[] = []): string[] {
  return [
    'asset', 'add', file,
    '--project', b.project.projectDir,
    '--alias', alias,
    '--note', 'синтетика охранника',
    '--rights', 'own',
    '--store-dir', b.project.storeDir,
    '--ffprobe', FFPROBE,
    ...extra,
  ];
}

describe('§3.1 атомарность: отказ на алиасе не оставляет следа ни в одном из четырёх мест', () => {
  it('alias занят другим sha ⇒ стор, records/, aliases.yaml и store.lock БАЙТ В БАЙТ те же', async () => {
    const b = bench();
    // Первый файл занимает alias `probe`. Второй — ДРУГИЕ байты под тем же именем.
    expect((await run(addArgv(b, b.png, 'probe'))).code).toBe(EXIT.pass);

    const storeBefore = snapshot(b.project.storeDir);
    const projectBefore = snapshot(b.project.projectDir);

    const refused = await run(addArgv(b, b.jpeg, 'probe'));
    expect(refused.code).toBe(EXIT.refusal);
    expect(refused.err).toContain('уже занят');

    // ЧЕТЫРЕ МЕСТА ОДНИМ СРАВНЕНИЕМ: снимок проекта несёт и `assets/records/*`, и
    // `assets/aliases.yaml`, и `store.lock`. Сравнение по содержимому, а не по mtime:
    // «файл переписан тем же текстом» — это тоже запись, и она тоже запрещена.
    expect(snapshot(b.project.storeDir)).toEqual(storeBefore);
    expect(snapshot(b.project.projectDir)).toEqual(projectBefore);
  });

  it('отказ прибора (VFR) — тоже ни одной записи: проверки стоят раньше `store.put`', async () => {
    const b = bench();
    const storeBefore = snapshot(b.project.storeDir);
    const projectBefore = snapshot(b.project.projectDir);

    const vfr = path.join(b.media, 'vfr.mp4');
    execFileSync(FFMPEG, [
      '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=64x48:rate=12:duration=1',
      '-vf', "setpts='if(lt(N,4),PTS,PTS*1.7)'", '-fps_mode', 'vfr',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', vfr,
    ]);

    const refused = await run(addArgv(b, vfr, 'wobbly'));
    expect(refused.code).toBe(EXIT.refusal);
    expect(snapshot(b.project.storeDir)).toEqual(storeBefore);
    expect(snapshot(b.project.projectDir)).toEqual(projectBefore);
  });
});

describe('§3.2 идемпотентность', () => {
  it('тот же файл дважды ⇒ «уже есть» и НИ ОДНОГО нового байта', async () => {
    const b = bench();
    expect((await run(addArgv(b, b.mp4, 'clip'))).code).toBe(EXIT.pass);

    const storeAfterFirst = snapshot(b.project.storeDir);
    const projectAfterFirst = snapshot(b.project.projectDir);

    const second = await run(addArgv(b, b.mp4, 'clip'));
    expect(second.code).toBe(EXIT.pass);
    expect(second.out).toContain('в сторе:    уже был');
    expect(second.out).toContain('запись:     уже есть');
    expect(second.out).toContain('alias:      уже есть');

    // ЭТО СРАВНЕНИЕ ОДНАЖДЫ УПАЛО, И ЭТО БЫЛА НАСТОЯЩАЯ ОШИБКА (`ASSET-01`, живая проверка):
    // `retrievedAt` брался из часов на каждом прогоне, поэтому вторая запись расходилась с
    // первой одним полем при равной длине. Лечение — не ослабить сравнение, а не обновлять
    // момент: «когда байты попали в проект» у одних байтов ОДИН.
    expect(snapshot(b.project.storeDir)).toEqual(storeAfterFirst);
    expect(snapshot(b.project.projectDir)).toEqual(projectAfterFirst);
  });

  it('тот же файл под ДРУГИМ alias ⇒ вторая строка алиаса, запись по-прежнему одна', async () => {
    const b = bench();
    await run(addArgv(b, b.mp4, 'clip'));
    const recordsBefore = readdirSync(path.join(b.project.projectDir, 'assets/records')).length;

    const again = await run(addArgv(b, b.mp4, 'clip-second'));
    expect(again.code).toBe(EXIT.pass);
    expect(again.out).toContain('запись:     уже есть');
    expect(again.out).toContain('alias:      дописан');

    expect(readdirSync(path.join(b.project.projectDir, 'assets/records')).length).toBe(recordsBefore);
    const listed = await run(['asset', 'list', '--project', b.project.projectDir]);
    expect(listed.out).toContain('clip ·');
    expect(listed.out).toContain('clip-second ·');
  });

  it('дописка алиаса СОХРАНЯЕТ комментарии файла — иначе терялся бы текст владельца', async () => {
    const b = bench();
    const aliasesFile = path.join(b.project.projectDir, 'assets/aliases.yaml');
    const marker = '# комментарий владельца, который нельзя потерять';
    writeFileSync(aliasesFile, `${readFileSync(aliasesFile, 'utf8')}${marker}\n`, 'utf8');

    expect((await run(addArgv(b, b.png, 'kept'))).code).toBe(EXIT.pass);
    expect(readFileSync(aliasesFile, 'utf8')).toContain(marker);
  });
});

describe('§3.3 детерминизм и правдивость паспорта', () => {
  it('два прогона измерения дают побайтово равный JSON записи', async () => {
    const b = bench();
    expect((await run(addArgv(b, b.mp4, 'clip'))).code).toBe(EXIT.pass);
    const recordsDir = path.join(b.project.projectDir, 'assets/records');
    const name = readdirSync(recordsDir).find((n) => n.startsWith(sha256Of(b.mp4).slice(0, 8)));
    const first = readFileSync(path.join(recordsDir, String(name)), 'utf8');

    // Второй проект, тот же файл — запись обязана совпасть посимвольно.
    const c = bench();
    expect((await run(addArgv(c, b.mp4, 'clip'))).code).toBe(EXIT.pass);
    const second = readFileSync(
      path.join(c.project.projectDir, 'assets/records', String(name)),
      'utf8',
    );
    expect(second).toBe(first);
  });

  it('`frames` посчитан ДЕКОДОМ и равен тому, что даёт второй способ (`ffmpeg -f null`)', async () => {
    const b = bench();
    await run(addArgv(b, b.mp4, 'clip'));
    const record = JSON.parse(
      readFileSync(path.join(b.project.projectDir, 'assets/records', `${sha256Of(b.mp4)}.json`), 'utf8'),
    ) as { intrinsic: { frames: number } };

    // ═══ ВТОРОЙ СПОСОБ — ДРУГОЙ БИНАРНИК И ДРУГОЙ ПУТЬ КОДА ═══
    // Не `ffprobe` с другими флагами: это был бы ТОТ ЖЕ ПРИБОР, которым мерит команда, то
    // есть проверка теста тестом. Здесь `ffmpeg` декодирует файл целиком в `null`-мукс и
    // печатает итог строкой `frame= N` в stderr. Совпадение двух НЕЗАВИСИМЫХ измерений и
    // есть утверждение «кадров столько», а не «прибор сказал».
    const decoded = spawnSync(FFMPEG, ['-hide_banner', '-i', b.mp4, '-f', 'null', '-'], {
      encoding: 'utf8',
    });
    const reported = /frame=\s*(\d+)/gu;
    let last: RegExpExecArray | null = null;
    for (let m = reported.exec(decoded.stderr); m !== null; m = reported.exec(decoded.stderr)) last = m;
    if (last === null) throw new Error(`\`ffmpeg -f null\` не напечатал \`frame=\`:\n${decoded.stderr}`);

    expect(record.intrinsic.frames).toBe(Number(last[1]));
    expect(record.intrinsic.frames).toBe(12);
  });

  it('`hasAlpha` из `pix_fmt` согласен со ВТОРЫМ способом — декодом через `alphaextract`', () => {
    // Три файла, покрывающие обе стороны и находку №256: альфа есть, альфа объявлена и
    // потеряна (`libvpx-vp9`), альфы нет вовсе.
    const b = bench();
    const withAlpha = path.join(b.media, 'alpha.mov');
    execFileSync(FFMPEG, [
      '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=64x48:rate=12:duration=1',
      '-vf', 'format=yuva420p', '-c:v', 'prores_ks', '-profile:v', '4444',
      '-pix_fmt', 'yuva444p10le', withAlpha,
    ]);

    const decodes = (file: string): boolean => {
      try {
        execFileSync(FFMPEG, ['-v', 'error', '-i', file, '-vf', 'alphaextract', '-frames:v', '1', '-f', 'null', '-'], {
          stdio: ['ignore', 'pipe', 'pipe'],
          encoding: 'utf8',
        });
        return true;
      } catch {
        return false;
      }
    };
    const pixFmtOf = (file: string): string =>
      execFileSync(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=pix_fmt', '-of', 'csv=p=0', file], {
        encoding: 'utf8',
      }).trim();

    for (const file of [withAlpha, b.mp4]) {
      // `alphaextract` при отсутствии плоскостей пишет в stderr и НЕ ставит ненулевой код —
      // измерено; поэтому вторым способом служит наличие вывода, а не код возврата.
      const byPixFmt = pixFmtHasAlpha(pixFmtOf(file));
      const byDecode = decodes(file) && byPixFmt;
      expect(byPixFmt).toBe(byDecode);
    }
    expect(pixFmtHasAlpha(pixFmtOf(withAlpha))).toBe(true);
    expect(pixFmtHasAlpha(pixFmtOf(b.mp4))).toBe(false);

    // Находка `SP-VID` A4 (долг №256) — прямо здесь, а не в чужом отчёте: vp9 объявленную
    // альфу теряет, и `pix_fmt` ГОТОВОГО файла об этом честно говорит.
    const vp9 = path.join(b.media, 'alpha.webm');
    execFileSync(FFMPEG, [
      '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=64x48:rate=12:duration=1',
      '-vf', 'format=yuva420p', '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', vp9,
    ]);
    expect(pixFmtOf(vp9)).toBe('yuv420p');
    expect(pixFmtHasAlpha(pixFmtOf(vp9))).toBe(false);
  });
});

describe('§3.4 поворот: отображаемая геометрия, а не геометрия потока', () => {
  it('mp4 с `rotation: 90` в side-data ⇒ стороны поменялись местами, `rotation: 90`', async () => {
    const b = bench();
    // `-display_rotation` — ВХОДНОЙ флаг. `-metadata:s:v rotate=90` в ffmpeg 7.0.2 не пишет
    // ничего (измерено `ASSET-01`), и тест на нём был бы зелёным про файл без поворота.
    const turned = path.join(b.media, 'turned.mp4');
    execFileSync(FFMPEG, ['-v', 'error', '-y', '-display_rotation', '90', '-i', b.mp4, '-c', 'copy', turned]);

    expect((await run(addArgv(b, turned, 'turned'))).code).toBe(EXIT.pass);
    const record = JSON.parse(
      readFileSync(path.join(b.project.projectDir, 'assets/records', `${sha256Of(turned)}.json`), 'utf8'),
    ) as { intrinsic: { width: number; height: number; rotation: number } };

    // Исходник — 64×48 горизонтальный. Отображается он вертикальным.
    expect(record.intrinsic.width).toBe(48);
    expect(record.intrinsic.height).toBe(64);
    expect(record.intrinsic.rotation).toBe(90);
  });

  it('`-90` телефона и `270` — один поворот: приведение по модулю 360', () => {
    expect(normalizeRotation(-90, 'f')).toBe(270);
    expect(normalizeRotation(270, 'f')).toBe(270);
    expect(normalizeRotation(-180, 'f')).toBe(180);
    expect(normalizeRotation(360, 'f')).toBe(0);
    // Не кратный 90 — отказ: такая геометрия не выражается парой `width`/`height`.
    expect(() => normalizeRotation(37, 'f')).toThrow(/не кратен 90/u);
  });
});

describe('§3.5 VFR — отказ, CFR — принят', () => {
  it('переменная частота отвергается с ОБЕИМИ дробями и лечением в тексте', async () => {
    const b = bench();
    const vfr = path.join(b.media, 'vfr.mp4');
    execFileSync(FFMPEG, [
      '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=64x48:rate=12:duration=1',
      '-vf', "setpts='if(lt(N,4),PTS,PTS*1.7)'", '-fps_mode', 'vfr',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', vfr,
    ]);

    const refused = await run(addArgv(b, vfr, 'wobbly'));
    expect(refused.code).toBe(EXIT.refusal);
    expect(refused.err).toContain('r_frame_rate');
    expect(refused.err).toContain('avg_frame_rate');
    expect(refused.err).toContain('-fps_mode cfr');
  });

  it('CFR принят, `fps` записан рациональной дробью', async () => {
    const b = bench();
    expect((await run(addArgv(b, b.mp4, 'clip'))).code).toBe(EXIT.pass);
    const record = JSON.parse(
      readFileSync(path.join(b.project.projectDir, 'assets/records', `${sha256Of(b.mp4)}.json`), 'utf8'),
    ) as { intrinsic: { fps: { num: number; den: number } } };
    expect(record.intrinsic.fps).toEqual({ num: 12, den: 1 });
  });
});

describe('§3.7 права', () => {
  it('без `--rights` — отказ со списком принятых у нас значений', async () => {
    const b = bench();
    const argv = addArgv(b, b.png, 'nope').filter((a, i, all) => a !== '--rights' && all[i - 1] !== '--rights');
    const refused = await run(argv);
    expect(refused.code).toBe(EXIT.input);
    expect(refused.err).toContain('`own`');
    expect(refused.err).toContain('`public-domain`');
    // ПОДСКАЗКА, А НЕ ENUM: текст обязан сказать это вслух, иначе следующая сессия сузит схему.
    expect(refused.err).toContain('ПОДСКАЗКА');
  });

  it('`all-rights-reserved` ПРИНЯТ и печатает предупреждение с адресом №210', async () => {
    const b = bench();
    const argv = addArgv(b, b.png, 'restricted').map((a, i, all) =>
      all[i - 1] === '--rights' ? 'all-rights-reserved' : a,
    );
    const accepted = await run(argv);
    expect(accepted.code).toBe(EXIT.pass);
    expect(accepted.out).toContain('ПРЕДУПРЕЖДЕНИЕ');
    expect(accepted.out).toContain('№210');
  });

  it('`--note` обязателен: без него ассет стал бы дырой в задании для ИИ', async () => {
    const b = bench();
    const argv = addArgv(b, b.png, 'mute').filter((a, i, all) => a !== '--note' && all[i - 1] !== '--note');
    const refused = await run(argv);
    expect(refused.code).toBe(EXIT.input);
    expect(refused.err).toContain('ai-scenarist');
  });
});

describe('§3.8 форматы: «не опознан» ≠ «не поддержан» ≠ «пока не принимаем»', () => {
  it('случайные байты — отказ с ПЕРВЫМИ БАЙТАМИ в тексте', async () => {
    const b = bench();
    const junk = path.join(b.media, 'junk.bin');
    writeFileSync(junk, Buffer.from([0xde, 0xad, 0xbe, 0xef, 0x00, 0x11, 0x22, 0x33]));
    const refused = await run(addArgv(b, junk, 'junk'));
    expect(refused.code).toBe(EXIT.refusal);
    expect(refused.err).toContain('de ad be ef');
    expect(refused.err).toContain('не опознан');
  });

  it('`.gif` — отказ «не поддержан», а не «незнаком»', async () => {
    const b = bench();
    const gif = path.join(b.media, 'anim.gif');
    // Заголовок GIF87a достаточен: вид определяется первыми байтами, и до разбора кадров
    // команда не доходит — она отказывает раньше прибора.
    writeFileSync(gif, Buffer.concat([Buffer.from('GIF87a', 'ascii'), Buffer.alloc(32)]));
    const refused = await run(addArgv(b, gif, 'anim'));
    expect(refused.code).toBe(EXIT.refusal);
    expect(refused.err).toContain('GIF87a');
    expect(refused.err).toContain('не поддерживает');
    expect(refused.err).not.toContain('не опознан');
  });

  it('шрифт — отказ «пока только картинки и видео» с адресом долга', async () => {
    const b = bench();
    const ttf = path.join(b.media, 'font.ttf');
    writeFileSync(ttf, Buffer.concat([Buffer.from([0x00, 0x01, 0x00, 0x00]), Buffer.alloc(32)]));
    const refused = await run(addArgv(b, ttf, 'font'));
    expect(refused.code).toBe(EXIT.refusal);
    expect(refused.err).toContain('шрифт');
    expect(refused.err).toContain('№261');
  });
});

/** sha256 файла — тем же алгоритмом, каким адресует CAS. */
function sha256Of(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}
