// Проверка запроса: ФОРМА и СОГЛАСОВАННОСТЬ. Больше здесь не проверяется ничего.
//
// ГРАНИЦА ОТВЕТСТВЕННОСТИ, ЗАПИСАННАЯ ЯВНО. `params` шаблонов уже прогнаны через
// `paramsSchema` компилятором (`CP-07`, стадия `compile/src/timeline/contract.ts`), ассеты уже
// разрешены из alias'ов в sha, seed'ы уже материализованы. Повторная валидация здесь была бы
// вторым местом, где живёт контракт шаблона, и первая же правка спека развела бы их. Адаптер
// считает вход ВАЛИДНЫМ и проверяет ровно две вещи: (1) форму того, что читает сам,
// (2) согласованность запроса с самим собой.
//
// ПОЧЕМУ БЕЗ `zod`. Карта ADR-0009 называет внешние зависимости этого пакета поимённо —
// `hyperframes`, `gsap`. `zod` там не назван, и добавление его было бы правкой карты того же
// класса, что стрелка `→ media`, отклонённая владельцем в поправке A. Ручная проверка при этом
// не хуже: список проблем с адресами — ровно то, что zod пришлось бы переводить в `RenderProblem`.
//
// R3 ЗДЕСЬ ИСПОЛНЯЕТСЯ НА БАЙТАХ, А НЕ НА ИМЕНАХ. Правило «адаптер не открывает файлов вне
// `assets`/`fonts` запроса» защищает от подмены содержимого ровно настолько, насколько
// проверено, что по `path` лежит именно тот блоб, чей `sha256` назван. Поэтому
// `assertRequestFiles` читает каждый файл и считает его sha256 — это единственное место, где
// адаптер вообще открывает файлы проекта, и список открытого равен списку запроса по построению.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import type {
  RenderProblem,
  RequestAsset,
  RequestFont,
  SegmentRenderRequest,
} from './contract.js';
import { RenderAdapterError } from './errors.js';

/** 64 строчных hex — форма sha256 (та же, что в `@vpe/schema/types/brands.ts`). */
const SHA256_RE = /^[0-9a-f]{64}$/u;

/** Кадровые форматы, которые умеет отдать `--format png-sequence`. Ровно один. */
const RENDERER_IMAGE_FORMATS = new Set(['png']);

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Лежит ли `child` ВНУТРИ `parent` (не равен ему и не «рядом по префиксу имени»).
 *
 * Сравнение через `path.relative`, а не `startsWith`: `/tmp/seg-2` начинается с `/tmp/seg`,
 * и строковый префикс сказал бы «внутри». Ровно этот класс ошибки закрывает **R2**.
 */
export function isInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel !== '' && !rel.startsWith('..' + sep) && rel !== '..' && !isAbsolute(rel);
}

/** Копилка проблем: один вызов — одна строка отчёта. */
class Problems {
  readonly list: RenderProblem[] = [];

  add(rule: string, at: string, message: string): void {
    this.list.push({ rule, at, message });
  }

  /** Проверка «поле есть и это строка»; возвращает значение либо `null`, если формы нет. */
  str(value: unknown, at: string): string | null {
    if (typeof value === 'string' && value !== '') return value;
    this.add('ADR-0008 форма', at, `ожидалась непустая строка, пришло ${describe(value)}`);
    return null;
  }

  num(value: unknown, at: string): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    this.add('ADR-0008 форма', at, `ожидалось конечное число, пришло ${describe(value)}`);
    return null;
  }

  int(value: unknown, at: string, min: number): number | null {
    const n = this.num(value, at);
    if (n === null) return null;
    if (!Number.isInteger(n) || n < min) {
      this.add('ADR-0008 форма', at, `ожидалось целое ≥ ${String(min)}, пришло ${String(n)}`);
      return null;
    }
    return n;
  }

  bool(value: unknown, at: string): boolean | null {
    if (typeof value === 'boolean') return value;
    this.add('ADR-0008 форма', at, `ожидался boolean, пришло ${describe(value)}`);
    return null;
  }

  sha(value: unknown, at: string): string | null {
    const s = this.str(value, at);
    if (s === null) return null;
    if (!SHA256_RE.test(s)) {
      this.add('ADR-0008 форма', at, `не форма sha256 (64 строчных hex): \`${s}\``);
      return null;
    }
    return s;
  }

  abs(value: unknown, at: string): string | null {
    const s = this.str(value, at);
    if (s === null) return null;
    if (!isAbsolute(s)) {
      this.add(
        'ADR-0008 форма',
        at,
        `путь обязан быть АБСОЛЮТНЫМ: \`${s}\`. Относительный путь означал бы, что смысл ` +
          'запроса зависит от рабочего каталога подпроцесса, а он не входит в контракт',
      );
      return null;
    }
    return s;
  }
}

