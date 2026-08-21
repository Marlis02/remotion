/**
 * SP-3d: освобождение диска перед PNG-сиквенсами.
 *
 * mp4 после сведения — расходный материал: sha256, размер, framemd5 и ffprobe каждого
 * записаны в results/raw и results/framemd5 и без файла не теряются. На диске остаются
 * только те, которые ещё будут сравниваться попиксельно или побайтово.
 *
 * Файлы созданы root изнутри контейнера, поэтому удаляет их контейнер того же образа
 * (`--entrypoint rm`), а не хост.
 */
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from './lib/env.mjs';
import {imageTag} from './lib/hfargs.mjs';
import {getVersions} from '../sp3c/lib/versions.mjs';

const OUT = path.join(ROOT, 'out');
const KEEP = new Set([
  // стороны сравнения Q4
  'dA-final-w1-r1.mp4', 'dA-final-w2-r1.mp4', 'dA-final-w4-r1.mp4', 'dA-final-w8-r1.mp4',
  'dB-draft-w4-r1.mp4', 'dD-final-w4-load6-r1.mp4',
  'dC-idiom-final-w1-r1.mp4', 'dC-idiom-final-w4-r1.mp4',
  // разошедшиеся прогоны и их эталоны — на них держится вся локализация механизма
  'dD-idiom-final-w4-load6-r3.mp4', 'dD-idiom-final-w4-load6-r1.mp4',
  'dH-idiom-final-w1-x06.mp4', 'dH-idiom-final-w1-x08.mp4', 'dH-idiom-final-w4-x06.mp4',
  // парный локальный софтверный путь — стороны сравнения Q2 и Q4
  'dE-local-sw-final-w1-r1.mp4', 'dE-local-sw-final-w2-r1.mp4', 'dE-local-sw-final-w4-r1.mp4',
  // рендер без сети
  'netnone-final-w4.mp4',
  // прямой прогон 60 с
  'dL-final-w4-60s.mp4',
  // пробный рендер, которым собран образ
  'smoke.mp4',
]);

const files = fs.readdirSync(OUT).filter((f) => f.endsWith('.mp4') && !KEEP.has(f));
if (!files.length) {
  console.log('нечего удалять');
  process.exit(0);
}
const bytes = files.reduce((a, f) => a + fs.statSync(path.join(OUT, f)).size, 0);
const TAG = imageTag(getVersions().hyperframesCli);
execFileSync('docker', ['run', '--rm', '--network', 'none', '-v', `${OUT}:/output`, '--entrypoint', 'rm', TAG, '-f', ...files.map((f) => `/output/${f}`)], {stdio: 'pipe', timeout: 120000});
fs.writeFileSync(
  path.join(ROOT, 'results/raw/disk-cleanup.json'),
  JSON.stringify({schema: 'sp3d-cleanup/1', capturedAt: new Date().toISOString(), reason: 'место под PNG-сиквенсы', removed: files, removedBytes: bytes, kept: [...KEEP]}, null, 2) + '\n',
);
console.log(`удалено ${files.length} mp4, ${Math.round(bytes / 1024 ** 2)} МБ`);
