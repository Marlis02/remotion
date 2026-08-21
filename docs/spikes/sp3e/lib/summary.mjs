/** SP-3e: пересборка results/summary.md из results/raw. Числа не переписываются руками. */
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from './env.mjs';

const rawDir = path.join(ROOT, 'results/raw');
const runs = fs.readdirSync(rawDir).filter((f) => /^(MR|MH|MR1|MH1|CTL)-/.test(f) && f.endsWith('.json'))
  .map((f) => JSON.parse(fs.readFileSync(path.join(rawDir, f), 'utf8')));
const det = JSON.parse(fs.readFileSync(path.join(rawDir, 'determinism.json'), 'utf8'));
const energy = JSON.parse(fs.readFileSync(path.join(rawDir, 'hf-energy.json'), 'utf8'));
const machine = JSON.parse(fs.readFileSync(path.join(ROOT, 'results/machine.json'), 'utf8'));
const hostload = fs.existsSync(path.join(ROOT, 'results/hostload.jsonl'))
  ? fs.readFileSync(path.join(ROOT, 'results/hostload.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  : [];

const num = (v, d = 2) => (v === null || v === undefined ? '—' : (Math.round(v * 10 ** d) / 10 ** d).toString());
const med = (a) => { const s = a.filter((x) => typeof x === 'number').sort((x, y) => x - y); if (!s.length) return null; const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

const L = [];
L.push('# SP-3e — числа', '');
L.push(`Собрано ${new Date().toISOString()} из \`results/raw\` скриптом \`lib/summary.mjs\`. Руками не правится.`, '');
L.push(`Прогонов всего: **${runs.length}**, из них OK: **${runs.filter((r) => r.status === 'OK').length}**.`, '');

L.push('## 1. Гейт «N прогонов = один файл»', '');
L.push('| блок | композиция | рендерер | параллелизм | прогонов | разных выходов (sha256 mp4) | разных framemd5 | размеры, б | ВЧ-энергия кадра 150 | кадров/с (renderPhase, медиана) | кадров/с (end-to-end, медиана) | пик RSS / PSS дерева, МиБ |');
L.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
const BLOCK = {'моушн(SP-3e) | remotion/c4': 'M-R', 'моушн(SP-3e) | hyperframes/w4': 'M-H',
  'моушн(SP-3e) | remotion/c1': 'M-R1', 'моушн(SP-3e) | hyperframes/w1': 'M-H1',
  'точная(SP-3/3c) | remotion/c4': 'CTL-R-точная', 'точная(SP-3/3c) | hyperframes/w4': 'CTL-H-точная',
  'идиоматичная(SP-3c) | hyperframes/w4': 'CTL-H-идиоматичная'};
const blockOf = (k) => BLOCK[k] ?? k;
for (const g of det.groups) {
  const [comp, rp] = g.key.split(' | ');
  const [rend, par] = rp.split('/');
  L.push(`| ${blockOf(g.key)} | ${comp} | ${rend} | ${par} | ${g.runs} | **${g.distinctOutputs}** | ${g.distinctFramemd5} | ${g.sizes.join(', ')} | ${g.energyLevels.join(', ')} | ${num(g.fpsRenderPhaseMedian)} | ${num(g.fpsEndToEndMedian)} | ${num(g.peakRssSumMbMedian, 0)} / ${num(g.peakPssSumMbMedian, 0)} |`);
}
L.push('');
L.push('sha256 (первые 16 символов) по группам:', '');
for (const g of det.groups) L.push(`* \`${blockOf(g.key)}\` — ${g.shaShort.map((s) => '`' + s + '…`').join(', ')}`);
L.push('');

L.push('## 2. Время прогона по фазам (медианы, мс)', '');
L.push('| блок | старт до первого кадра | фаза рендера | весь прогон | кадров/с только захват |');
L.push('|---|---|---|---|---|');
for (const g of det.groups) {
  const compOf = (r) => (r.runId.includes('-exact-') ? 'точная(SP-3/3c)' : r.runId.includes('-idiom-') ? 'идиоматичная(SP-3c)' : 'моушн(SP-3e)');
  const rs = runs.filter((r) => r.status === 'OK' && `${compOf(r)} | ${r.renderer}/${r.renderer === 'remotion' ? 'c' + r.config.concurrency : 'w' + r.config.workers}` === g.key);
  const pre = med(rs.map((r) => r.timings.preRenderOverheadMs));
  const render = med(rs.map((r) => r.timings.renderPhaseMs));
  const total = med(rs.map((r) => r.timings.cliWallMs ?? r.timings.totalMs));
  L.push(`| ${blockOf(g.key)} | ${num(pre, 0)} | ${num(render, 0)} | ${num(total, 0)} | ${num(g.fpsFramesOnlyMedian)} |`);
}
L.push('');

L.push('## 3. Расхождения (если есть)', '');
const div = det.groups.filter((g) => g.diverging.length);
if (!div.length) L.push('Расходящихся групп нет: в каждой группе все прогоны дали один sha256.');
else for (const g of div) for (const d of g.diverging) {
  L.push(`* \`${blockOf(g.key)}\` пара ${d.pair.join(' / ')}: framemd5 ${d.framemd5.equal ? 'совпал' : `разошёлся с кадра ${d.framemd5.firstDiffFrame}`}; PSNR: различающихся кадров ${d.psnr.differingFrames ?? '—'} из ${d.psnr.frames ?? '—'}, медиана ${num(d.psnr.psnrP50Db)} dB, минимум ${num(d.psnr.psnrMinDb)} dB.`);
}
L.push('');

L.push('## 4. ВЧ-энергия кадра 150 по всем прогонам', '');
L.push(`Метод — SP-3d §1.2: средний модуль разности соседних пикселей по яркости на кропе ${energy.crop.w}×${energy.crop.h} в точке (${energy.crop.x}, ${energy.crop.y}) — на градиентной заливке линейного графика.`, '');
const byLevel = new Map();
for (const r of energy.rows) {
  if (r.energy === null) continue;
  if (!byLevel.has(r.energy)) byLevel.set(r.energy, []);
  byLevel.get(r.energy).push(r.file.replace('.mp4', ''));
}
L.push('| ВЧ-энергия | прогонов | какие |', '|---|---|---|');
for (const [lvl, files] of [...byLevel.entries()].sort((a, b) => a[0] - b[0])) {
  L.push(`| ${lvl} | ${files.length} | ${files.slice(0, 6).join(', ')}${files.length > 6 ? ` … (+${files.length - 6})` : ''} |`);
}
L.push('');

L.push('## 5. Штампы потока (ffprobe) — один на рендерер', '');
L.push('| рендерер | codec | profile | pix_fmt | размер | r_frame_rate | time_base | color_space | GOP |', '|---|---|---|---|---|---|---|---|---|');
for (const rend of ['remotion', 'hyperframes']) {
  const r = runs.find((x) => x.renderer === rend && x.status === 'OK');
  if (!r) continue;
  const f = r.verification.ffprobe.fingerprint;
  L.push(`| ${rend} | ${f.codec} | ${f.profile} | ${f.pixFmt} | ${f.width}×${f.height} | ${f.rFrameRate} | ${f.timeBase} | ${f.colorSpace ?? '—'} | ${r.verification.keyframes.gopSizes.join('/')} |`);
}
L.push('');

L.push('## 6. Хост', '');
if (hostload.length) {
  const la = hostload.map((h) => Number(String(h.loadavg).split(' ')[0]));
  const mem = hostload.map((h) => h.memAvailableKb / 1024 / 1024);
  L.push(`Журнал \`results/hostload.jsonl\`: ${hostload.length} замеров, loadavg(1 мин) от ${num(Math.min(...la))} до ${num(Math.max(...la))} при медиане ${num(med(la))}; MemAvailable медианно ${num(med(mem))} GiB, минимум ${num(Math.min(...mem))} GiB.`);
}
const laStart = runs.filter((r) => r.stateAtStart?.loadAvg).map((r) => r.stateAtStart.loadAvg[0]);
if (laStart.length) L.push('', `loadavg(1 мин) по снимкам на старте прогонов: от ${num(Math.min(...laStart))} до ${num(Math.max(...laStart))}, медиана ${num(med(laStart))} при ${machine.hardware?.cpuLogical ?? '?'} потоках.`);
L.push('');

fs.writeFileSync(path.join(ROOT, 'results/summary.md'), L.join('\n') + '\n');
console.log('results/summary.md собран');