function describe(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'массив';
  if (v instanceof Map) return '`Map` (запрещён: не переживает JSON round-trip, **R4**)';
  if (v instanceof Set) return '`Set` (запрещён: не переживает JSON round-trip, **R4**)';
  return typeof v;
}

/** Список файлов, попавших в запрос: пара (sha, путь) и место, где она объявлена. */
export interface RequestFile {
  readonly sha256: string;
  readonly path: string;
  readonly at: string;
}

/**
 * Проверяет форму и согласованность запроса. Файлов НЕ открывает.
 *
 * Разделение с `assertRequestFiles` не косметическое: форму можно проверить у запроса,
 * пришедшего откуда угодно (тест, кэш, чужая сборка), не трогая диск, — а R3 говорит именно
 * про ОТКРЫТИЕ файлов, и его проверка обязана быть отдельным, наблюдаемым шагом.
 *
 * @throws {RenderAdapterError} со списком ВСЕХ найденных проблем.
 */
export function validateRequest(input: unknown): SegmentRenderRequest {
  const p = new Problems();

  if (!isObject(input)) {
    throw new RenderAdapterError(
      'ADR-0008 форма',
      `запрос обязан быть объектом, пришло ${describe(input)}`,
    );
  }

  if (input['requestVersion'] !== 1) {
    p.add(
      'ADR-0008 форма',
      'requestVersion',
      `контракт знает единственную версию \`1\`, пришло ${describe(input['requestVersion'])}. ` +
        'Версия — не украшение: она отделяет «поле забыли» от «контракт сменился»',
    );
  }

  // ── ir ────────────────────────────────────────────────────────────────────
  const ir = input['ir'];
  if (!isObject(ir)) {
    p.add('ADR-0008 форма', 'ir', `ожидался объект \`RenderIrSegment\`, пришло ${describe(ir)}`);
  } else {
    p.str(ir['segmentId'], 'ir.segmentId');
    p.int(ir['segmentDurationInFrames'], 'ir.segmentDurationInFrames', 1);
    if (!Array.isArray(ir['clips'])) {
      p.add('ADR-0008 форма', 'ir.clips', `ожидался массив, пришло ${describe(ir['clips'])}`);
    }
    if (!Array.isArray(ir['captions'])) {
      p.add('ADR-0008 форма', 'ir.captions', `ожидался массив, пришло ${describe(ir['captions'])}`);
    }
  }

  // ── профили ───────────────────────────────────────────────────────────────
  const compileProfile = input['compileProfile'];
  if (!isObject(compileProfile)) {
    p.add('ADR-0008 форма', 'compileProfile', `ожидался объект, пришло ${describe(compileProfile)}`);
  } else {
    const fps = compileProfile['fps'];
    if (!isObject(fps)) {
      p.add('ADR-0008 форма', 'compileProfile.fps', `ожидалась дробь {num, den}, пришло ${describe(fps)}`);
    } else {
      p.int(fps['num'], 'compileProfile.fps.num', 1);
      p.int(fps['den'], 'compileProfile.fps.den', 1);
    }
    p.int(compileProfile['width'], 'compileProfile.width', 1);
    p.int(compileProfile['height'], 'compileProfile.height', 1);
  }

  const pixelProfile = input['pixelProfile'];
  if (!isObject(pixelProfile)) {
    p.add('ADR-0008 форма', 'pixelProfile', `ожидался объект, пришло ${describe(pixelProfile)}`);
  } else {
    p.bool(pixelProfile['browserGpu'], 'pixelProfile.browserGpu');
    const scale = p.num(pixelProfile['scale'], 'pixelProfile.scale');
    if (scale !== null && (scale <= 0 || scale > 1)) {
      p.add(
        'ADR-0008 форма',
        'pixelProfile.scale',
        `ожидалось значение в (0, 1], пришло ${String(scale)}. Множители ВВЕРХ рендерер ` +
          'через `--resolution` умеет, но `scale` профиля раскрывает адаптер в геометрию ' +
          'композиции (ADR-0008), и увеличение там означало бы вторую геометрию',
      );
    }
    const imageFormat = p.str(pixelProfile['imageFormat'], 'pixelProfile.imageFormat');
    if (imageFormat !== null && !RENDERER_IMAGE_FORMATS.has(imageFormat)) {
      p.add(
        'ADR-0008 профиль',
        'pixelProfile.imageFormat',
        `\`${imageFormat}\` рендерером не выражается: у HyperFrames 0.8.5 форматы вывода — ` +
          '`mp4|webm|mov|png-sequence|gif`, последовательности JPEG среди них нет, а mp4 ' +
          'запрещён (**R10**: штатный энкодер не ставит `-sc_threshold 0`, `FACT` SP-3d §4.3). ' +
          'Это отказ, а не подстановка png: молчаливая подмена формата передачи кадров сменила ' +
          'бы пиксели, не сменив ключа кэша',
      );
    }
  }

  const executionProfile = input['executionProfile'];
  if (!isObject(executionProfile)) {
    p.add('ADR-0008 форма', 'executionProfile', `ожидался объект, пришло ${describe(executionProfile)}`);
  } else {
    p.int(executionProfile['workers'], 'executionProfile.workers', 1);
    p.int(executionProfile['segmentTimeoutMs'], 'executionProfile.segmentTimeoutMs', 1);
  }

  // ── пути ──────────────────────────────────────────────────────────────────
  const tmpDir = p.abs(input['tmpDir'], 'tmpDir');
  const outputPath = p.abs(input['outputPath'], 'outputPath');

  const bundle = input['bundle'];
  let bundlePath: string | null = null;
  if (!isObject(bundle)) {
    p.add('ADR-0008 форма', 'bundle', `ожидался объект {path, hash, compositionId}, пришло ${describe(bundle)}`);
  } else {
    bundlePath = p.abs(bundle['path'], 'bundle.path');
    p.sha(bundle['hash'], 'bundle.hash');
    p.str(bundle['compositionId'], 'bundle.compositionId');
  }

  if (tmpDir !== null && bundlePath !== null && !isInside(tmpDir, bundlePath)) {
    p.add(
      'R2',
      'bundle.path',
      `каталог композиции \`${bundlePath}\` обязан лежать ВНУТРИ \`tmpDir\` (\`${tmpDir}\`): ` +
        'его наполняет адаптер (ADR-0008, «Кто наполняет каталог композиции»), а писать ' +
        'адаптер вправе только в `tmpDir` и `outputPath`',
    );
  }
  if (tmpDir !== null && outputPath !== null && isInside(tmpDir, outputPath)) {
    p.add(
      'R2',
      'outputPath',
      `выход \`${outputPath}\` лежит внутри \`tmpDir\` (\`${tmpDir}\`), а \`tmpDir\` адаптер ` +
        'очищает после сегмента — то есть выход был бы удалён вместе с временем жизни запроса',
    );
  }

  // ── assets / fonts ────────────────────────────────────────────────────────
  const assets = readFileList(p, input['assets'], 'assets', 'role');
  const fonts = readFileList(p, input['fonts'], 'fonts', 'family');

  // ── согласованность IR ⊆ запрос ───────────────────────────────────────────
  if (isObject(ir)) {
    const declaredAssets = new Set(assets.map((a) => a.sha256));
    const declaredFonts = new Set(fonts.map((f) => f.sha256));
    checkSubset(p, ir['assets'], declaredAssets, 'ir.assets', 'request.assets');
    checkSubset(p, ir['fonts'], declaredFonts, 'ir.fonts', 'request.fonts');
    if (Array.isArray(ir['clips'])) {
      ir['clips'].forEach((clip, i) => {
        if (!isObject(clip)) return;
        checkSubset(p, clip['assets'], declaredAssets, `ir.clips[${String(i)}].assets`, 'request.assets');
        checkSubset(p, clip['fonts'], declaredFonts, `ir.clips[${String(i)}].fonts`, 'request.fonts');
      });
    }
  }

  if (p.list.length > 0) {
    throw new RenderAdapterError(
      'ADR-0008 форма',
      `запрос отвергнут, проблем: ${String(p.list.length)}`,
      p.list,
    );
  }
  return input as unknown as SegmentRenderRequest;
}

