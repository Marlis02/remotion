// Рабочий проект для тестов `vpe build` (`L-01`) — КОПИЯ фикстуры с короткой прозой.
//
// ПОЧЕМУ КОПИЯ, А НЕ `fixtures/minimal` НАПРЯМУЮ. Сборка ПИШЕТ в дерево проекта три артефакта
// авторства (дубли, `store.lock`, ledger), а фикстуру задача не трогает ни символом. Копия
// живёт в `os.tmpdir()` — приём `V-03`/`CP-01`.
//
// ПОЧЕМУ ПРОЗА КОРОТКАЯ. Ролик фикстуры — 1473 кадра; юнит-тесту столько не нужно ни на что,
// а кодирование их ffmpeg'ом стоило бы минут. Профили, каталог ассетов и `project.yaml`
// берутся у фикстуры ДОСЛОВНО: числа, которые проверяются, обязаны быть её числами.
//
// ═══ ПОЧЕМУ ПОД АДРЕСА ФИКСТУРЫ ПОДКЛАДЫВАЮТСЯ ЧУЖИЕ БАЙТЫ ═══
// `fixtures/minimal/assets/records/*.json` объявляют sha `0000…0001`…`0005` — СИНТЕТИЧЕСКИЕ
// адреса, байтов с такими sha не существует и существовать не может. Живая сборка требует
// настоящих байтов: адаптер читает файл ассета и определяет формат по магическим байтам. CAS
// содержимое НЕ перехэширует (`M-01`, осознанная граница: целостность — предмет
// `vpe store verify`, `L-02`), поэтому прогон кладёт НАСТОЯЩИЙ PNG и НАСТОЯЩИЙ шрифт под
// адресами фикстуры. Это сказано вслух, потому что означает: фикстура в её нынешнем виде
// живьём не собирается ничем, кроме такой подстановки (новый долг `L-01`).

import { deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const FIXTURE = path.join(REPO, 'fixtures/minimal');

/** Системный DejaVu Sans Bold — тот же временный шрифт канала, что объявляет запись `…0005`. */
export const SYSTEM_FONT_PATH = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';

const roots: string[] = [];

export function cleanupRoots(): void {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.length = 0;
}

function tempRoot(prefix: string): string {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

/** CRC32 — таблица считается на месте: ради одного PNG зависимости не заводятся. */
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(body)])), 0);
  return Buffer.concat([head, Buffer.from(body), crc]);
}

/**
 * Настоящий PNG `size`×`size`: шахматка с градиентом, собранная детерминированно.
 *
 * Не заливка: у соседних кадров наезда обязаны быть разные пиксели, иначе живой гейт
 * измерял бы отсутствие движения (тот же довод, что у `PNG_PATTERN_32` в `H-06`).
 */
