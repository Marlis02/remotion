/**
 * SP-3c: сведение детерминизма по уже снятым прогонам.
 *
 * Прибор тот же, что в SP-3: sha256 файла (контейнер + битстрим) и framemd5
 * (md5 каждого ДЕКОДИРОВАННОГО кадра). Различать их обязательно: mp4 может
 * разойтись из-за метаданных контейнера при совпадающей картинке, и наоборот.
 * Для PNG-сиквенсов сравнивается dirHash (имена + содержимое всех файлов).
 *
 * Ничего не рендерит — только читает results/raw/*.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from './lib/env.mjs';
import {compareFramemd5} from '../sp3/lib/media.mjs';

const RAW = path.join(ROOT, 'results/raw');
const load = () =>
  fs
    .readdirSync(RAW)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(RAW, f), 'utf8'));
      } catch {
        return null;
      }
    })
    .filter((r) => r && r.schema === 'sp3c-run/1');

const runs = load();
const byId = new Map(runs.map((r) => [r.runId, r]));

/** Группа = набор runId, которые ОБЯЗАНЫ совпасть между собой. */
const groups = [];
const addGroup = (id, title, predicate, expectation) => {
  const members = runs.filter((r) => r.status === 'OK' && predicate(r)).map((r) => r.runId).sort();
  if (members.length >= 2) groups.push({id, title, expectation, members});
};

// Внутри одной настройки: три прогона подряд.
for (const renderer of ['hyperframes', 'remotion']) {
  const keys = new Set();
  for (const r of runs) {
    if (r.renderer !== renderer || r.status !== 'OK') continue;
    const k = r.runId.replace(/-r\d+$/, '');
    if (/-r\d+$/.test(r.runId)) keys.add(k);
  }
  for (const k of [...keys].sort()) {
    addGroup(
      `repeat:${k}`,
      `${renderer}: прогоны подряд одной настройки ${k}`,
      (r) => r.renderer === renderer && r.runId.startsWith(`${k}-r`),
      'побайтово равные выходы',
    );
  }
}

// Между настройками concurrency/workers на одном профиле.
const acrossKeys = new Map();
for (const r of runs) {
  if (r.status !== 'OK') continue;
  const k = r.runId.replace(/-w\d+-/, '-wX-').replace(/-c\d+-/, '-cX-').replace(/-r\d+$/, '');
  if (!acrossKeys.has(k)) acrossKeys.set(k, []);
  acrossKeys.get(k).push(r.runId);
}
for (const [k, ids] of [...acrossKeys.entries()].sort()) {
  if (!/-wX-|-cX-/.test(k)) continue;
  const distinctWidths = new Set(ids.map((i) => (i.match(/-[wc](\d+)-/) ?? [])[1]));
  if (distinctWidths.size < 2) continue;
  addGroup(`across:${k}`, `инвариантность к параллелизму: ${k}`, (r) => ids.includes(r.runId), 'побайтово равные выходы');
}

const hashOf = (r) => r.verification?.outputSha256 ?? r.verification?.dirHash ?? null;
const md5Of = (r) => r.verification?.framemd5?.sha256 ?? null;

const doc = {
  schema: 'sp3c-determinism/1',
  capturedAt: new Date().toISOString(),
  method: {
    fileHash: 'sha256 готового файла (mp4) или dirHash каталога PNG (имя+содержимое всех файлов)',
    framemd5: 'ffmpeg -f framemd5 — md5 каждого декодированного кадра; сравнивается sha256 полученного файла и первый разошедшийся кадр',
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
      fpsFramesOnly: byId.get(id).derived?.framesPerSecond_framesOnly ?? byId.get(id).render?.fps?.framesOnly ?? null,
      peakRssMb: byId.get(id).memory?.peakRssSumMb ?? null,
    })),
  });
}

fs.writeFileSync(path.join(ROOT, 'results/raw/determinism.json'), JSON.stringify(doc, null, 2) + '\n');
for (const g of doc.groups) console.log(`${g.verdict === 'совпало побайтово' ? '✓' : '✗'} ${g.title}: ${g.verdict} (${g.runs.length} прогонов)`);
console.log(`\nГрупп: ${doc.groups.length}. Файл: results/raw/determinism.json`);
