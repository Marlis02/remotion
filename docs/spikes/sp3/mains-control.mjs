/**
 * SP-3, долг из findings.md §4: «контрольный c=4 от сети сегодня».
 *
 * Зачем. Замер от батареи (results/raw/angle-battery.json) дал 15.99 кадра/с против 19.54 у
 * эталона `angle-4-final`, снятого от сети тремя часами раньше, — минус 18.1 %. Приписать эти
 * проценты батарее нельзя: сегодняшние прогоны ОТ СЕТИ при c=1 и c=2 (блоки J, K) тоже вышли
 * ниже матричных на 4–7.6 %. То есть в разрыве сидят два слагаемых — «эффект дня» (частоты на
 * powersave, состояние зарядки, тепловая история) и собственно питание, — и без контрольного
 * прогона от сети сегодня они не разделяются.
 *
 * Что делает: те же три прогона angle/final/c=4, но при воткнутом шнуре, сразу после замера от
 * батареи; затем раскладывает разрыв на два слагаемых.
 *
 * Ворота — зеркало battery-run.mjs: там скрипт отказывается работать ОТ СЕТИ, здесь — ОТ БАТАРЕИ.
 *
 * Результат: results/raw/angle-mains-control.json (+ раздел в results/summary.md).
 *
 * Флаги: --repeats=3  --timeout=1500  --keep-mp4=yes|no
 */
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {framemd5, compareFramemd5, ffprobe, sha256File} from './lib/media.mjs';
import {PROFILES} from './lib/profiles.mjs';
import {startMemorySampler} from './lib/proctree.mjs';
import {ROOT, getVersions, getPower, snapshotState} from './lib/sysinfo.mjs';
import {writeSummary} from './lib/summary.mjs';

const flag = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const GL = 'angle';
const PROFILE = 'final';
const CONCURRENCY = Number(flag('concurrency', '4'));
const REPEATS = Number(flag('repeats', '3'));
const KEEP_MP4 = flag('keep-mp4', 'yes') === 'yes';
const RUN_TIMEOUT_MS = Number(flag('timeout', '1500')) * 1000;

const RAW = path.join(ROOT, 'results/raw');
const MD5 = path.join(ROOT, 'results/framemd5');
const OUT = path.join(ROOT, 'out');
const DOC_PATH = path.join(RAW, 'angle-mains-control.json');
const PROGRESS_MD = path.join(ROOT, 'results/PROGRESS.md');
for (const d of [RAW, MD5, OUT]) fs.mkdirSync(d, {recursive: true});

