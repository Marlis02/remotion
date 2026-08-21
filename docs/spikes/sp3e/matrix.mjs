/**
 * SP-3e: драйвер матрицы. Один прогон — один процесс, таймаут на прогон,
 * упавший прогон не останавливает остальные, каждое событие — строка в
 * results/progress.jsonl. Порядок блоков — приоритетный: M-R, M-H, затем c1/w1.
 */
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from './lib/env.mjs';

const JOBS = JSON.parse(fs.readFileSync(path.join(ROOT, process.argv[2]), 'utf8'));
const LOG = path.join(ROOT, 'results/progress.jsonl');
const append = (o) => fs.appendFileSync(LOG, JSON.stringify(o) + '\n');
const TIMEOUT_MS = Number(process.env.SP3E_TIMEOUT_MS ?? 420000);
const DEADLINE = process.env.SP3E_DEADLINE ? Number(process.env.SP3E_DEADLINE) : null;

for (const job of JOBS) {
  if (DEADLINE && Date.now() > DEADLINE) {
    append({t: new Date().toISOString(), event: 'deadline', skipped: job.runId});
    console.log(`ДЕДЛАЙН — пропускаю ${job.runId}`);
    continue;
  }
  const script = job.renderer === 'remotion' ? 'run-remotion.mjs' : 'run-hf.mjs';
  const cfg = {...job, outputPath: `out/${job.runId}.mp4`, resultPath: `results/raw/${job.runId}.json`};
  const t0 = Date.now();
  append({t: new Date().toISOString(), event: 'start', runId: job.runId, renderer: job.renderer});
  const code = await new Promise((r) => {
    const ch = spawn(process.execPath, [path.join(ROOT, script), JSON.stringify(cfg)], {cwd: ROOT, stdio: 'ignore'});
    const to = setTimeout(() => ch.kill('SIGKILL'), TIMEOUT_MS);
    ch.on('close', (c) => { clearTimeout(to); r(c); });
    ch.on('error', () => { clearTimeout(to); r(-1); });
  });
  let sha = null; let fps = null; let status = 'FAILED';
  try {
    const res = JSON.parse(fs.readFileSync(path.join(ROOT, cfg.resultPath), 'utf8'));
    status = res.status;
    sha = res.verification?.outputSha256 ?? null;
    fps = res.derived?.framesPerSecond_renderPhase ?? null;
  } catch { /* результат не написан — прогон упал до записи */ }
  const line = {t: new Date().toISOString(), event: 'done', runId: job.runId, renderer: job.renderer,
    status, exitCode: code, wallSec: Math.round((Date.now() - t0) / 100) / 10, fpsRenderPhase: fps, sha256: sha?.slice(0, 16) ?? null};
  append(line);
  console.log(`${job.runId}\t${status}\t${line.wallSec}s\tfps=${fps}\tsha=${line.sha256}`);
}
console.log('матрица закончена');
