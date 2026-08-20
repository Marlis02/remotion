/**
 * SP-3, долг №4 из results/findings.md §4: «angle при c=1/c=2».
 *
 * Зачем. Блоки G, H, I сняты только при concurrency=4: на `angle` три прогона PNG и три
 * прогона готового mp4 дали побайтово равный результат, включая прогоны на занятой машине.
 * Владелец выбирает вариант 1 из findings.md §2 (переход на `gl: angle`), а значит вопрос
 * «а при других concurrency?» перестаёт быть любопытством: `concurrency` — поле профиля,
 * и если оно меняет кадры, то AC4 держится не за `gl`, а за пару (gl, concurrency).
 *
 * Что делает:
 *   блок J — angle/final/concurrency=1, три прогона mp4 подряд;
 *   блок K — angle/final/concurrency=2, три прогона mp4 подряд;
 *   блок L — PNG-сиквенс без энкода, по одному прогону на каждую из двух конфигураций
 *            (как блоки C–F: если mp4 разойдутся, PNG говорят, кто виноват — растеризация
 *            или энкодер);
 *   сверка между настройками: c=1 против c=2 против уже снятого c=4 (`angle-4-final`,
 *            подтверждён блоками H и I — семь совпавших прогонов).
 *
 * Почему отдельным файлом, а не правкой mp4-repeat.mjs/png-c1-repeat.mjs: decisions.md п. 17.
 * Закоммиченный код обязан быть равен коду, которым получены уже снятые числа.
 *
 * Результат: results/raw/angle-determinism-c1-c2.json (+ строки в results/summary.md,
 * + строки прогресса в results/PROGRESS.md).
 *
 * Флаги:
 *   --concurrency=1,2   какие настройки проверять
 *   --repeats=3         сколько прогонов mp4 на настройку
 *   --wait-ac=900       сколько секунд ждать питания от сети, прежде чем сдаться
 *   --allow-battery     не требовать сети (прогон будет помечен как снятый от батареи)
 *   --keep-png=yes|no   оставить PNG-сиквенсы в out/ (по умолчанию — оставить)
 *   --timeout=1500      таймаут одного прогона, секунды
 */
import {spawn} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  framemd5,
  compareFramemd5,
  ffprobe,
  keyframes,
  psnrBetweenFiles,
  psnrBetweenPngDirs,
  psnrDistribution,
  sha256File,
} from './lib/media.mjs';
import {PROFILES} from './lib/profiles.mjs';
import {startMemorySampler} from './lib/proctree.mjs';
import {ROOT, getVersions, getPower, snapshotState} from './lib/sysinfo.mjs';
import {writeSummary} from './lib/summary.mjs';

const flag = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const hasFlag = (name) => process.argv.includes(`--${name}`);

const GL = 'angle';
const PROFILE = 'final';
const CONCURRENCIES = flag('concurrency', '1,2').split(',').map(Number);
const REPEATS = Number(flag('repeats', '3'));
const WAIT_AC_SEC = Number(flag('wait-ac', '900'));
const ALLOW_BATTERY = hasFlag('allow-battery');
const KEEP_PNG = flag('keep-png', 'yes') === 'yes';
const RUN_TIMEOUT_MS = Number(flag('timeout', '1500')) * 1000;

const RAW = path.join(ROOT, 'results/raw');
const MD5 = path.join(ROOT, 'results/framemd5');
const OUT = path.join(ROOT, 'out');
const DOC_PATH = path.join(RAW, 'angle-determinism-c1-c2.json');
const PROGRESS_MD = path.join(ROOT, 'results/PROGRESS.md');
const PROGRESS_JSONL = path.join(ROOT, 'results/progress.jsonl');
for (const d of [RAW, MD5, OUT]) fs.mkdirSync(d, {recursive: true});

/** Блок на настройку: буква продолжает нумерацию исходного спайка (A–I уже заняты). */
const blockIdOf = (c) => ({1: 'J', 2: 'K', 4: 'M'}[c] ?? `C${c}`);