const hhmm = () => new Date().toISOString().slice(11, 19);
const say = (line) => {
  console.log(line);
  try {
    fs.appendFileSync(PROGRESS_MD, `- \`${hhmm()}\` ${line}\n`);
  } catch {
    /* не обязателен */
  }
};
const mmss = (ms) => {
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}м ${String(s % 60).padStart(2, '0')}с` : `${s}с`;
};
const readJson = (f) => {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
};
const pct = (a, b) => (b ? Math.round(((a - b) / b) * 1000) / 10 : null);

// ── ворота: зеркало battery-run.mjs ──────────────────────────────────────────────────────
const power0 = getPower();
if (power0.acOnline !== true) {
  console.error('');
  console.error('  ✗ Ноутбук НЕ подключён к сети.');
  console.error(`    Сейчас: acOnline=${power0.acOnline}, батарея ${power0.batteryStatus}, ${power0.batteryCapacity} %.`);
  console.error('');
  console.error('    ВОТКНИ ШНУР И ЗАПУСТИ СНОВА.');
  console.error('');
  console.error('    Весь смысл этого замера — контроль ОТ СЕТИ для сравнения с angle-battery.json.');
  console.error('    Снятый от батареи, он повторил бы уже сделанное и ничего не разделил.');
  console.error('');
  process.exit(2);
}

const refRun = readJson(path.join(RAW, 'angle-4-final.json'));
const battery = readJson(path.join(RAW, 'angle-battery.json'));
if (!refRun?.verification?.outputSha256) {
  console.error('Нет эталона: results/raw/angle-4-final.json');
  process.exit(1);
}
const reference = {
  runId: refRun.runId,
  takenAt: refRun.startedAt,
  powerAtRun: refRun.stateAtStart?.power ?? null,
  cpuTempCAtRun: refRun.stateAtStart?.cpuTempC ?? null,
  mp4Sha256: refRun.verification.outputSha256,
  framemd5File: refRun.verification.framemd5.file,
  fpsRenderPhase: refRun.derived?.framesPerSecond_renderPhase ?? null,
};

const doc = {
  schema: 'sp3-mains-control/1',
  capturedAt: new Date().toISOString(),
  question:
    'Сколько из −18.1 % между прогоном от батареи и матричным эталоном приходится на батарею, а сколько — на «эффект дня»?',
  debt: 'results/findings.md §4, строка «контрольный c=4 от сети сегодня»',
  status: 'RUNNING',
  configText:
    `профиль ${PROFILE} (scale ${PROFILES[PROFILE].scale}, crf ${PROFILES[PROFILE].crf}, encoder threads ` +
    `${PROFILES[PROFILE].encoderThreads}), gl=${GL}, concurrency=${CONCURRENCY}, ${REPEATS} прогона подряд, питание от сети`,
  versions: getVersions(),
  powerAtStart: power0,
  stateAtStart: snapshotState(),
  reference,
  batteryRunRef: battery
    ? {file: 'results/raw/angle-battery.json', takenAt: battery.capturedAt, fps: (battery.runs ?? []).filter((r) => r.status === 'OK').map((r) => r.fps?.renderPhase ?? null)}
    : null,
  runs: [],
  comparisons: [],
  decomposition: null,
  verdict: null,
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

fs.appendFileSync(
  PROGRESS_MD,
  `\n## Контроль от сети · старт ${new Date().toISOString()}\n\n` +
    `Питание: ${power0.batteryStatus}, ${power0.batteryCapacity} %, acOnline=true. ` +
    `${REPEATS} прогона ${GL}/${PROFILE}/c=${CONCURRENCY} — разделить «эффект батареи» и «эффект дня».\n\n`,
);
say(`Питание: от сети (${power0.batteryStatus}, ${power0.batteryCapacity} %). ${REPEATS} прогона ${GL}/${PROFILE}/c=${CONCURRENCY} как контроль.`);
flush();

