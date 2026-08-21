/**
 * SP-3c: проверка V9 «во время рендера нет сети» механикой ОС, а не декларацией.
 * Тот же приём, что в SP-3 netcheck.mjs: сетевой namespace без интерфейсов, кроме
 * поднятого loopback (loopback обязателен — HyperFrames раздаёт композицию через
 * локальный HTTP-сервер, fileServer.js). Негативный контроль обязателен: без него
 * «рендер прошёл» не доказывает ничего — может быть, namespace не применился.
 */
import {execFile} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {ROOT, BIN, HF_CLI} from './lib/env.mjs';
import {getVersions} from './lib/versions.mjs';
import {snapshotState} from '../sp3/lib/sysinfo.mjs';

const pexecFile = promisify(execFile);
const RAW = path.join(ROOT, 'results/raw');
fs.mkdirSync(RAW, {recursive: true});

const doc = {
  schema: 'sp3c-network/1',
  capturedAt: new Date().toISOString(),
  versions: getVersions(),
  state: snapshotState(),
  checks: [],
};
const outFile = path.join(RAW, 'network-isolation.json');
const flush = () => fs.writeFileSync(outFile, JSON.stringify(doc, null, 2) + '\n');
flush();

const inNetns = async (shellCommand, {timeoutMs = 900000} = {}) => {
  const args = ['-rn', '--map-root-user', 'sh', '-c', `ip link set lo up; ${shellCommand}`];
  const t = Date.now();
  try {
    const {stdout, stderr} = await pexecFile('unshare', args, {
      cwd: ROOT,
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
      env: {
        ...process.env,
        PATH: `${BIN}:${process.env.PATH}`,
        TZ: 'UTC',
        LC_ALL: 'C',
        HYPERFRAMES_NO_TELEMETRY: '1',
        HYPERFRAMES_NO_UPDATE_CHECK: '1',
        HYPERFRAMES_NO_FEEDBACK: '1',
        HYPERFRAMES_SKIP_SKILLS: '1',
      },
    });
    return {ok: true, ms: Date.now() - t, stdout: stdout.slice(-3000), stderr: stderr.slice(-3000), command: `unshare ${args.join(' ')}`};
  } catch (err) {
    return {
      ok: false,
      ms: Date.now() - t,
      code: err.code ?? null,
      stdout: String(err.stdout ?? '').slice(-3000),
      stderr: String(err.stderr ?? err.message).slice(-3000),
      command: `unshare ${args.join(' ')}`,
    };
  }
};

// 1. Негативный контроль: сеть внутри namespace обязана быть недоступна.
const probe = await inNetns(
  `${process.execPath} -e "fetch('https://registry.npmjs.org/hyperframes',{signal:AbortSignal.timeout(8000)}).then(r=>{console.log('NETWORK-REACHABLE',r.status);process.exit(0)}).catch(e=>{console.log('NETWORK-BLOCKED',e.name);process.exit(3)})"`,
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

// 2. Полный рендер внутри того же namespace.
const outPath = path.join(ROOT, 'out/netns-render.mp4');
fs.rmSync(outPath, {force: true});
const render = await inNetns(
  `${process.execPath} ${HF_CLI} render src -o ${outPath} --workers 2 --quality standard --format mp4 --fps 30 --browser-gpu --quiet`,
);
doc.checks.push({
  id: 'render-without-network',
  title: 'Полный рендер 300 кадров без единого сетевого интерфейса, кроме loopback',
  expected: 'рендер обязан пройти полностью',
  passed: render.ok && fs.existsSync(outPath) && fs.statSync(outPath).size > 0,
  outputBytes: fs.existsSync(outPath) ? fs.statSync(outPath).size : null,
  raw: render,
});
flush();

// 3. Тот же рендер снаружи namespace — сверить, что кадры те же.
//    (Если бы рендерер что-то дотягивал из сети, результат отличался бы.)
doc.checks.push({
  id: 'netns-output-matches',
  title: 'sha256 mp4 из namespace против эталона матрицы',
  expected: 'совпадение с hfA-final-w2-gpu-r1',
  passed: null,
  note: 'сверяется в determinism.mjs/summary.mjs по results/raw',
});
doc.verdict = doc.checks.filter((c) => c.passed !== null).every((c) => c.passed)
  ? 'V9 подтверждён механикой: сеть недоступна, рендер проходит'
  : 'проверка НЕ пройдена — см. checks';
flush();
for (const c of doc.checks) console.log(`${c.passed === null ? '·' : c.passed ? '✓' : '✗'} ${c.title}`);
console.log(doc.verdict);