// ── прогресс: одна строка и в чат, и в results/PROGRESS.md ───────────────────────────────
const hhmm = () => new Date().toISOString().slice(11, 19);
const say = (line) => {
  console.log(line);
  fs.appendFileSync(PROGRESS_MD, `- \`${hhmm()}\` ${line}\n`);
};
const note = (line) => {
  console.log(line);
  fs.appendFileSync(PROGRESS_MD, `  ${line}\n`);
};
const mmss = (ms) => {
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}м ${String(s % 60).padStart(2, '0')}с` : `${s}с`;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── план прогонов и оценка времени ───────────────────────────────────────────────────────
// Оценки — из уже снятой матрицы (results/summary.md): wall-time прогона плюс ~5 с на
// framemd5+ffprobe+keyframes. Пересчитываются по ходу: после каждого шага известен
// фактический масштаб этой машины на сегодня.
const ESTIMATE_MS = {
  'mp4-1': 36000,
  'mp4-2': 28000,
  'mp4-4': 25000,
  'png-1': 90000,
  'png-2': 60000,
  'png-4': 42000,
};
const estKey = (s) => `${s.kind}-${s.c}`;
const estOf = (s) => ESTIMATE_MS[estKey(s)] ?? 45000;

const STEPS = [];
for (const c of CONCURRENCIES) for (let i = 1; i <= REPEATS; i++) STEPS.push({kind: 'mp4', c, i});
for (const c of CONCURRENCIES) STEPS.push({kind: 'png', c, i: 1});
const TOTAL_STEPS = STEPS.length;
let stepNo = 0;
let scale = 1; // фактическое время / оценка, по уже сделанным шагам
const actuals = [];
const remainingMs = () => STEPS.slice(stepNo).reduce((a, s) => a + estOf(s) * scale, 0);
const remainingText = () => {
  const m = remainingMs() / 60000;
  if (m < 0.5) return 'это последний шаг';
  return `осталось ~${m < 1.5 ? '1' : Math.round(m)} мин`;
};
const stepLabel = (s) =>
  s.kind === 'mp4'
    ? `${GL}/${PROFILE}/c=${s.c}, прогон ${s.i} из ${REPEATS}`
    : `${GL}/${PROFILE}/c=${s.c}, PNG-сиквенс без энкода`;

// ── питание: долг 1 снимается от сети ────────────────────────────────────────────────────
const requireMains = async () => {
  const p0 = getPower();
  if (p0.acOnline === true) {
    say(`Питание: от сети (батарея ${p0.batteryStatus}, ${p0.batteryCapacity} %). Стартую.`);
    return {power: p0, waitedMs: 0, deviation: null};
  }
  if (ALLOW_BATTERY) {
    say(
      `⚠ Питание: от БАТАРЕИ (${p0.batteryStatus}, ${p0.batteryCapacity} %), запущено с --allow-battery. ` +
        `Эталон c=4 снят от сети — расхождение между настройками будет неотличимо от влияния питания.`,
    );
    return {power: p0, waitedMs: 0, deviation: 'прогон снят от батареи (--allow-battery), эталон c=4 — от сети'};
  }
  say(
    `⏸ Ноутбук на батарее (${p0.batteryStatus}, ${p0.batteryCapacity} %). Долг 1 снимается ОТ СЕТИ — ` +
      `воткни шнур, прогон стартует сам (жду до ${Math.round(WAIT_AC_SEC / 60)} мин).`,
  );
  const t0 = Date.now();
  let lastBeat = 0;
  while ((Date.now() - t0) / 1000 < WAIT_AC_SEC) {
    await sleep(3000);
    const p = getPower();
    if (p.acOnline === true) {
      const waitedMs = Date.now() - t0;
      say(`✓ Сеть появилась через ${mmss(waitedMs)} (батарея ${p.batteryStatus}, ${p.batteryCapacity} %). Стартую.`);
      return {power: p, waitedMs, deviation: null};
    }
    const elapsed = Math.floor((Date.now() - t0) / 1000);
    if (elapsed - lastBeat >= 30) {
      lastBeat = elapsed;
      note(`… жду шнур, прошло ${mmss(elapsed * 1000)}`);
    }
  }
  say(`✗ Сеть не появилась за ${Math.round(WAIT_AC_SEC / 60)} мин. Ничего не рендерил, файлы не тронуты.`);
  say('   Воткни шнур и запусти снова, либо запусти с --allow-battery.');
  process.exit(2);
};

// ── хэш каталога PNG. Скопирован ДОСЛОВНО из png-c1-repeat.mjs ───────────────────────────
// Иначе dirHash этого прогона нельзя сравнить с dirHash блока G, а именно ради сравнения
// с c=4 всё и делается. Правка png-c1-repeat.mjs запрещена decisions.md п. 17.
const hashPngDir = (dir) => {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
  const perFile = files.map((f) => ({
    file: f,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, f))).digest('hex'),
  }));
  const h = crypto.createHash('sha256');
  for (const e of perFile) h.update(`${e.file} ${e.sha256}\n`);
  return {dirHash: h.digest('hex'), count: files.length, perFile};
};

// ── документ результата ──────────────────────────────────────────────────────────────────
const readJson = (f) => {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
};

const refRun = readJson(path.join(RAW, 'angle-4-final.json'));
const detDoc = readJson(path.join(RAW, 'determinism.json'));
const blockG = (detDoc?.blocks ?? []).find((b) => b.id === 'G');
const blocksHI = (detDoc?.blocks ?? []).filter((b) => b.id === 'H' || b.id === 'I');

if (!refRun?.verification?.outputSha256) {
  console.error('Нет эталона: results/raw/angle-4-final.json без verification.outputSha256');
  process.exit(1);
}

const reference = {
  runId: refRun.runId,
  source: 'results/raw/angle-4-final.json (матрица), подтверждён блоками H и I в results/raw/determinism.json',
  takenAt: refRun.startedAt,
  powerAtRun: refRun.stateAtStart?.power ?? null,
  config: {gl: refRun.config.gl, concurrency: refRun.config.concurrency, profile: refRun.config.profile},
  mp4Sha256: refRun.verification.outputSha256,
  framemd5Sha256: refRun.verification.framemd5.sha256,
  framemd5File: refRun.verification.framemd5.file,
  mp4Present: fs.existsSync(path.join(OUT, `${refRun.runId}.mp4`)),
  pngDirHash: blockG?.runs?.[0]?.pngDirHash ?? null,
  pngFramemd5File: blockG?.runs?.[0]?.framemd5?.file ?? null,
  confirmingRuns: blocksHI.flatMap((b) => (b.runs ?? []).map((r) => ({runId: r.runId, mp4Sha256: r.outputSha256}))),
  fpsRenderPhase: refRun.derived?.framesPerSecond_renderPhase ?? null,
};

const doc = {
  schema: 'sp3-angle-c1c2/1',
  capturedAt: new Date().toISOString(),
  question:
    'Детерминирован ли gl=angle при concurrency 1 и 2 — внутри настройки и между настройками (c=1 против c=2 против уже снятого c=4)?',
  debt: 'results/findings.md §4, строка «angle при c=1/c=2»',
  status: 'RUNNING',
  parameters: {gl: GL, profile: PROFILE, concurrencies: CONCURRENCIES, repeats: REPEATS, keepPng: KEEP_PNG},
  versions: getVersions(),
  reference,
  power: null,
  stateAtStart: null,
  blocks: [],
  crossConfig: {mp4: [], png: []},
  verdict: null,
  deviations: [],
  notes: [],
};
const flush = () => {
  fs.writeFileSync(DOC_PATH, JSON.stringify(doc, null, 2) + '\n');
  try {
    writeSummary();
  } catch {
    /* пересоберётся позже */
  }
};

const appendJsonl = (obj) =>
  fs.appendFileSync(PROGRESS_JSONL, JSON.stringify({at: new Date().toISOString(), ...obj}) + '\n');

// ── один прогон runner.mjs ───────────────────────────────────────────────────────────────
const spawnRunner = async (cfg) => {
  const argv = [path.join(ROOT, 'runner.mjs'), JSON.stringify(cfg)];
  const t = Date.now();
  const child = spawn(process.execPath, argv, {cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe']});
  const sampler = startMemorySampler(child.pid, {intervalMs: 200});
  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d.toString()));
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }, RUN_TIMEOUT_MS);
  const code = await new Promise((r) => {
    child.on('close', (c) => r(c));
    child.on('error', () => r(-1));
  });
  clearTimeout(timer);
  return {
    code,
    timedOut,
    wallMs: Date.now() - t,
    memory: sampler.stop(),
    stderr: stderr.slice(-2000),
    commandLine: `node runner.mjs '${JSON.stringify(cfg)}'`,
  };
};

// ── блоки J/K: mp4, REPEATS прогонов подряд ──────────────────────────────────────────────
const runMp4Block = async (c) => {
  const id = blockIdOf(c);
  const block = {
    id,
    kind: 'mp4-repeat',
    concurrency: c,
    title: `mp4, ${REPEATS} прогона подряд: gl=${GL}, профиль ${PROFILE}, concurrency ${c}`,
    configText:
      `профиль ${PROFILE} (scale ${PROFILES[PROFILE].scale}, crf ${PROFILES[PROFILE].crf}, imageFormat ` +
      `${PROFILES[PROFILE].imageFormat}, encoder threads ${PROFILES[PROFILE].encoderThreads}), gl=${GL}, ` +
      `concurrency=${c}, ${REPEATS} прогона подряд`,
    runs: [],
    comparisons: [],
    verdict: 'в процессе',
    notes: [],
  };
  doc.blocks.push(block);
  flush();

  for (let i = 1; i <= REPEATS; i++) {
    const step = STEPS[stepNo];
    stepNo += 1;
    const runId = `det-${id}-${GL}-${c}-${PROFILE}-r${i}`;
    const outputPath = path.join(OUT, `${runId}.mp4`);
    fs.rmSync(outputPath, {force: true});
    const cfg = {
      runId,
      gl: GL,
      concurrency: c,
      profile: PROFILE,
      mode: 'media',
      bundleMode: 'warm',
      outputPath,
      resultPath: path.join(OUT, `${runId}.json`),
    };
    say(
      `[${stepNo}/${TOTAL_STEPS}] ${stepLabel(step)} — старт, ожидаю ~${Math.max(1, Math.round((estOf(step) * scale) / 60000))} мин`,
    );
    const powerBefore = getPower();
    const r = await spawnRunner(cfg);
    const powerAfter = getPower();
    actuals.push({est: estOf(step), actual: r.wallMs});
    scale = actuals.reduce((a, x) => a + x.actual, 0) / actuals.reduce((a, x) => a + x.est, 0);

    if (r.code !== 0 || r.timedOut || !fs.existsSync(outputPath)) {
      block.runs.push({
        runId,
        status: 'FAILED',
        commandLine: r.commandLine,
        wallMs: r.wallMs,
        error: r.timedOut ? `таймаут ${RUN_TIMEOUT_MS} мс` : `runner вышел с кодом ${r.code}`,
        stderr: r.stderr,
      });
      block.verdict = `FAILED — прогон ${runId} не состоялся`;
      doc.deviations.push(`${runId}: FAILED (${r.timedOut ? 'таймаут' : `код ${r.code}`})`);
      say(`[${stepNo}/${TOTAL_STEPS}] ✗ FAILED за ${mmss(r.wallMs)} — ${block.verdict}`);
      appendJsonl({runId, status: 'FAILED', wallMs: r.wallMs});
      flush();
      continue;
    }

    const runnerRecord = readJson(cfg.resultPath) ?? {};
    const md5Path = path.join(MD5, `${runId}.framemd5`);
    const fm = await framemd5(outputPath, md5Path);
    const rec = {
      runId,
      status: 'OK',
      commandLine: r.commandLine,
      wallMs: r.wallMs,
      peakRssSumMb: r.memory.peakRssSumMb,
      peakPssSumMb: r.memory.peakPssSumMb,
      fps: runnerRecord.render?.fps ?? null,
      timings: runnerRecord.timings ?? null,
      powerBefore,
      powerAfter,
      cpuTempCBefore: runnerRecord.stateAtStart?.cpuTempC ?? null,
      cpuTempCAfter: runnerRecord.stateAtEnd?.cpuTempC ?? null,
      loadAvgBefore: runnerRecord.stateAtStart?.loadAvg ?? null,
      outputSha256: sha256File(outputPath),
      outputBytes: fs.statSync(outputPath).size,
      framemd5: {...fm, file: path.relative(ROOT, md5Path)},
      ffprobe: (await ffprobe(outputPath)).fingerprint,
      keyframes: await keyframes(outputPath),
    };
    block.runs.push(rec);

    // Сравнение с уже сделанными прогонами этого же блока: ответ на «повторяемость».
    const prevOk = block.runs.filter((x) => x.status === 'OK' && x.runId !== runId);
    let sameAs = null;
    for (const p of prevOk) {
      if (p.outputSha256 === rec.outputSha256) {
        sameAs = p.runId;
        break;
      }
    }
    const vsRef = rec.outputSha256 === reference.mp4Sha256;
    const tail =
      prevOk.length === 0
        ? `sha256=${rec.outputSha256.slice(0, 16)} | ${vsRef ? 'совпал с эталоном c=4' : 'НЕ совпал с эталоном c=4'}`
        : sameAs
          ? `sha256 совпал с прогоном ${sameAs.slice(-2)} | ${vsRef ? 'и с эталоном c=4' : 'но НЕ с эталоном c=4'}`
          : `⚠ sha256 НЕ совпал с прогоном 1 (${rec.outputSha256.slice(0, 16)} против ${prevOk[0].outputSha256.slice(0, 16)})`;
    say(`[${stepNo}/${TOTAL_STEPS}] готово за ${mmss(r.wallMs)} — ${tail} | ${remainingText()}`);
    appendJsonl({runId, status: 'OK', wallMs: r.wallMs, fps: rec.fps?.renderPhase ?? null, sha256: rec.outputSha256});
    flush();
  }

  // Все пары внутри блока: r1×r2, r1×r3, r2×r3.
  const ok = block.runs.filter((r) => r.status === 'OK');
  for (let a = 0; a < ok.length; a++) {
    for (let b = a + 1; b < ok.length; b++) {
      const cmp = compareFramemd5(path.join(ROOT, ok[a].framemd5.file), path.join(ROOT, ok[b].framemd5.file));
      const entry = {
        a: ok[a].runId,
        b: ok[b].runId,
        framemd5Equal: cmp.equal,
        firstDiffFrame: cmp.firstDiffFrame,
        framesCompared: cmp.framesCompared,
        byteIdenticalMp4: ok[a].outputSha256 === ok[b].outputSha256,
        verdict: cmp.equal ? 'совпало' : `разошлось на кадре ${cmp.firstDiffFrame}`,
      };
      if (!cmp.equal) {
        const psnr = await psnrBetweenFiles(
          path.join(OUT, `${ok[a].runId}.mp4`),
          path.join(OUT, `${ok[b].runId}.mp4`),
          path.join(OUT, `det-${id}.psnr`),
        );
        entry.distribution = psnrDistribution(psnr.frames);
      }
      block.comparisons.push(entry);
    }
  }
  const allFrames = block.comparisons.every((x) => x.framemd5Equal);
  const allBytes = block.comparisons.every((x) => x.byteIdenticalMp4);
  block.stableWithinConfig = ok.length >= 2 && allFrames && allBytes;
  block.verdict =
    ok.length < 2
      ? `недостаточно успешных прогонов (${ok.length})`
      : allFrames && allBytes
        ? `совпало (${ok.length} прогона, ${block.comparisons[0]?.framesCompared ?? 0} кадров, mp4 побайтово равны)`
        : allFrames
          ? `декодированные кадры совпали, но контейнер/битстрим различаются`
          : `разошлось на кадре ${block.comparisons.find((x) => !x.framemd5Equal)?.firstDiffFrame}`;
  block.notes.push(`побайтовое равенство самих mp4: ${allBytes ? 'да' : 'нет'}`);
  block.table = [
    '| прогон | wall, с | кадров/с | sha256(mp4) | sha256(framemd5) | батарея до → после |',
    '|---|---|---|---|---|---|',
    ...ok.map(
      (r) =>
        `| ${r.runId} | ${(r.wallMs / 1000).toFixed(1)} | ${r.fps?.renderPhase ?? '—'} | \`${r.outputSha256.slice(0, 16)}\` | ` +
        `\`${r.framemd5.sha256.slice(0, 16)}\` | ${r.powerBefore?.batteryCapacity ?? '—'} % → ${r.powerAfter?.batteryCapacity ?? '—'} % (${r.powerAfter?.source ?? '—'}) |`,
    ),
  ];
  flush();
  return block;
};