/** Разбор `assets`/`fonts`: одинаковая форма, разное имя третьего поля. */
function readFileList(
  p: Problems,
  value: unknown,
  at: string,
  thirdField: 'role' | 'family',
): readonly (RequestAsset | RequestFont)[] {
  if (!Array.isArray(value)) {
    p.add('ADR-0008 форма', at, `ожидался массив, пришло ${describe(value)}`);
    return [];
  }
  const out: (RequestAsset | RequestFont)[] = [];
  const seen = new Map<string, number>();
  value.forEach((item, i) => {
    const where = `${at}[${String(i)}]`;
    if (!isObject(item)) {
      p.add('ADR-0008 форма', where, `ожидался объект, пришло ${describe(item)}`);
      return;
    }
    const sha = p.sha(item['sha256'], `${where}.sha256`);
    const path = p.abs(item['path'], `${where}.path`);
    const third = p.str(item[thirdField], `${where}.${thirdField}`);
    if (sha === null || path === null || third === null) return;
    const first = seen.get(sha);
    if (first !== undefined) {
      p.add(
        'ADR-0008 форма',
        `${where}.sha256`,
        `sha256 \`${sha}\` уже объявлен в \`${at}[${String(first)}]\`. Два имени у одного блоба ` +
          'означали бы два файла в каталоге композиции с одинаковым содержимым — и второй ' +
          'вход в `compositionHash`, которого не объявлял никто',
      );
      return;
    }
    seen.set(sha, i);
    out.push(
      thirdField === 'role'
        ? ({ sha256: sha, path, role: third } as RequestAsset)
        : ({ sha256: sha, path, family: third } as RequestFont),
    );
  });
  return out;
}