const t0 = Date.now();
for (let i = 1; i <= REPEATS; i++) {
  const runId = `ctl-mains-${GL}-${CONCURRENCY}-${PROFILE}-r${i}`;
  const outputPath = path.join(OUT, `${runId}.mp4`);
  fs.rmSync(outputPath, {force: true});
  const cfg = {runId, gl: GL, concurrency: CONCURRENCY, profile: PROFILE, mode: 'media', bundleMode: 'warm', outputPath, resultPath: path.join(OUT, `${runId}.json`)};
  const powerBefore = getPower();
  say(`[${i}/${REPEATS}] ${GL}/${PROFILE}/c=${CONCURRENCY} от сети, прогон ${i} из ${REPEATS} — старт, ожидаю ~25 с`);
  const t = Date.now();
  const child = spawn(process.execPath, [path.join(ROOT, 'runner.mjs'), JSON.stringify(cfg)], {cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe']});
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
  const wallMs = Date.now() - t;
  const memory = sampler.stop();
  const powerAfter = getPower();

  if (powerAfter.acOnline !== true) {
    doc.notes.push(`${runId}: питание пропало во время прогона — прогон помечен как испорченный`);
    say(`  ⚠ во время ${runId} шнур оказался выдернут`);
  }
  if (code !== 0 || timedOut || !fs.existsSync(outputPath)) {
    doc.runs.push({runId, status: 'FAILED', wallMs, powerBefore, powerAfter, error: timedOut ? 'таймаут' : `код ${code}`, stderr: stderr.slice(-2000)});
    say(`[${i}/${REPEATS}] ✗ FAILED за ${mmss(wallMs)}`);
    flush();
    continue;
  }

  const rr = readJson(cfg.resultPath) ?? {};
  const md5Path = path.join(MD5, `${runId}.framemd5`);
  const fm = await framemd5(outputPath, md5Path);
  const sha = sha256File(outputPath);
  const rec = {
    runId,
    status: 'OK',
    commandLine: `node runner.mjs '${JSON.stringify(cfg)}'`,
    wallMs,
    fps: rr.render?.fps ?? null,
    timings: rr.timings ?? null,
    peakRssSumMb: memory.peakRssSumMb,
    peakPssSumMb: memory.peakPssSumMb,
    powerBefore,
    powerAfter,
    cpuTempCBefore: rr.stateAtStart?.cpuTempC ?? null,
    cpuTempCAfter: rr.stateAtEnd?.cpuTempC ?? null,
    loadAvgBefore: rr.stateAtStart?.loadAvg ?? null,
    outputSha256: sha,
    outputBytes: fs.statSync(outputPath).size,
    framemd5: {...fm, file: path.relative(ROOT, md5Path)},
    ffprobe: (await ffprobe(outputPath)).fingerprint,
    equalToReference: sha === reference.mp4Sha256,
  };
  doc.runs.push(rec);
  if (!KEEP_MP4) fs.rmSync(outputPath, {force: true});
  say(
    `[${i}/${REPEATS}] готово за ${mmss(wallMs)} — ${rec.fps?.renderPhase ?? '—'} кадр/с | ` +
      `${rec.equalToReference ? 'sha256 совпал с эталоном' : '⚠ sha256 НЕ совпал с эталоном'} | CPU ${rec.cpuTempCBefore} → ${rec.cpuTempCAfter} °C`,
  );
  flush();
}

const ok = doc.runs.filter((r) => r.status === 'OK');
for (const r of ok) {
  const refFile = path.join(ROOT, reference.framemd5File);
  const e = {a: r.runId, b: `${reference.runId} (эталон)`, byteIdenticalMp4: r.outputSha256 === reference.mp4Sha256};
  if (fs.existsSync(refFile)) {
    const cmp = compareFramemd5(path.join(ROOT, r.framemd5.file), refFile);
    e.framemd5Equal = cmp.equal;
    e.firstDiffFrame = cmp.firstDiffFrame;
    e.verdict = cmp.equal ? 'совпало' : `разошлось на кадре ${cmp.firstDiffFrame}`;
  }
  doc.comparisons.push(e);
}

// ── разложение разрыва ───────────────────────────────────────────────────────────────────
const avg = (xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 1000) / 1000 : null);
const mainsToday = avg(ok.map((r) => r.fps?.renderPhase).filter((v) => typeof v === 'number'));
const batteryToday = avg(((battery?.runs ?? []).filter((r) => r.status === 'OK').map((r) => r.fps?.renderPhase) ?? []).filter((v) => typeof v === 'number'));
const matrix = reference.fpsRenderPhase;
if (mainsToday && batteryToday && matrix) {
  doc.decomposition = {
    matrixMainsFps: matrix,
    mainsTodayFps: mainsToday,
    batteryTodayFps: batteryToday,
    totalGapPercent: pct(batteryToday, matrix),
    dayEffectPercent: pct(mainsToday, matrix),
    batteryEffectPercent: pct(batteryToday, mainsToday),
    text:
      `батарея против сети сегодня: ${pct(batteryToday, mainsToday)} %; ` +
      `сеть сегодня против матрицы: ${pct(mainsToday, matrix)} %; ` +
      `итоговый разрыв батарея-против-матрицы: ${pct(batteryToday, matrix)} %`,
  };
  doc.notes.push(
    `эталон матрицы снят при ${reference.cpuTempCAtRun} °C и батарее ${reference.powerAtRun?.batteryCapacity} % (${reference.powerAtRun?.batteryStatus}); ` +
      `сегодняшний контроль — при ${ok[0]?.cpuTempCBefore} °C и батарее ${power0.batteryCapacity} % (${power0.batteryStatus})`,
  );
}
doc.verdict = {
  runsOk: ok.length,
  allEqualToReference: ok.length > 0 && ok.every((r) => r.equalToReference),
  text:
    ok.length === 0
      ? 'FAILED — ни один прогон не состоялся'
      : `${ok.every((r) => r.equalToReference) ? 'кадры совпали с эталоном' : 'кадры НЕ совпали с эталоном'}; ${doc.decomposition?.text ?? 'разложение не посчитано'}`,
};
doc.status = 'OK';
doc.finishedAt = new Date().toISOString();
doc.stateAtEnd = snapshotState();
doc.totalWallMs = Date.now() - t0;
flush();
say(`Итог: ${doc.verdict.text}. Всего ${mmss(Date.now() - t0)}.`);
console.log(`\nЗаписано: ${path.relative(ROOT, DOC_PATH)}`);