// ── блок L: PNG-сиквенс без энкода, по одному прогону на настройку ───────────────────────
const runPngBlock = async () => {
  const block = {
    id: 'L',
    kind: 'png-cross-concurrency',
    title: `PNG-сиквенс без энкода, gl=${GL}: по одному прогону на concurrency ${CONCURRENCIES.join(' и ')}`,
    configText:
      `renderFrames(imageFormat=png), профиль ${PROFILE} (scale ${PROFILES[PROFILE].scale}), gl=${GL}, ` +
      `concurrency ${CONCURRENCIES.join(' и ')}, по одному прогону; эталон c=4 — блок G исходного спайка`,
    runs: [],
    comparisons: [],
    verdict: 'в процессе',
    notes: [
      'Смысл блока: если mp4 разойдутся, PNG отделяют растеризацию Chrome от энкодера — как блоки C–F.',
    ],
  };
  doc.blocks.push(block);
  flush();

  const dirs = [];
  for (const c of CONCURRENCIES) {
    const step = STEPS[stepNo];
    stepNo += 1;
    const runId = `det-L-png-${GL}-c${c}`;
    const framesOutDir = path.join(OUT, `frames-L-c${c}`);
    const cfg = {
      runId,
      gl: GL,
      concurrency: c,
      profile: PROFILE,
      mode: 'frames',
      bundleMode: 'warm',
      framesOutDir,
      resultPath: path.join(OUT, `${runId}.json`),
    };
    say(
      `[${stepNo}/${TOTAL_STEPS}] ${stepLabel(step)} — старт, ожидаю ~${Math.max(1, Math.round((estOf(step) * scale) / 60000))} мин`,
    );
    const powerBefore = getPower();
    const r = await spawnRunner(cfg);
    const powerAfter = getPower();
    actuals.push({est: estOf(step), actual: r.wallMs});
    scale = actuals.reduce((a, x) => a + x.actual, 0) / actuals.reduce((a, x) => a + x.est, 0);

    if (r.code !== 0 || r.timedOut || !fs.existsSync(framesOutDir)) {
      block.runs.push({
        runId,
        concurrency: c,
        status: 'FAILED',
        commandLine: r.commandLine,
        error: r.timedOut ? `таймаут ${RUN_TIMEOUT_MS} мс` : `runner вышел с кодом ${r.code}`,
        stderr: r.stderr,
      });
      doc.deviations.push(`${runId}: FAILED (${r.timedOut ? 'таймаут' : `код ${r.code}`})`);
      say(`[${stepNo}/${TOTAL_STEPS}] ✗ FAILED за ${mmss(r.wallMs)} | ${remainingText()}`);
      flush();
      continue;
    }

    const h = hashPngDir(framesOutDir);
    const md5Path = path.join(MD5, `${runId}.framemd5`);
    const fm = await framemd5(path.join(framesOutDir, '*.png'), md5Path, {
      extraInputArgs: ['-framerate', '30', '-pattern_type', 'glob'],
    });
    const bytes = fs
      .readdirSync(framesOutDir)
      .filter((f) => f.endsWith('.png'))
      .reduce((a, f) => a + fs.statSync(path.join(framesOutDir, f)).size, 0);
    const rec = {
      runId,
      concurrency: c,
      status: 'OK',
      commandLine: r.commandLine,
      wallMs: r.wallMs,
      peakRssSumMb: r.memory.peakRssSumMb,
      pngCount: h.count,
      pngTotalMb: Math.round(bytes / 1024 / 1024),
      pngDirHash: h.dirHash,
      pngDir: KEEP_PNG ? path.relative(ROOT, framesOutDir) : null,
      framemd5: {...fm, file: path.relative(ROOT, md5Path)},
      powerBefore,
      powerAfter,
      // Поимённые sha256 остаются в JSON: сами PNG в git не идут (results/.gitignore),
      // а проверить чужой прогон по ним можно и через год.
      perFileSha256: h.perFile,
    };
    block.runs.push(rec);
    dirs.push({runId, framesOutDir, hash: h, framemd5File: rec.framemd5.file, concurrency: c});
    const vsG = reference.pngDirHash ? (h.dirHash === reference.pngDirHash ? 'совпал с блоком G (c=4)' : 'НЕ совпал с блоком G (c=4)') : 'эталона PNG нет';
    say(`[${stepNo}/${TOTAL_STEPS}] готово за ${mmss(r.wallMs)} — ${h.count} PNG, dirHash=${h.dirHash.slice(0, 16)} | ${vsG} | ${remainingText()}`);
    flush();
  }

  // c=1 против c=2 (и любых прочих пар), плюс каждый против блока G (c=4).
  for (let a = 0; a < dirs.length; a++) {
    for (let b = a + 1; b < dirs.length; b++) {
      const n = Math.min(dirs[a].hash.perFile.length, dirs[b].hash.perFile.length);
      let firstDiff = null;
      let differing = 0;
      for (let k = 0; k < n; k++) {
        if (dirs[a].hash.perFile[k].sha256 !== dirs[b].hash.perFile[k].sha256) {
          differing += 1;
          if (firstDiff === null) firstDiff = k;
        }
      }
      const cmp = compareFramemd5(path.join(ROOT, dirs[a].framemd5File), path.join(ROOT, dirs[b].framemd5File));
      const entry = {
        a: dirs[a].runId,
        b: dirs[b].runId,
        pngBytesEqual: firstDiff === null,
        firstDiffPngIndex: firstDiff,
        differingPngCount: differing,
        totalPng: n,
        framemd5Equal: cmp.equal,
        firstDiffFrame: cmp.firstDiffFrame,
        verdict: firstDiff === null ? 'совпало' : `разошлось на кадре ${firstDiff}`,
      };
      if (firstDiff !== null) {
        entry.psnr = await psnrBetweenPngDirs(dirs[a].framesOutDir, dirs[b].framesOutDir, path.join(OUT, 'det-L.psnr'));
      }
      block.comparisons.push(entry);
    }
  }
  for (const d of dirs) {
    if (!reference.pngDirHash) continue;
    const entry = {
      a: d.runId,
      b: 'det-G-png-angle-c4-r1 (блок G, c=4)',
      pngDirHashEqual: d.hash.dirHash === reference.pngDirHash,
      verdict: d.hash.dirHash === reference.pngDirHash ? 'совпало' : 'dirHash различается',
    };
    if (reference.pngFramemd5File && fs.existsSync(path.join(ROOT, reference.pngFramemd5File))) {
      const cmp = compareFramemd5(path.join(ROOT, d.framemd5File), path.join(ROOT, reference.pngFramemd5File));
      entry.framemd5Equal = cmp.equal;
      entry.firstDiffFrame = cmp.firstDiffFrame;
      entry.framesCompared = cmp.framesCompared;
    }
    block.comparisons.push(entry);
  }

  const okDirs = block.runs.filter((r) => r.status === 'OK');
  const allPngEqual = block.comparisons.every((x) =>
    x.pngDirHashEqual !== undefined ? x.pngDirHashEqual : x.pngBytesEqual,
  );
  block.verdict =
    okDirs.length === 0
      ? 'FAILED — ни один прогон не состоялся'
      : allPngEqual
        ? `совпало (PNG-сиквенсы при concurrency ${okDirs.map((r) => r.concurrency).join(', ')} и при c=4 из блока G побайтово идентичны)`
        : `разошлось: ${block.comparisons.filter((x) => x.pngBytesEqual === false || x.pngDirHashEqual === false).map((x) => `${x.a} против ${x.b}`).join('; ')}`;
  block.notes.push(
    KEEP_PNG
      ? `PNG-сиквенсы оставлены на диске: ${okDirs.map((r) => r.pngDir).join(', ')} (в git не идут, out/ можно удалять)`
      : 'PNG-сиквенсы удалены после хэширования (--keep-png=no); поимённые sha256 остались в этом файле',
  );
  block.table = [
    '| прогон | concurrency | PNG | суммарно, МБ | dirHash | sha256(framemd5) |',
    '|---|---|---|---|---|---|',
    ...okDirs.map(
      (r) =>
        `| ${r.runId} | ${r.concurrency} | ${r.pngCount} | ${r.pngTotalMb} | \`${r.pngDirHash.slice(0, 16)}\` | \`${r.framemd5.sha256.slice(0, 16)}\` |`,
    ),
    ...(reference.pngDirHash
      ? [`| det-G-png-angle-c4-r1 (эталон, блок G) | 4 | 300 | — | \`${reference.pngDirHash.slice(0, 16)}\` | — |`]
      : []),
  ];
  if (!KEEP_PNG) for (const d of dirs) fs.rmSync(d.framesOutDir, {recursive: true, force: true});
  flush();
  return block;
};