/** `ir.<что-то> ⊆ request.<что-то>` по sha. Это и есть вход **R3**. */
function checkSubset(
  p: Problems,
  irList: unknown,
  declared: ReadonlySet<string>,
  at: string,
  requestField: string,
): void {
  if (irList === undefined) return;
  if (!Array.isArray(irList)) {
    p.add('ADR-0008 форма', at, `ожидался массив, пришло ${describe(irList)}`);
    return;
  }
  irList.forEach((ref, i) => {
    if (!isObject(ref)) {
      p.add('ADR-0008 форма', `${at}[${String(i)}]`, `ожидался объект, пришло ${describe(ref)}`);
      return;
    }
    const sha = ref['sha256'];
    if (typeof sha !== 'string' || !declared.has(sha)) {
      p.add(
        'R3',
        `${at}[${String(i)}].sha256`,
        `IR требует файл \`${String(sha)}\`, а в \`${requestField}\` его нет. Адаптер не вправе ` +
          'искать его сам: правило R3 — «не открывает файлов вне `assets`/`fonts` запроса», и ' +
          'поиск по CAS был бы ровно тем открытием, которое оно запрещает',
      );
    }
  });
}

/**
 * Открывает КАЖДЫЙ файл запроса и сверяет sha256 его байтов с заявленным.
 *
 * Это ВТОРАЯ половина R3 и единственное место, где адаптер читает файлы проекта. Проверка не
 * косметическая: без неё «файл из запроса» означало бы «файл, чьё ИМЯ названо в запросе», и
 * подмена содержимого по тому же пути прошла бы незамеченной — а именно содержимое входит в
 * `segmentKey` через `assetShas` (ADR-0006 §2).
 *
 * @throws {RenderAdapterError} перечисляя ВСЕ расхождения, а не первое.
 */
export function assertRequestFiles(request: SegmentRenderRequest): readonly RequestFile[] {
  const files: RequestFile[] = [];
  const problems: RenderProblem[] = [];

  const check = (sha256: string, path: string, at: string): void => {
    let bytes: Buffer;
    try {
      bytes = readFileSync(path);
    } catch (err) {
      problems.push({
        rule: 'R3',
        at,
        message:
          `файл \`${path}\` не читается: ${String((err as Error).message)}. Запрос обязан ` +
          'нести локальные пути к УЖЕ существующим блобам (ADR-0008, «Гарантии входа»)',
      });
      return;
    }
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== sha256) {
      problems.push({
        rule: 'R3',
        at,
        message:
          `по пути \`${path}\` лежат байты с sha256 \`${actual}\`, а запрос называет ` +
          `\`${sha256}\`. Расхождение означает, что в каталог композиции уехал бы НЕ тот файл, ` +
          'который вошёл в `segmentKey` через `assetShas` (ADR-0006 §2)',
      });
      return;
    }
    files.push({ sha256, path, at });
  };

  request.assets.forEach((a, i) => {
    check(a.sha256, a.path, `assets[${String(i)}]`);
  });
  request.fonts.forEach((f, i) => {
    check(f.sha256, f.path, `fonts[${String(i)}]`);
  });

  if (problems.length > 0) {
    throw new RenderAdapterError(
      'R3',
      `файлы запроса не совпали с объявленными, проблем: ${String(problems.length)}`,
      problems,
    );
  }
  return files;
}
