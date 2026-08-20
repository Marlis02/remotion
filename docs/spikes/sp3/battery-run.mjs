/**
 * SP-3, долг №1 из results/findings.md §4: «прогон от батареи».
 *
 * Почему этого не было в спайке: физическое переключение питания скриптом недоступно
 * (decisions.md п. 13). Шнур выдёргивает человек — скрипт обязан лишь проверить, что это
 * действительно сделано, и отказаться работать, если нет: замер «от батареи», снятый от
 * сети, хуже отсутствующего замера, потому что выглядит как настоящий.
 *
 * Что делает:
 *   1. читает питание ТЕМ ЖЕ способом, что machine.json (lib/sysinfo.mjs, getPower):
 *      acOnline, batteryStatus, batteryCapacity — /sys/class/power_supply;
 *   2. если acOnline=true — печатает «отключи ноутбук от сети» и выходит с кодом 2,
 *      не отрендерив ни кадра;
 *   3. если batteryCapacity < 40 — предупреждает, что заряда может не хватить на три
 *      прогона, и требует подтверждения флагом --force;
 *   4. рендерит angle/final/concurrency=4 три раза подряд;
 *   5. сравнивает sha256 mp4 между тремя прогонами и с эталоном от сети (angle-4-final);
 *   6. пишет кадров/с и заряд батареи до и после каждого прогона — чтобы было видно,
 *      падает ли скорость по мере разряда.
 *
 * Результат: results/raw/angle-battery.json (+ строки в results/summary.md и PROGRESS.md).
 *
 * Флаги:
 *   --force            запустить при заряде ниже порога
 *   --min-battery=40   порог предупреждения, %
 *   --repeats=3        сколько прогонов
 *   --timeout=1500     таймаут одного прогона, секунды
 *   --keep-mp4=no      удалять mp4 после хэширования (по умолчанию оставляются)
 */
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {framemd5, compareFramemd5, ffprobe, keyframes, sha256File} from './lib/media.mjs';
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
const CONCURRENCY = Number(flag('concurrency', '4'));
const REPEATS = Number(flag('repeats', '3'));
const MIN_BATTERY = Number(flag('min-battery', '40'));
const FORCE = hasFlag('force');
const KEEP_MP4 = flag('keep-mp4', 'yes') === 'yes';
const RUN_TIMEOUT_MS = Number(flag('timeout', '1500')) * 1000;

const RAW = path.join(ROOT, 'results/raw');
const MD5 = path.join(ROOT, 'results/framemd5');
const OUT = path.join(ROOT, 'out');
const DOC_PATH = path.join(RAW, 'angle-battery.json');
const PROGRESS_MD = path.join(ROOT, 'results/PROGRESS.md');
for (const d of [RAW, MD5, OUT]) fs.mkdirSync(d, {recursive: true});

