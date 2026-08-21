/**
 * SP-3f: гейт «N прогонов = один файл» + PSNR на расходящихся парах.
 * Группа — (композиция × профиль × workers). Приборы — sp3/lib/media.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import {ROOT, BIN} from './lib/env.mjs';
process.env.PATH = `${BIN}:${process.env.PATH}`;
import {compareFramemd5, psnrBetweenFiles, psnrDistribution} from '../sp3/lib/media.mjs';
import {energyAt, SPOTS} from './hfenergy.mjs';

const rawDir = path.join(ROOT, 'results/raw');
const runs = fs.readdirSync(rawDir)
  .filter((f) => /^(V-w4-r|Vd-w4-r|L-|L450-)/.test(f) && f.endsWith('.json'))
  .map((f) => JSON.parse(fs.readFileSync(path.join(rawDir, f), 'utf8')))
  .filter((r) => r.status === 'OK');

const median = (a) => {
  const s = [...a].filter((x) => typeof x === 'number').sort((x, y) => x - y);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return Math.round((s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) * 1000) / 1000;
};
const groupKey = (r) => (r.runId.startsWith('Vd-') ? 'сцена/draftHalf' : /^L/.test(r.runId) ? `цена слоёв/${r.runId}` : 'сцена/final') + `/w${r.config.workers}`;

const groups = new Map();
for (const r of runs) {
  const k = groupKey(r);
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(r);
}

const out = {schema: 'sp3f-determinism/1', generatedFrom: `${runs.length} прогонов со статусом OK`, groups: []};
for (const [key, rs] of [...groups.entries()].sort()) {
  rs.sort((a, b) => a.runId.localeCompare(b.runId, 'en'));
  const shas = rs.map((r) => r.verification.outputSha256);
  const uniqSha = [...new Set(shas)];
  const uniqMd5 = [...new Set(rs.map((r) => r.verification.framemd5.sha256))];
  const energies = [];
  if (rs.length > 1 && !key.startsWith('цена')) {
    for (const r of rs) {
      const row = {runId: r.runId};
      for (const s of SPOTS) {
        try { row['f' + s.frame] = await energyAt(path.join(ROOT, 'out', `${r.runId}.mp4`), s.frame, s.crop); } catch { row['f' + s.frame] = null; }
      }
      energies.push(row);
    }
  }
  const group = {
    key, runs: rs.length, uniqueSha256: uniqSha.length, uniqueFramemd5: uniqMd5.length,
    bytes: [...new Set(rs.map((r) => r.verification.outputBytes))],
    fpsRenderPhaseMedian: median(rs.map((r) => r.derived.framesPerSecond_renderPhase)),
    fpsFramesOnlyMedian: median(rs.map((r) => r.derived.framesPerSecond_framesOnly)),
    fpsEndToEndMedian: median(rs.map((r) => r.derived.framesPerSecond_endToEnd)),
    wallSecMedian: median(rs.map((r) => r.derived.wallTimeSec)),
    peakRssMb: Math.max(...rs.map((r) => r.memory?.peakRssSumMb ?? 0)),
    peakPssMb: Math.max(...rs.map((r) => r.memory?.peakPssSumMb ?? 0)),
    peakProcessCount: Math.max(...rs.map((r) => r.memory?.peakProcessCount ?? 0)),
    captureMode: [...new Set(rs.map((r) => r.captureMode))],
    energies,
    uniqueEnergyLevels: SPOTS.reduce((acc, s) => {
      acc['f' + s.frame] = [...new Set(energies.map((e) => e['f' + s.frame]).filter((v) => v !== null))];
      return acc;
    }, {}),
    runIds: rs.map((r) => r.runId), sha256: shas.map((s) => s.slice(0, 16)),
    psnr: null,
  };
  // PSNR на ВСЕХ парах группы, если прогонов больше одного
  if (rs.length > 1 && !key.startsWith('цена')) {
    const pairs = [];
    // PSNR считается на ВСЕХ парах с различным sha256 (их и надо мерить) плюс
    // на первых трёх побайтово равных парах как контроль прибора: на равных
    // файлах PSNR обязан быть +inf на всех кадрах, и это проверяется, а не
    // предполагается. Остальные равные пары помечаются identical без прогона —
    // мерить PSNR между двумя копиями одного файла бессмысленно.
    let controls = 0;
    for (let i = 0; i < rs.length; i++) {
      for (let j = i + 1; j < rs.length; j++) {
        const same = rs[i].verification.outputSha256 === rs[j].verification.outputSha256;
        if (same && controls >= 3) {
          pairs.push({pair: [rs[i].runId, rs[j].runId], identical: true, skipped: 'побайтово равны, PSNR не считался',
            differingFrames: 0, totalFrames: null, minPsnrAvg: null, medianPsnrAvg: null, framesBelow40Db: 0});
          continue;
        }
        if (same) controls++;
        const a = rs[i].runId; const b = rs[j].runId;
        const {frames} = await psnrBetweenFiles(
          path.join(ROOT, 'out', `${a}.mp4`), path.join(ROOT, 'out', `${b}.mp4`),
          path.join(rawDir, `psnr-${a}-${b}.txt`));
        const d = psnrDistribution(frames);
        pairs.push({pair: [a, b], identical: rs[i].verification.outputSha256 === rs[j].verification.outputSha256,
          differingFrames: frames.filter((f) => Number.isFinite(f.psnrAvg)).length, totalFrames: frames.length,
          minPsnrAvg: d?.psnrMinDb ?? null, medianPsnrAvg: d?.psnrP50Db ?? null, framesBelow40Db: d?.framesBelow40Db ?? null});
      }
    }
    group.psnr = pairs;
    group.minPsnrAcrossPairs = pairs.map((p) => p.minPsnrAvg).filter((v) => typeof v === 'number').sort((a, b) => a - b)[0] ?? null;
  }
  out.groups.push(group);
  console.log(`${key}: ${group.uniqueSha256} из ${group.runs} sha, framemd5 ${group.uniqueFramemd5}, ${group.fpsRenderPhaseMedian} кадра/с`);
}
fs.writeFileSync(path.join(rawDir, 'determinism.json'), JSON.stringify(out, null, 2) + '\n');
