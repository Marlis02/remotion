/**
 * SP-3: проверка V9 «во время рендера нет сети» механикой ОС, а не декларацией.
 *
 * Прогон выполняется в сетевом namespace без единого интерфейса, кроме поднятого loopback
 * (loopback обязателен: Remotion отдаёт бандл через локальный HTTP-сервер).
 * Негативный контроль обязателен: без него «рендер прошёл» ничего не доказывает —
 * может быть, namespace не применился.
 */
import {execFile} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {ROOT, getVersions, snapshotState} from './lib/sysinfo.mjs';

const pexecFile = promisify(execFile);
const RAW = path.join(ROOT, 'results/raw');
const OUT = path.join(ROOT, 'out');
fs.mkdirSync(RAW, {recursive: true});

const doc = {
  schema: 'sp3-network/1',
  capturedAt: new Date().toISOString(),
  versions: getVersions(),
  state: snapshotState(),
  checks: [],
};
const outFile = path.join(RAW, 'network-isolation.json');
const flush = () => fs.writeFileSync(outFile, JSON.stringify(doc, null, 2) + '\n');
flush();

const inNetns = async (shellCommand, {timeoutMs = 600000} = {}) => {
  const args = ['-rn', '--map-root-user', 'sh', '-c', `ip link set lo up; ${shellCommand}`];
  const t = Date.now();
  try {
    const {stdout, stderr} = await pexecFile('unshare', args, {cwd: ROOT, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024});
    return {ok: true, ms: Date.now() - t, stdout: stdout.slice(-2000), stderr: stderr.slice(-2000), command: `unshare ${args.join(' ')}`};
  } catch (err) {
    return {
      ok: false,
      ms: Date.now() - t,
      code: err.code ?? null,
      stdout: String(err.stdout ?? '').slice(-2000),
      stderr: String(err.stderr ?? err.message).slice(-2000),
      command: `unshare ${args.join(' ')}`,
    };
  }
};

// 1. Негативный контроль: сеть внутри namespace обязана быть недоступна.
const probe = await inNetns(
  `${process.execPath} -e "fetch('https://registry.npmjs.org/remotion',{signal:AbortSignal.timeout(8000)}).then(r=>{console.log('NETWORK-REACHABLE',r.status);process.exit(0)}).catch(e=>{console.log('NETWORK-BLOCKED',e.name);process.exit(3)})"`,
  {timeoutMs: 30000},
);
doc.checks.push({
  id: 'negative-control',
  title: 'HTTPS-запрос наружу внутри сетевого namespace',
  expected: 'запрос обязан провалиться',
  passed: /NETWORK-BLOCKED/.test(probe.stdout) || (!probe.ok && !/NETWORK-REACHABLE/.test(probe.stdout)),
  raw: probe,
});
flush();

// 2. Рендер внутри того же namespace. Короткий: проверяется факт, а не скорость.
const cfg = {
  runId: 'netns-render',
  gl: 'swangle',
  concurrency: 2,
  profile: 'final',
  mode: 'media',
  bundleMode: 'warm',
  outputPath: path.join(OUT, 'netns-render.mp4'),
  resultPath: path.join(OUT, 'netns-render.json'),
  frameRange: [0, 59],
};
fs.rmSync(cfg.outputPath, {force: true});
const render = await inNetns(`${process.execPath} runner.mjs '${JSON.stringify(cfg)}'`);
let runnerRecord = null;
try {
  runnerRecord = JSON.parse(fs.readFileSync(cfg.resultPath, 'utf8'));
} catch {
  /* runner не дописал */
}
doc.checks.push({
  id: 'render-without-network',
  title: 'Рендер 60 кадров без единого сетевого интерфейса, кроме loopback',
  expected: 'рендер обязан пройти полностью',
  passed: render.ok && runnerRecord?.status === 'OK' && fs.existsSync(cfg.outputPath),
  runnerStatus: runnerRecord?.status ?? null,
  runnerTimings: runnerRecord?.timings ?? null,
  outputBytes: fs.existsSync(cfg.outputPath) ? fs.statSync(cfg.outputPath).size : null,
  commandLine: `node runner.mjs '${JSON.stringify(cfg)}'`,
  raw: render,
});
doc.verdict = doc.checks.every((c) => c.passed)
  ? 'V9 подтверждён механикой: сеть недоступна, рендер проходит'
  : 'проверка НЕ пройдена — см. checks';
flush();
for (const c of doc.checks) console.log(`${c.passed ? '✓' : '✗'} ${c.title}`);
console.log(doc.verdict);
