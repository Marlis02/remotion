/**
 * SP-3c (Q5): стоимость старта на сегмент — то, что входит в minSegmentDurationFrames.
 *
 * Считается из уже снятых прогонов (медианы по фазам) плюс два отдельных замера,
 * которых в прогонах нет: голый старт node и загрузка модулей CLI до первой работы.
 */
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {ROOT, HF_CLI, childEnv} from './lib/env.mjs';

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
  .filter((r) => r && r.schema === 'sp3c-run/1' && r.status === 'OK');

const median = (xs) => {
  const a = xs.filter((x) => typeof x === 'number').sort((x, y) => x - y);
  return a.length ? a[Math.floor(a.length / 2)] : null;
};
const phase = (t, name, status) => t.find((x) => x.phase === name && x.status === status);

const hf = runs.filter((r) => r.renderer === 'hyperframes' && r.runId.startsWith('hfA-'));
const rm = runs.filter((r) => r.renderer === 'remotion');

const timeIt = (fn, n = 5) => {
  const xs = [];
  for (let i = 0; i < n; i++) {
    const t = Date.now();
    fn();
    xs.push(Date.now() - t);
  }
  return median(xs);
};

const bareNode = timeIt(() => execFileSync(process.execPath, ['-e', '0'], {stdio: 'ignore'}));
const cliVersion = timeIt(() =>
  execFileSync(process.execPath, [HF_CLI, '--version'], {stdio: 'ignore', env: childEnv()}),
);

const doc = {
  schema: 'sp3c-startup/1',
  capturedAt: new Date().toISOString(),
  note:
    'Медианы по прогонам блока A (HyperFrames, beginFrame + аппаратный GPU) и по контрольным прогонам Remotion. ' +
    'Для Remotion колонки называются как в SP-3: бандл — тёплый, selectComposition — выбор композиции.',
  measurements: {
    'голый старт node (медиана 5)': bareNode,
    'hyperframes --version, то есть загрузка модулей CLI (медиана 5)': cliVersion,
    'HyperFrames: компиляция HTML (compile)': median(hf.map((r) => phase(r.trace ?? [], 'compile', 'end')?.durationMs)),
    'HyperFrames: проба браузера (browser_probe)': median(hf.map((r) => phase(r.trace ?? [], 'browser_probe', 'end')?.durationMs)),
    'HyperFrames: файловый сервер (file_server)': median(hf.map((r) => phase(r.trace ?? [], 'file_server', 'end')?.durationMs)),
    'HyperFrames: от старта конвейера до старта захвата': median(hf.map((r) => r.timings?.toCaptureStartMs)),
    'HyperFrames: СТАРТ НА СЕГМЕНТ (node + CLI + всё до первого кадра)': median(hf.map((r) => r.timings?.preRenderOverheadMs)),
    'HyperFrames: хвост после конвейера': median(hf.map((r) => r.timings?.postPipelineMs)),
    'HyperFrames: сборка (assemble)': median(hf.map((r) => r.timings?.assembleMs)),
    'Remotion (контроль здесь же): boot node': median(rm.map((r) => r.timings?.nodeBootMs)),
    'Remotion (контроль здесь же): тёплый бандл': median(rm.map((r) => r.timings?.bundleMs)),
    'Remotion (контроль здесь же): проба старта Chrome': median(rm.map((r) => r.timings?.chromeStartProbeMs)),
    'Remotion (контроль здесь же): выбор композиции': median(rm.map((r) => r.timings?.selectCompositionMs)),
    'Remotion (контроль здесь же): СТАРТ НА СЕГМЕНТ (до первого кадра)': median(rm.map((r) => r.timings?.preRenderOverheadMs)),
    'Remotion (контроль здесь же): хвост мукса': median(rm.map((r) => r.timings?.stitchTailMs)),
    'проверка framemd5 сегмента 300 кадров 1080×1920': median(runs.map((r) => r.verification?.framemd5?.ms)),
    'проверка ffprobe сегмента': median(runs.map((r) => r.verification?.ffprobe?.ms)),
  },
  sampleSizes: {hyperframesBlockA: hf.length, remotionControl: rm.length},
};
fs.writeFileSync(path.join(RAW, 'startup-cost.json'), JSON.stringify(doc, null, 2) + '\n');
for (const [k, v] of Object.entries(doc.measurements)) console.log(`${String(v).padStart(7)} мс  ${k}`);
