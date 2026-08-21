/**
 * SP-3d: сведение детерминизма по снятым Docker-прогонам.
 *
 * Прибор тот же, что в SP-3/SP-3c: sha256 готового файла (контейнер + битстрим) и
 * framemd5 (md5 каждого ДЕКОДИРОВАННОГО кадра). Ничего не рендерит.
 *
 * Группа = набор прогонов, которые ОБЯЗАНЫ совпасть: одна настройка, повторы подряд
 * (суффикс -rN или -xNN), плюс группы «инвариантность к workers» внутри профиля.
 */
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from './lib/env.mjs';
import {compareFramemd5} from '../sp3/lib/media.mjs';

const RAW = path.join(ROOT, 'results/raw');
const runs = fs
  .readdirSync(RAW)
  .filter((f) => f.endsWith('.json'))
  .map((f) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(RAW, f), 'utf8'));
    } catch {
      return null;
    }
  })
  .filter((r) => r && r.schema === 'sp3d-run/1');
const byId = new Map(runs.map((r) => [r.runId, r]));

const groups = [];
const addGroup = (id, title, members, expectation) => {
  if (members.length >= 2) groups.push({id, title, expectation, members: [...members].sort()});
};

const okRuns = runs.filter((r) => r.status === 'OK');

// 1. Повторы одной настройки.
const repeatKeys = new Map();
for (const r of okRuns) {
  const m = r.runId.match(/^(.*)-(?:r\d+|x\d+)$/);
  if (!m) continue;
  if (!repeatKeys.has(m[1])) repeatKeys.set(m[1], []);
  repeatKeys.get(m[1]).push(r.runId);
}
for (const [k, ids] of [...repeatKeys.entries()].sort()) {
  addGroup(`repeat:${k}`, `прогоны подряд одной настройки ${k}`, ids, 'побайтово равные выходы');
}

// 2. Инвариантность к числу воркеров внутри одного профиля и одной композиции.
const acrossKeys = new Map();
for (const r of okRuns) {
  const k = r.runId.replace(/-w\d+-/, '-wX-').replace(/-(?:r\d+|x\d+)$/, '');
  if (!/-wX(-|$)/.test(k)) continue;
  if (!acrossKeys.has(k)) acrossKeys.set(k, []);
  acrossKeys.get(k).push(r.runId);
}
for (const [k, ids] of [...acrossKeys.entries()].sort()) {
  const widths = new Set(ids.map((i) => (i.match(/-w(\d+)-/) ?? [])[1]));
  if (widths.size < 2) continue;
  addGroup(`across-workers:${k}`, `инвариантность к workers: ${k} (${[...widths].sort().join('/')})`, ids, 'побайтово равные выходы');
}

// 3. Вхолостую против нагрузки: dA-final-w4-* против dD-final-w4-load6-*.
const pairs = [
  ['load:exact-w4', 'точная композиция, w4 final: вхолостую против нагрузки 6 потоков',
    okRuns.filter((r) => /^dA-final-w4-r\d+$|^dD-final-w4-load6-r\d+$/.test(r.runId)).map((r) => r.runId)],
  ['load:idiom-w4', 'идиоматичная композиция, w4 final: вхолостую против нагрузки 6 потоков',
    okRuns.filter((r) => /^dC-idiom-final-w4-r\d+$|^dD-idiom-final-w4-load6-r\d+$/.test(r.runId)).map((r) => r.runId)],
  ['series:exact-w4-all', 'точная композиция, w4 final, ВСЕ прогоны вхолостую (матрица + серия из 10)',
    okRuns.filter((r) => /^dA-final-w4-r\d+$|^dG-final-w4-x\d+$/.test(r.runId)).map((r) => r.runId)],
];
for (const [id, title, ids] of pairs) addGroup(id, title, ids, 'побайтово равные выходы');

const hashOf = (r) => r.verification?.outputSha256 ?? r.verification?.dirHash ?? null;
const md5Of = (r) => r.verification?.framemd5?.sha256 ?? null;

const doc = {
  schema: 'sp3d-determinism/1',
  capturedAt: new Date().toISOString(),
  method: {
    fileHash: 'sha256 готового файла (mp4) или dirHash каталога PNG (имя+содержимое всех файлов)',
    framemd5: 'ffmpeg -f framemd5 — md5 каждого декодированного кадра; сравнивается sha256 файла framemd5 и первый разошедшийся кадр',
  },
  groups: [],
};

for (const g of groups) {
  const members = g.members.map((id) => byId.get(id));
  const hashes = [...new Set(members.map(hashOf).filter(Boolean))];
  const md5s = [...new Set(members.map(md5Of).filter(Boolean))];
  let firstDiffFrame = null;
  if (md5s.length > 1) {
    const files = members.map((m) => path.join(ROOT, m.verification.framemd5.file));
    for (let i = 1; i < files.length; i++) {
      const cmp = compareFramemd5(files[0], files[i]);
      if (!cmp.equal) {
        firstDiffFrame = cmp.firstDiffFrame;
        break;
      }
    }
  }
  doc.groups.push({
    id: g.id,
    title: g.title,
    expectation: g.expectation,
    runs: g.members,
    distinctFileHashes: hashes.length,
    distinctFramemd5: md5s.length,
    fileHashes: hashes,
    framemd5Hashes: md5s,
    verdict:
      md5s.length === 1 && hashes.length === 1
        ? 'совпало побайтово'
        : md5s.length === 1
          ? 'кадры совпали, файлы различаются (метаданные контейнера)'
          : `разошлось на кадре ${firstDiffFrame ?? '?'}`,
    firstDiffFrame,
    perRun: g.members.map((id) => ({
      runId: id,
      fileHash: hashOf(byId.get(id)),
      framemd5: md5Of(byId.get(id)),
      fpsFramesOnly: byId.get(id).derived?.framesPerSecond_framesOnly ?? null,
      peakRssContainerMb: byId.get(id).memory?.peakRssSumMb ?? null,
    })),
  });
}

fs.writeFileSync(path.join(RAW, 'determinism.json'), JSON.stringify(doc, null, 2) + '\n');
for (const g of doc.groups) console.log(`${g.verdict === 'совпало побайтово' ? '✓' : '✗'} ${g.title}: ${g.verdict} (${g.runs.length} прогонов)`);
console.log(`\nГрупп: ${doc.groups.length}. Файл: results/raw/determinism.json`);