const hhmm = () => new Date().toISOString().slice(11, 19);
const say = (line) => {
  console.log(line);
  try {
    fs.appendFileSync(PROGRESS_MD, `- \`${hhmm()}\` ${line}\n`);
  } catch {
    /* PROGRESS.md не обязателен */
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

// ── 1–3. Ворота по питанию ───────────────────────────────────────────────────────────────
const power0 = getPower();

if (power0.acOnline === true) {
  console.error('');
  console.error('  ✗ Ноутбук подключён к сети.');
  console.error(`    Сейчас: acOnline=true, батарея ${power0.batteryStatus}, ${power0.batteryCapacity} %.`);
  console.error('');
  console.error('    ОТКЛЮЧИ НОУТБУК ОТ СЕТИ И ЗАПУСТИ СНОВА.');
  console.error('');
  console.error('    Смысл замера — числа при питании от батареи (core.md §16). Снятые от сети,');
  console.error('    они выглядели бы как настоящие и врали бы. Ни один кадр не отрендерен.');
  console.error('');
  process.exit(2);
}

if (power0.acOnline === null) {
  console.error('');
  console.error('  ✗ Состояние питания не читается: в /sys/class/power_supply нет источника типа Mains.');
  console.error('    Тот же путь использует machine.json. Без него замер нельзя пометить как «от батареи».');
  console.error('');
  process.exit(3);
}

if (typeof power0.batteryCapacity === 'number' && power0.batteryCapacity < MIN_BATTERY && !FORCE) {
  console.error('');
  console.error(`  ⚠ Заряд батареи ${power0.batteryCapacity} % — ниже порога ${MIN_BATTERY} %.`);
  console.error(`    Три прогона angle/final/c=4 — это примерно ${REPEATS} × 20–30 с рендера под полной`);
  console.error('    нагрузкой CPU. Заряда может не хватить, а прогон, оборванный на середине');
  console.error('    засыпанием ноутбука, даёт не «FAILED», а тишину.');
  console.error('');
  console.error('    Поставь заряжаться, либо подтверди осознанно:');
  console.error(`        node battery-run.mjs --force`);
  console.error('');
  process.exit(4);
}

if (typeof power0.batteryCapacity === 'number' && power0.batteryCapacity < MIN_BATTERY && FORCE) {
  say(`⚠ Заряд ${power0.batteryCapacity} % ниже порога ${MIN_BATTERY} %, запущено с --force.`);
}

// ── эталон от сети ───────────────────────────────────────────────────────────────────────
const refRun = readJson(path.join(RAW, 'angle-4-final.json'));
const detDoc = readJson(path.join(RAW, 'determinism.json'));
const blocksHI = (detDoc?.blocks ?? []).filter((b) => b.id === 'H' || b.id === 'I');
if (!refRun?.verification?.outputSha256) {
  console.error('Нет эталона от сети: results/raw/angle-4-final.json без verification.outputSha256');
  process.exit(1);
}
const reference = {
  runId: refRun.runId,
  source: 'results/raw/angle-4-final.json (матрица, снята от сети), подтверждён блоками H и I',
  takenAt: refRun.startedAt,
  powerAtRun: refRun.stateAtStart?.power ?? null,
  mp4Sha256: refRun.verification.outputSha256,
  framemd5Sha256: refRun.verification.framemd5.sha256,
  framemd5File: refRun.verification.framemd5.file,
  fpsRenderPhase: refRun.derived?.framesPerSecond_renderPhase ?? null,
  confirmingRuns: blocksHI.flatMap((b) => (b.runs ?? []).map((r) => ({runId: r.runId, mp4Sha256: r.outputSha256}))),
};

const doc = {
  schema: 'sp3-battery/1',
  capturedAt: new Date().toISOString(),
  question:
    'Меняются ли кадры и скорость рендера, когда ноутбук работает от батареи? (core.md §16, долг findings.md §4)',
  status: 'RUNNING',
  configText:
    `профиль ${PROFILE} (scale ${PROFILES[PROFILE].scale}, crf ${PROFILES[PROFILE].crf}, imageFormat ` +
    `${PROFILES[PROFILE].imageFormat}, encoder threads ${PROFILES[PROFILE].encoderThreads}), gl=${GL}, ` +
    `concurrency=${CONCURRENCY}, ${REPEATS} прогона подряд, питание от батареи`,
  parameters: {gl: GL, profile: PROFILE, concurrency: CONCURRENCY, repeats: REPEATS, minBattery: MIN_BATTERY, force: FORCE},
  versions: getVersions(),
  powerAtStart: power0,
  stateAtStart: snapshotState(),
  reference,
  runs: [],
  comparisons: [],
  speedTrend: null,
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

fs.appendFileSync(
  PROGRESS_MD,
  `\n## Долг 2 — прогон от батареи · старт ${new Date().toISOString()}\n\n` +
    `Питание: ${power0.batteryStatus}, ${power0.batteryCapacity} %. План: ${REPEATS} прогона ${GL}/${PROFILE}/c=${CONCURRENCY}, ` +
    `оценка ~${Math.round((REPEATS * 25) / 60)}–${Math.round((REPEATS * 40) / 60)} мин.\n\n`,
);
say(
  `Питание: от батареи (${power0.batteryStatus}, ${power0.batteryCapacity} %). ` +
    `План: ${REPEATS} прогона ${GL}/${PROFILE}/c=${CONCURRENCY}, эталон от сети \`${reference.mp4Sha256.slice(0, 16)}\`.`,
);
flush();

// ── 4. Прогоны ───────────────────────────────────────────────────────────────────────────
const t0 = Date.now();
for (let i = 1; i <= REPEATS; i++) {
  const runId = `bat-${GL}-${CONCURRENCY}-${PROFILE}-r${i}`;
  const outputPath = path.join(OUT, `${runId}.mp4`);
  fs.rmSync(outputPath, {force: true});
  const cfg = {
    runId,
    gl: GL,
    concurrency: CONCURRENCY,
    profile: PROFILE,
    mode: 'media',
    bundleMode: 'warm',
    outputPath,
    resultPath: path.join(OUT, `${runId}.json`),
  };
  const powerBefore = getPower();
  say(`[${i}/${REPEATS}] ${GL}/${PROFILE}/c=${CONCURRENCY}, прогон ${i} из ${REPEATS} — старт, батарея ${powerBefore.batteryCapacity} %, ожидаю ~1 мин`);

  const t = Date.now();
  const child = spawn(process.execPath, [path.join(ROOT, 'runner.mjs'), JSON.stringify(cfg)], {
    cwd: ROOT,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
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

  // Шнур воткнули посреди замера — это меняет предмет измерения, и молчать об этом нельзя.
  if (powerAfter.acOnline === true) {
    doc.deviations.push(`${runId}: питание переключилось на сеть во время прогона (acOnline стало true)`);
    say(`  ⚠ во время прогона ${runId} ноутбук оказался подключён к сети — прогон помечен как испорченный`);
  }

  if (code !== 0 || timedOut || !fs.existsSync(outputPath)) {
    doc.runs.push({
      runId,
      status: 'FAILED',
      commandLine: `node runner.mjs '${JSON.stringify(cfg)}'`,
      wallMs,
      powerBefore,
      powerAfter,
      error: timedOut ? `таймаут ${RUN_TIMEOUT_MS} мс` : `runner вышел с кодом ${code}`,
      stderr: stderr.slice(-2000),
    });
    say(`[${i}/${REPEATS}] ✗ FAILED за ${mmss(wallMs)} — ${timedOut ? 'таймаут' : `код ${code}`}`);
    flush();
    continue;
  }

  const runnerRecord = readJson(cfg.resultPath) ?? {};
  const md5Path = path.join(MD5, `${runId}.framemd5`);
  const fm = await framemd5(outputPath, md5Path);
  const sha = sha256File(outputPath);
  const rec = {
    runId,
    status: 'OK',
    commandLine: `node runner.mjs '${JSON.stringify(cfg)}'`,
    wallMs,
    fps: runnerRecord.render?.fps ?? null,
    timings: runnerRecord.timings ?? null,
    peakRssSumMb: memory.peakRssSumMb,
    peakPssSumMb: memory.peakPssSumMb,
    powerBefore,
    powerAfter,
    batterySpentPercent:
      typeof powerBefore.batteryCapacity === 'number' && typeof powerAfter.batteryCapacity === 'number'
        ? powerBefore.batteryCapacity - powerAfter.batteryCapacity
        : null,
    cpuTempCBefore: runnerRecord.stateAtStart?.cpuTempC ?? null,
    cpuTempCAfter: runnerRecord.stateAtEnd?.cpuTempC ?? null,
    loadAvgBefore: runnerRecord.stateAtStart?.loadAvg ?? null,
    outputSha256: sha,
    outputBytes: fs.statSync(outputPath).size,
    framemd5: {...fm, file: path.relative(ROOT, md5Path)},
    ffprobe: (await ffprobe(outputPath)).fingerprint,
    keyframes: await keyframes(outputPath),
    equalToMainsReference: sha === reference.mp4Sha256,
  };
  doc.runs.push(rec);
  if (!KEEP_MP4) fs.rmSync(outputPath, {force: true});

  const prevOk = doc.runs.filter((x) => x.status === 'OK' && x.runId !== runId);
  const sameAsPrev = prevOk.find((p) => p.outputSha256 === sha);
  const tail =
    (prevOk.length === 0 ? '' : sameAsPrev ? `sha256 совпал с прогоном ${sameAsPrev.runId.slice(-2)} | ` : '⚠ sha256 НЕ совпал с прогоном 1 | ') +
    `${rec.equalToMainsReference ? 'совпал с эталоном от сети' : 'НЕ совпал с эталоном от сети'} | ` +
    `${rec.fps?.renderPhase ?? '—'} кадр/с | батарея ${powerBefore.batteryCapacity} → ${powerAfter.batteryCapacity} %`;
  say(`[${i}/${REPEATS}] готово за ${mmss(wallMs)} — ${tail}`);
  flush();
}

// ── 5. Сравнения ─────────────────────────────────────────────────────────────────────────
const ok = doc.runs.filter((r) => r.status === 'OK');
for (let a = 0; a < ok.length; a++) {
  for (let b = a + 1; b < ok.length; b++) {
    const cmp = compareFramemd5(path.join(ROOT, ok[a].framemd5.file), path.join(ROOT, ok[b].framemd5.file));
    doc.comparisons.push({
      a: ok[a].runId,
      b: ok[b].runId,
      byteIdenticalMp4: ok[a].outputSha256 === ok[b].outputSha256,
      framemd5Equal: cmp.equal,
      firstDiffFrame: cmp.firstDiffFrame,
      framesCompared: cmp.framesCompared,
      verdict: cmp.equal ? 'совпало' : `разошлось на кадре ${cmp.firstDiffFrame}`,
    });
  }
}
for (const r of ok) {
  const refFile = path.join(ROOT, reference.framemd5File);
  const entry = {
    a: r.runId,
    b: `${reference.runId} (эталон от сети)`,
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
  }
  doc.comparisons.push(entry);
}

// ── 6. Тренд скорости по мере разряда ────────────────────────────────────────────────────
if (ok.length >= 2) {
  const first = ok[0].fps?.renderPhase ?? null;
  const last = ok[ok.length - 1].fps?.renderPhase ?? null;
  const drop = first && last ? Math.round(((first - last) / first) * 1000) / 10 : null;
  doc.speedTrend = {
    fpsRenderPhase: ok.map((r) => ({runId: r.runId, fps: r.fps?.renderPhase ?? null, batteryBefore: r.powerBefore?.batteryCapacity ?? null})),
    firstFps: first,
    lastFps: last,
    dropPercent: drop,
    batteryFrom: ok[0].powerBefore?.batteryCapacity ?? null,
    batteryTo: ok[ok.length - 1].powerAfter?.batteryCapacity ?? null,
    mainsReferenceFps: reference.fpsRenderPhase,
    text:
      drop === null
        ? 'кадров/с не измерены'
        : Math.abs(drop) < 5
          ? `скорость держится (${first} → ${last} кадр/с)`
          : drop > 0
            ? `скорость падает (${first} → ${last} кадр/с)`
            : `скорость растёт (${first} → ${last} кадр/с)`,
  };
}

const allEqualWithin = doc.comparisons.filter((c) => !String(c.b).includes('эталон')).every((c) => c.byteIdenticalMp4 && c.framemd5Equal);
const allEqualToRef = ok.length > 0 && ok.every((r) => r.equalToMainsReference);
doc.verdict = {
  runsOk: ok.length,
  stableAcrossBatteryRuns: ok.length >= 2 && allEqualWithin,
  equalToMainsReference: allEqualToRef,
  text:
    ok.length === 0
      ? 'FAILED — ни один прогон не состоялся'
      : `${ok.length >= 2 && allEqualWithin ? 'три прогона от батареи совпали между собой' : 'прогоны от батареи РАЗОШЛИСЬ между собой'}; ` +
        `${allEqualToRef ? 'и совпали с эталоном от сети' : 'и НЕ совпали с эталоном от сети'}`,
};
if (reference.fpsRenderPhase && ok.length) {
  const avg = ok.reduce((a, r) => a + (r.fps?.renderPhase ?? 0), 0) / ok.length;
  doc.notes.push(
    `кадров/с от батареи: ${ok.map((r) => r.fps?.renderPhase ?? '—').join(', ')} (среднее ${Math.round(avg * 100) / 100}); ` +
      `от сети на той же конфигурации было ${reference.fpsRenderPhase} — разница ${Math.round(((avg - reference.fpsRenderPhase) / reference.fpsRenderPhase) * 1000) / 10} %`,
  );
}
doc.notes.push('питание читается тем же способом, что в machine.json: lib/sysinfo.mjs getPower() → /sys/class/power_supply');
doc.status = 'OK';
doc.finishedAt = new Date().toISOString();
doc.stateAtEnd = snapshotState();
doc.powerAtEnd = getPower();
doc.totalWallMs = Date.now() - t0;
flush();

say(`Итог: ${doc.verdict.text}. ${doc.speedTrend?.text ?? ''} Всего ${mmss(Date.now() - t0)}.`);
say('Можно втыкать шнур обратно.');
console.log(`\nЗаписано: ${path.relative(ROOT, DOC_PATH)}`);