export function makePng(size = 32): Buffer {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  let at = 0;
  for (let y = 0; y < size; y += 1) {
    raw[at] = 0;
    at += 1;
    for (let x = 0; x < size; x += 1) {
      const checker = ((x >> 2) + (y >> 2)) % 2 === 0 ? 40 : 0;
      raw[at] = Math.min(255, checker + Math.round((x / size) * 200));
      raw[at + 1] = Math.min(255, checker + Math.round((y / size) * 200));
      raw[at + 2] = Math.min(255, checker + Math.round(((x + y) / (2 * size)) * 200));
      at += 3;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

/** Кладёт байты в CAS ПО ЗАДАННОМУ адресу (а не по их sha) — см. шапку файла. */
export function putAt(storeDir: string, sha: string, bytes: Uint8Array): string {
  const file = path.join(storeDir, sha.slice(0, 2), sha.slice(2, 4), sha);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, bytes);
  return file;
}

/** Короткая проза с теми же якорями, что нужны режиссуре ниже. */
export const SHORT_SOURCE = `schema: source-dialect/1

# chapter: main

## scene: intro

[img: ledger] The word is short. [beat: count] The page is black.
`;

/** Одна запись режиссуры: `still@1` на бите `b:count`. */
export const SHORT_DIRECTION = `schema: direction/1

records:
  - recordId: "5d6e1130"
    at: { kind: anchor, anchor: "b:count" }
    track: visual
    z: 15
    template: "still@1"
    params:
      asset: "ledger"
      fit: cover
`;

export interface TestProject {
  readonly root: string;
  readonly projectDir: string;
  readonly storeDir: string;
  readonly buildDir: string;
  readonly gatesDir: string;
}

/** Отпечаток окружения, под который подписаны записи гейта тестового каталога. */
export const TEST_FINGERPRINT = 'f'.repeat(64);

/**
 * Записи гейта на пару (`profileId`, `TEST_FINGERPRINT`) — по одной на шаблон.
 *
 * ПИШУТСЯ ФАЙЛАМИ ВО ВРЕМЕННЫЙ КАТАЛОГ, а не берутся из репозитория (`--gates-dir`): записи
 * репозитория сняты на ДРУГОМ окружении, и тест, зелёный от них, был бы тестом про машину.
 * Механика та же, что у тестов `E-00`.
 */
export function writeGates(
  gatesDir: string,
  templates: readonly string[],
  profileIds: readonly string[],
  fingerprint: string = TEST_FINGERPRINT,
): void {
  mkdirSync(gatesDir, { recursive: true });
  for (const name of templates) {
    const [id, version] = name.split('@') as [string, string];
    const entries = profileIds.map((profileId) => ({
      N: profileId === 'final' ? 10 : 3,
      bundleHash: '0'.repeat(64),
      class: 'PASS',
      date: '2026-08-30T00:00:00.000Z',
      engineFingerprint: fingerprint,
      framemd5: '1'.repeat(64),
      profileId,
      sha256: '2'.repeat(64),
    }));
    writeFileSync(
      path.join(gatesDir, `${name}.gates.json`),
      `${JSON.stringify({ entries, schema: 'template-gates/1', templateId: id, templateVersion: Number(version) })}\n`,
      'utf8',
    );
  }
}

export interface ProjectOptions {
  /**
   * Заменить прозу и режиссуру короткими (умолчание). `false` — оставить фикстурные ДОСЛОВНО:
   * так работает живой прогон `build-e2e.test.ts`, которому нужен ролик фикстуры целиком.
   */
  readonly short?: boolean;
}

/** Готовый проект: копия фикстуры, засеянный CAS, каталог записей гейта. */
export function makeProject(options: ProjectOptions = {}): TestProject {
  const root = tempRoot('vpe-l01-');
  const projectDir = path.join(root, 'project');
  cpSync(FIXTURE, projectDir, { recursive: true });
  if (options.short !== false) {
    writeFileSync(path.join(projectDir, 'source/01-intro.md'), SHORT_SOURCE, 'utf8');
    writeFileSync(path.join(projectDir, 'direction/01-intro.yaml'), SHORT_DIRECTION, 'utf8');
  }

  const storeDir = path.join(root, 'store');
  const png = makePng();
  for (const n of ['1', '2', '3', '4']) putAt(storeDir, `${'0'.repeat(63)}${n}`, png);
  putAt(storeDir, `${'0'.repeat(63)}5`, readFileSync(SYSTEM_FONT_PATH));

  return {
    root,
    projectDir,
    storeDir,
    buildDir: path.join(root, 'build'),
    gatesDir: path.join(root, 'gates'),
  };
}

/**
 * Детерминированный источник байтов минта: различность ВНУТРИ прогона, повторяемость МЕЖДУ.
 *
 * Оба свойства обязательны, и второе не даётся даром: источник, возвращающий одно и то же на
 * каждый вызов, отвергает сам минт (`freshId`: «восемь минтов подряд дали занятый id — так
 * выглядит источник, возвращающий константу»). Приём — из `compile/test/project.ts`.
 */
export function countingRandom(start = 1): (byteLength: number) => Uint8Array {
  let n = start;
  return (byteLength: number): Uint8Array => {
    const out = new Uint8Array(byteLength);
    for (let i = 0; i < byteLength; i += 1) out[i] = (n + i * 7) & 0xff;
    n = (n + 13) & 0xff;
    return out;
  };
}

/** sha256 файла — тем же алгоритмом, каким считает входы сборка. */
export function sha256File(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}
