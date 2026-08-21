/**
 * SP-3e: сведение гейта «N прогонов = один файл» по снятым прогонам.
 * Группа — (рендерер × параллелизм). Для каждой: сколько прогонов,
 * сколько РАЗНЫХ sha256 mp4, сколько разных framemd5, уровни ВЧ-энергии,
 * медиана кадров/с. На расходящихся парах — PSNR (прибор SP-3).
 */
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from './lib/env.mjs';
import {compareFramemd5, psnrBetweenFiles, psnrDistribution} from '../sp3/lib/media.mjs';
import {energyOf} from './hfenergy.mjs';

const rawDir = path.join(ROOT, 'results/raw');
const runs = fs.readdirSync(rawDir)
  .filter((f) => /^(MR|MH|MR1|MH1|CTL)-/.test(f) && f.endsWith('.json'))
  .map((f) => JSON.parse(fs.readFileSync(path.join(rawDir, f), 'utf8')))
  .filter((r) => r.status === 'OK');

const median = (a) => {
  const s = [...a].filter((x) => typeof x === 'number').sort((x, y) => x - y);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return Math.round((s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) * 1000) / 1000;
};

/** Композиция определяется по runId: моушн — эта, exact/idiom — контрольные из SP-3/SP-3c. */
const compOf = (r) => (r.runId.includes('-exact-') ? 'точная(SP-3/3c)' : r.runId.includes('-idiom-') ? 'идиоматичная(SP-3c)' : 'моушн(SP-3e)');
const groupKey = (r) => `${compOf(r)} | ${r.renderer}/${r.renderer === 'remotion' ? `c${r.config.concurrency}` : `w${r.config.workers}`}`;
const groups = new Map();
for (const r of runs) {
  const k = groupKey(r);
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(r);
}

const out = {schema: 'sp3e-determinism/1', generatedFrom: `${runs.length} прогонов со статусом OK`, groups: []};
for (const [key, rs] of [...groups.entries()].sort()) {
  rs.sort((a, b) => a.runId.localeCompare(b.runId));
  const shas = rs.map((r) => r.verification.outputSha256);
  const uniqSha = [...new Set(shas)];
  const md5s = rs.map((r) => r.verification.framemd5.sha256);
  const uniqMd5 = [...new Set(md5s)];
  const energies = [];
  for (const r of rs) {
    let e = null;
    try { e = await energyOf(path.join(ROOT, 'out', `${r.runId}.mp4`)); } catch { /* mp4 удалён */ }
    energies.push({runId: r.runId, energy: e});
  }
  const uniqEnergy = [...new Set(energies.map((e) => e.energy).filter((e) => e !== null))];
  const group = {
    key, runs: rs.length,
    distinctOutputs: uniqSha.length,
    distinctFramemd5: uniqMd5.length,
    sizes: [...new Set(rs.map((r) => r.verification.outputBytes))],
    shaShort: uniqSha.map((s) => s.slice(0, 16)),
    energyLevels: uniqEnergy.sort((a, b) => a - b),
    energyPerRun: energies,
    fpsRenderPhaseMedian: median(rs.map((r) => r.derived.framesPerSecond_renderPhase)),
    fpsFramesOnlyMedian: median(rs.map((r) => r.derived.framesPerSecond_framesOnly)),
    fpsEndToEndMedian: median(rs.map((r) => r.derived.framesPerSecond_endToEnd)),
    wallSecMedian: median(rs.map((r) => r.derived.wallTimeSec)),
    peakRssSumMbMedian: median(rs.map((r) => r.memory?.peakRssSumMb ?? null)),
    peakPssSumMbMedian: median(rs.map((r) => r.memory?.peakPssSumMb ?? null)),
    loadavg1AtStart: rs.map((r) => r.stateAtStart?.loadAvg?.[0] ?? null),
    diverging: [],
  };
  // На расходящихся парах — покадровое сравнение (framemd5 + PSNR), прибор SP-3.
  if (uniqSha.length > 1) {
    const first = rs[0];
    const other = rs.find((r) => r.verification.outputSha256 !== first.verification.outputSha256);
    const a = path.join(ROOT, 'results/framemd5', `${first.runId}.framemd5`);
    const b = path.join(ROOT, 'results/framemd5', `${other.runId}.framemd5`);
    const cmp = compareFramemd5(a, b);
    let dist = null;
    try {
      const {frames} = await psnrBetweenFiles(
        path.join(ROOT, 'out', `${first.runId}.mp4`), path.join(ROOT, 'out', `${other.runId}.mp4`),
        path.join(ROOT, 'results/raw', `psnr-${first.runId}-${other.runId}.txt`));
      dist = psnrDistribution(frames);
    } catch (err) { dist = {error: String(err?.message ?? err)}; }
    group.diverging.push({pair: [first.runId, other.runId], framemd5: cmp, psnr: dist});
  }
  out.groups.push(group);
}
fs.writeFileSync(path.join(ROOT, 'results/raw/determinism.json'), JSON.stringify(out, null, 2) + '\n');
for (const g of out.groups) {
  console.log(`${g.key}\tпрогонов ${g.runs}\tразных выходов ${g.distinctOutputs}\tВЧ ${JSON.stringify(g.energyLevels)}\tмедиана кадров/с ${g.fpsRenderPhaseMedian}`);
}