// ── main ─────────────────────────────────────────────────────────────────────────────────
const main = async () => {
  fs.appendFileSync(
    PROGRESS_MD,
    `\n## Долг 1 — детерминизм angle при c=1 и c=2 · старт ${new Date().toISOString()}\n\n` +
      `План: ${TOTAL_STEPS} рендеров (${CONCURRENCIES.length}×${REPEATS} mp4 + ${CONCURRENCIES.length} PNG-сиквенс), ` +
      `оценка ~${Math.round(STEPS.reduce((a, s) => a + estOf(s), 0) / 60000)} мин. ` +
      `Эталон c=4: \`${reference.mp4Sha256.slice(0, 16)}\`, совпавших прогонов до этого замера: ${reference.confirmingRuns.length + 1}.\n\n`,
  );
  say(
    `План: ${TOTAL_STEPS} рендеров — ${CONCURRENCIES.map((c) => `c=${c}×${REPEATS} mp4`).join(', ')}, ` +
      `плюс по одному PNG-сиквенсу на настройку. Оценка ~${Math.round(STEPS.reduce((a, s) => a + estOf(s), 0) / 60000)} мин.`,
  );

  const power = await requireMains();
  doc.power = {atStart: power.power, waitedForMainsMs: power.waitedMs};
  if (power.deviation) doc.deviations.push(power.deviation);
  doc.stateAtStart = snapshotState();
  flush();

  const t0 = Date.now();
  const mp4Blocks = [];
  for (const c of CONCURRENCIES) mp4Blocks.push(await runMp4Block(c));
  const pngBlock = await runPngBlock();

  // ── сверка между настройками ───────────────────────────────────────────────────────────
  say('Сверяю c=1 против c=2 против эталона c=4…');
  const firstOkOf = (b) => (b.runs ?? []).find((r) => r.status === 'OK');
  const allOk = mp4Blocks.flatMap((b) => (b.runs ?? []).filter((r) => r.status === 'OK'));

  // Каждая настройка против каждой (берём первый успешный прогон настройки).
  for (let a = 0; a < mp4Blocks.length; a++) {
    for (let b = a + 1; b < mp4Blocks.length; b++) {
      const ra = firstOkOf(mp4Blocks[a]);
      const rb = firstOkOf(mp4Blocks[b]);
      if (!ra || !rb) continue;
      const cmp = compareFramemd5(path.join(ROOT, ra.framemd5.file), path.join(ROOT, rb.framemd5.file));
      const entry = {
        a: `c=${mp4Blocks[a].concurrency} (${ra.runId})`,
        b: `c=${mp4Blocks[b].concurrency} (${rb.runId})`,
        framemd5Equal: cmp.equal,
        firstDiffFrame: cmp.firstDiffFrame,
        framesCompared: cmp.framesCompared,
        byteIdenticalMp4: ra.outputSha256 === rb.outputSha256,
        verdict: cmp.equal ? 'совпало' : `разошлось на кадре ${cmp.firstDiffFrame}`,
      };
      if (!cmp.equal) {
        const psnr = await psnrBetweenFiles(
          path.join(OUT, `${ra.runId}.mp4`),
          path.join(OUT, `${rb.runId}.mp4`),
          path.join(OUT, 'det-cross.psnr'),
        );
        entry.distribution = psnrDistribution(psnr.frames);
      }
      doc.crossConfig.mp4.push(entry);
    }
  }
  // Каждая настройка против эталона c=4.
  for (const blk of mp4Blocks) {
    const r = firstOkOf(blk);
    if (!r) continue;
    const refFile = path.join(ROOT, reference.framemd5File);
    const entry = {
      a: `c=${blk.concurrency} (${r.runId})`,
      b: `c=4 (эталон ${reference.runId}, снят ${reference.takenAt})`,
      byteIdenticalMp4: r.outputSha256 === reference.mp4Sha256,
      framemd5Sha256Equal: r.framemd5.sha256 === reference.framemd5Sha256,
    };
    if (fs.existsSync(refFile)) {
      const cmp = compareFramemd5(path.join(ROOT, r.framemd5.file), refFile);
      entry.framemd5Equal = cmp.equal;
      entry.firstDiffFrame = cmp.firstDiffFrame;
      entry.framesCompared = cmp.framesCompared;
      entry.verdict = cmp.equal ? 'совпало' : `разошлось на кадре ${cmp.firstDiffFrame}`;
    } else {
      entry.verdict = entry.framemd5Sha256Equal ? 'совпало (по sha256 файла framemd5)' : 'разошлось (по sha256 файла framemd5)';
      doc.notes.push(`файл ${reference.framemd5File} отсутствует — сверка с эталоном сделана по sha256 самого framemd5`);
    }
    doc.crossConfig.mp4.push(entry);
  }
  // PNG между настройками и против блока G — уже посчитано внутри блока L.
  doc.crossConfig.png = (pngBlock.comparisons ?? []).map((x) => ({...x, psnr: x.psnr ?? null}));

  // ── вердикт ───────────────────────────────────────────────────────────────────────────
  const withinStable = mp4Blocks.map((b) => ({concurrency: b.concurrency, stable: b.stableWithinConfig === true, verdict: b.verdict}));
  const crossEqual = doc.crossConfig.mp4.every((x) => x.framemd5Equal === true && x.byteIdenticalMp4 === true);
  const allWithinStable = withinStable.every((x) => x.stable);
  const outcome = allWithinStable && crossEqual
    ? 'детерминирован везде'
    : allWithinStable
      ? 'стабилен внутри настройки, но между настройками различается'
      : 'расходится';
  const pngAgrees = pngBlock.verdict.startsWith('совпало');
  doc.verdict = {
    stableWithinEachConcurrency: allWithinStable,
    perConcurrency: withinStable,
    equalAcrossConcurrency: crossEqual,
    pngAgreesWithMp4Answer: pngAgrees,
    outcome,
    referenceMp4Sha256: reference.mp4Sha256,
    observedMp4Sha256: [...new Set(allOk.map((r) => r.outputSha256))],
    distinctMp4Variants: new Set(allOk.map((r) => r.outputSha256)).size,
    totalConfirmingRunsForThisSha256:
      allOk.filter((r) => r.outputSha256 === reference.mp4Sha256).length + 1 + reference.confirmingRuns.length,
  };
  doc.status = 'OK';
  doc.finishedAt = new Date().toISOString();
  doc.stateAtEnd = snapshotState();
  doc.totalWallMs = Date.now() - t0;
  flush();

  say(
    `Итог: ${outcome}. Внутри настроек — ${withinStable.map((x) => `c=${x.concurrency}: ${x.stable ? 'стабилен' : 'НЕТ'}`).join(', ')}; ` +
      `между настройками (c=1 / c=2 / c=4) — ${crossEqual ? 'хэши совпадают' : 'хэши РАЗЛИЧАЮТСЯ'}; ` +
      `PNG-сиквенсы: ${pngBlock.verdict}. Всего ${mmss(Date.now() - t0)}.`,
  );
  console.log(`\nЗаписано: ${path.relative(ROOT, DOC_PATH)}`);
};

await main();
