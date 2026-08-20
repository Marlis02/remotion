/**
 * SP-3: детерминизм. Главное требование RT-01 §5.3 п.1 — РАЗДЕЛИТЬ источники:
 * без разделения любое расхождение спишут на Chrome, потому что про энкодер
 * нет даже UNKNOWN.
 *
 * Блок A. mp4, 3 прогона подряд одной конфигурации (профиль final, как в проде).
 * Блок B. mp4 на профиле ac4 (render.ac4.yaml: png-кадры, однопоточный энкод, concurrency 1).
 * Блок C. PNG-сиквенс БЕЗ энкода, 3 прогона — это изолирует Chrome.
 * Блок D. Один и тот же PNG-сиквенс → mp4 дважды (threads 1 и threads 4) — это изолирует энкодер.
 *
 * Всё дописывается в results/raw/determinism.json по мере прогона.
 */
import {execFile, spawn} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {framemd5, compareFramemd5, ffprobe, keyframes, psnrBetweenPngDirs, sha256File} from './lib/media.mjs';
import {PROFILES} from './lib/profiles.mjs';
import {ROOT, getVersions, snapshotState} from './lib/sysinfo.mjs';
import {startMemorySampler} from './lib/proctree.mjs';
import {writeSummary} from './lib/summary.mjs';

const pexecFile = promisify(execFile);
const RAW = path.join(ROOT, 'results/raw');
const MD5 = path.join(ROOT, 'results/framemd5');
const OUT = path.join(ROOT, 'out');
for (const d of [RAW, MD5, OUT]) fs.mkdirSync(d, {recursive: true});

const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const REPEATS = Number(arg('repeats', '3'));
const ONLY = arg('only', 'A,B,C,D,E').split(',');

const OUTFILE = path.join(RAW, 'determinism.json');
const doc = {
  schema: 'sp3-determinism/1',
  capturedAt: new Date().toISOString(),
  repeats: REPEATS,
  versions: getVersions(),
  stateAtStart: snapshotState(),
  blocks: [],
};
const flush = () => {
  fs.writeFileSync(OUTFILE, JSON.stringify(doc, null, 2) + '\n');
  try {
    writeSummary();
  } catch {
    /* сводка пересоберётся позже */
  }
};
flush();

/** Один прогон runner.mjs в отдельном процессе, с замером памяти дерева. */
const runRunner = async (cfg) => {
  const argv = [path.join(ROOT, 'runner.mjs'), JSON.stringify(cfg)];
  const t = Date.now();
  const child = spawn(process.execPath, argv, {cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe']});
  const sampler = startMemorySampler(child.pid, {intervalMs: 200});
  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d.toString()));
  const code = await new Promise((r) => child.on('close', r));
  const memory = sampler.stop();
  const wallMs = Date.now() - t;
  let record = null;
  try {
    record = JSON.parse(fs.readFileSync(cfg.resultPath, 'utf8'));
  } catch {
    /* runner не дописал */
  }
  return {
    code,
    wallMs,
    memory,
    record,
    stderr: stderr.slice(-2000),
    commandLine: `node runner.mjs '${JSON.stringify(cfg)}'`,
  };
};

const hashPngDir = (dir) => {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
  const perFile = files.map((f) => ({file: f, sha256: sha256File(path.join(dir, f))}));
  const h = crypto.createHash('sha256');
  for (const e of perFile) h.update(`${e.file} ${e.sha256}\n`);
  return {dirHash: h.digest('hex'), count: files.length, perFile};
};

const firstPngDiff = (a, b) => {
  const n = Math.min(a.perFile.length, b.perFile.length);
  for (let i = 0; i < n; i++) {
    if (a.perFile[i].sha256 !== b.perFile[i].sha256) return {index: i, file: a.perFile[i].file};
  }
  if (a.perFile.length !== b.perFile.length) return {index: n, file: null, reason: 'разное число файлов'};
  return null;
};

const verdictText = (equal, frame) => (equal ? 'совпало' : `разошлось на кадре ${frame}`);

// ─────────────────────────────────────────────────────────────────────────────
// Блоки A и B: mp4, N прогонов подряд одной конфигурации.
// ─────────────────────────────────────────────────────────────────────────────
const mp4Block = async ({id, title, profile, gl, concurrency}) => {
  const block = {
    id,
    title,
    configText: `профиль ${profile} (scale ${PROFILES[profile].scale}, crf ${PROFILES[profile].crf}, imageFormat ${PROFILES[profile].imageFormat}, encoder threads ${PROFILES[profile].encoderThreads}), gl=${gl}, concurrency=${concurrency}, ${REPEATS} прогона подряд`,
    kind: 'mp4-repeat',
    runs: [],
    comparisons: [],
    verdict: 'в процессе',
    notes: [],
  };
  doc.blocks.push(block);
  flush();

  for (let i = 1; i <= REPEATS; i++) {
    const runId = `det-${id}-${gl}-${concurrency}-${profile}-r${i}`;
    const outputPath = path.join(OUT, `${runId}.mp4`);
    const resultPath = path.join(OUT, `${runId}.json`);
    console.log(`▶ ${runId}`);
    const r = await runRunner({
      runId,
      gl,
      concurrency,
      profile,
      mode: 'media',
      bundleMode: 'warm',
      outputPath,
      resultPath,
    });
    if (r.code !== 0 || !fs.existsSync(outputPath)) {
      block.runs.push({runId, status: 'FAILED', commandLine: r.commandLine, stderr: r.stderr, wallMs: r.wallMs});
      block.verdict = 'FAILED — прогон не состоялся';
      flush();
      return block;
    }
    const md5Path = path.join(MD5, `${runId}.framemd5`);
    const fm = await framemd5(outputPath, md5Path);
    const probe = await ffprobe(outputPath);
    block.runs.push({
      runId,
      status: 'OK',
      commandLine: r.commandLine,
      wallMs: r.wallMs,
      peakRssSumMb: r.memory.peakRssSumMb,
      renderFps: r.record?.render?.fps ?? null,
      outputSha256: sha256File(outputPath),
      outputBytes: fs.statSync(outputPath).size,
      framemd5: {...fm, file: path.relative(ROOT, md5Path)},
      ffprobe: probe.fingerprint,
      ffmpegInvocations: r.record?.ffmpeg?.invocations?.map((inv) => ({type: inv.type, patched: inv.patched.join(' ')})) ?? [],
    });
    console.log(`  ${runId}: sha256(mp4)=${block.runs[i - 1].outputSha256.slice(0, 16)} framemd5=${fm.sha256.slice(0, 16)}`);
    flush();
  }

  const ok = block.runs.filter((r) => r.status === 'OK');
  for (let i = 1; i < ok.length; i++) {
    const cmp = compareFramemd5(path.join(ROOT, ok[0].framemd5.file), path.join(ROOT, ok[i].framemd5.file));
    block.comparisons.push({
      a: ok[0].runId,
      b: ok[i].runId,
      framemd5Equal: cmp.equal,
      firstDiffFrame: cmp.firstDiffFrame,
      framesCompared: cmp.framesCompared,
      byteIdenticalMp4: ok[0].outputSha256 === ok[i].outputSha256,
      verdict: verdictText(cmp.equal, cmp.firstDiffFrame),
    });
  }
  const allEqual = block.comparisons.every((c) => c.framemd5Equal);
  const allBytes = block.comparisons.every((c) => c.byteIdenticalMp4);
  block.verdict = allEqual
    ? `совпало (${ok.length} прогона, ${block.comparisons[0]?.framesCompared ?? 0} кадров, декодированные кадры идентичны)`
    : `разошлось на кадре ${block.comparisons.find((c) => !c.framemd5Equal)?.firstDiffFrame}`;
  block.notes.push(`побайтовое равенство самих mp4: ${allBytes ? 'да' : 'нет'} (framemd5 сравнивает декодированные кадры, sha256 — контейнер и битстрим)`);
  block.table = [
    '| прогон | wall, с | sha256(mp4) | sha256(framemd5) |',
    '|---|---|---|---|',
    ...ok.map((r) => `| ${r.runId} | ${(r.wallMs / 1000).toFixed(1)} | \`${r.outputSha256.slice(0, 16)}\` | \`${r.framemd5.sha256.slice(0, 16)}\` |`),
  ];
  flush();
  return block;
};

// ─────────────────────────────────────────────────────────────────────────────
// Блок C: PNG-сиквенс без энкода — изолирует Chrome.
// ─────────────────────────────────────────────────────────────────────────────
const pngBlock = async ({gl, concurrency, profile}) => {
  const block = {
    id: 'C',
    title: 'PNG-сиквенс без энкода: изоляция Chrome',
    configText: `renderFrames(imageFormat=png), профиль ${profile} (scale ${PROFILES[profile].scale}), gl=${gl}, concurrency=${concurrency}, ${REPEATS} прогона подряд`,
    kind: 'png-repeat',
    runs: [],
    comparisons: [],
    verdict: 'в процессе',
    notes: [],
  };
  doc.blocks.push(block);
  flush();

  const dirs = [];
  for (let i = 1; i <= REPEATS; i++) {
    const runId = `det-C-png-r${i}`;
    const framesOutDir = path.join(OUT, `frames-r${i}`);
    const resultPath = path.join(OUT, `${runId}.json`);
    console.log(`▶ ${runId}`);
    const r = await runRunner({
      runId,
      gl,
      concurrency,
      profile,
      mode: 'frames',
      bundleMode: 'warm',
      framesOutDir,
      resultPath,
    });
    if (r.code !== 0) {
      block.runs.push({runId, status: 'FAILED', commandLine: r.commandLine, stderr: r.stderr});
      block.verdict = 'FAILED — прогон не состоялся';
      flush();
      return block;
    }
    const h = hashPngDir(framesOutDir);
    // framemd5 по декодированному сиквенсу — та же метрика, что и для mp4.
    const md5Path = path.join(MD5, `${runId}.framemd5`);
    const fm = await framemd5(path.join(framesOutDir, '*.png'), md5Path, {
      extraInputArgs: ['-framerate', '30', '-pattern_type', 'glob'],
    });
    dirs.push({runId, framesOutDir, hash: h, framemd5: {...fm, file: path.relative(ROOT, md5Path)}});
    block.runs.push({
      runId,
      status: 'OK',
      commandLine: r.commandLine,
      wallMs: r.wallMs,
      peakRssSumMb: r.memory.peakRssSumMb,
      renderFps: r.record?.render?.fps ?? null,
      pngCount: h.count,
      pngDirHash: h.dirHash,
      framemd5: {...fm, file: path.relative(ROOT, md5Path)},
      totalBytes: fs.readdirSync(framesOutDir).reduce((a, f) => a + fs.statSync(path.join(framesOutDir, f)).size, 0),
    });
    console.log(`  ${runId}: ${h.count} PNG, dirHash=${h.dirHash.slice(0, 16)}`);
    flush();
  }

  for (let i = 1; i < dirs.length; i++) {
    const diff = firstPngDiff(dirs[0].hash, dirs[i].hash);
    const cmp = compareFramemd5(path.join(ROOT, dirs[0].framemd5.file), path.join(ROOT, dirs[i].framemd5.file));
    block.comparisons.push({
      a: dirs[0].runId,
      b: dirs[i].runId,
      pngBytesEqual: diff === null,
      firstDiffPngIndex: diff?.index ?? null,
      firstDiffPngFile: diff?.file ?? null,
      framemd5Equal: cmp.equal,
      firstDiffFrame: cmp.firstDiffFrame,
      framesCompared: cmp.framesCompared,
      verdict: verdictText(diff === null && cmp.equal, diff?.index ?? cmp.firstDiffFrame),
    });
  }
  const allEqual = block.comparisons.every((c) => c.pngBytesEqual && c.framemd5Equal);
  block.verdict = allEqual
    ? `совпало (${dirs.length} прогона × ${dirs[0].hash.count} PNG побайтово идентичны ⇒ Chrome детерминирован на этой конфигурации)`
    : `разошлось на кадре ${block.comparisons.find((c) => !c.pngBytesEqual)?.firstDiffPngIndex ?? block.comparisons.find((c) => !c.framemd5Equal)?.firstDiffFrame}`;
  block.table = [
    '| прогон | PNG | суммарно, МБ | dirHash | sha256(framemd5) |',
    '|---|---|---|---|---|',
    ...block.runs
      .filter((r) => r.status === 'OK')
      .map(
        (r) =>
          `| ${r.runId} | ${r.pngCount} | ${(r.totalBytes / 1024 / 1024).toFixed(0)} | \`${r.pngDirHash.slice(0, 16)}\` | \`${r.framemd5.sha256.slice(0, 16)}\` |`,
      ),
  ];
  flush();
  // Первый сиквенс оставляем для блока D, остальные удаляем: гигабайты PNG в репозитории не нужны.
  for (const d of dirs.slice(1)) fs.rmSync(d.framesOutDir, {recursive: true, force: true});
  return {block, keptDir: dirs[0]?.framesOutDir ?? null, pngCount: dirs[0]?.hash.count ?? 0};
};

// ─────────────────────────────────────────────────────────────────────────────
// Блок D: один и тот же PNG-сиквенс → mp4 дважды. Это изолирует энкодер.
// ─────────────────────────────────────────────────────────────────────────────
const encoderBlock = async ({framesDir, threadsVariants = [1, 4]}) => {
  const block = {
    id: 'D',
    title: 'Двойной энкод одного и того же PNG-сиквенса: изоляция энкодера',
    configText: `libx264 crf 18, preset medium, bt709, yuv420p, -g 30, bitexact; вход — фиксированный PNG-сиквенс из блока C`,
    kind: 'encoder-repeat',
    runs: [],
    comparisons: [],
    verdict: 'в процессе',
    notes: [],
  };
  doc.blocks.push(block);
  flush();

  if (!framesDir || !fs.existsSync(framesDir)) {
    block.verdict = 'SKIPPED — нет PNG-сиквенса из блока C';
    flush();
    return block;
  }

  for (const threads of threadsVariants) {
    for (let i = 1; i <= 2; i++) {
      const id = `det-D-threads${threads}-e${i}`;
      const outPath = path.join(OUT, `${id}.mp4`);
      const args = [
        '-hide_banner', '-nostdin', '-loglevel', 'error', '-y',
        '-framerate', '30',
        '-pattern_type', 'glob',
        '-i', path.join(framesDir, '*.png'),
        '-an',
        '-c:v', 'libx264',
        '-crf', '18',
        '-preset', 'medium',
        '-pix_fmt', 'yuv420p',
        '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
        '-g', '30',
        '-threads', String(threads),
        '-fflags', '+bitexact', '-flags:v', '+bitexact',
        outPath,
      ];
      const t = Date.now();
      await pexecFile('ffmpeg', args, {maxBuffer: 16 * 1024 * 1024});
      const ms = Date.now() - t;
      const md5Path = path.join(MD5, `${id}.framemd5`);
      const fm = await framemd5(outPath, md5Path);
      block.runs.push({
        runId: id,
        threads,
        encodeMs: ms,
        commandLine: `ffmpeg ${args.join(' ')}`,
        outputSha256: sha256File(outPath),
        outputBytes: fs.statSync(outPath).size,
        framemd5: {...fm, file: path.relative(ROOT, md5Path)},
        keyframes: await keyframes(outPath),
      });
      console.log(`  ${id}: энкод ${ms} мс, sha256=${block.runs[block.runs.length - 1].outputSha256.slice(0, 16)}`);
      flush();
    }
  }

  for (const threads of threadsVariants) {
    const pair = block.runs.filter((r) => r.threads === threads);
    if (pair.length < 2) continue;
    const cmp = compareFramemd5(path.join(ROOT, pair[0].framemd5.file), path.join(ROOT, pair[1].framemd5.file));
    block.comparisons.push({
      threads,
      a: pair[0].runId,
      b: pair[1].runId,
      byteIdenticalMp4: pair[0].outputSha256 === pair[1].outputSha256,
      framemd5Equal: cmp.equal,
      firstDiffFrame: cmp.firstDiffFrame,
      framesCompared: cmp.framesCompared,
      verdict: verdictText(cmp.equal, cmp.firstDiffFrame),
    });
  }
  // Сравнение threads=1 против threads=4: это НЕ детерминизм прогон-к-прогону,
  // а вопрос «влияет ли число потоков энкодера на битстрим» (важно для ADR-0008: threads — число, не auto).
  const t1 = block.runs.find((r) => r.threads === 1);
  const t4 = block.runs.find((r) => r.threads === 4);
  if (t1 && t4) {
    const cmp = compareFramemd5(path.join(ROOT, t1.framemd5.file), path.join(ROOT, t4.framemd5.file));
    block.crossThreads = {
      a: t1.runId,
      b: t4.runId,
      framemd5Equal: cmp.equal,
      firstDiffFrame: cmp.firstDiffFrame,
      byteIdenticalMp4: t1.outputSha256 === t4.outputSha256,
      verdict: verdictText(cmp.equal, cmp.firstDiffFrame),
    };
  }
  const allEqual = block.comparisons.every((c) => c.framemd5Equal && c.byteIdenticalMp4);
  block.verdict = allEqual
    ? 'совпало (двойной энкод одного и того же сиквенса даёт побайтово равный mp4 при threads 1 и 4)'
    : `разошлось на кадре ${block.comparisons.find((c) => !c.framemd5Equal)?.firstDiffFrame ?? '—'} (или различается контейнер)`;
  block.notes.push(
    block.crossThreads
      ? `threads=1 против threads=4: ${block.crossThreads.verdict}, побайтово ${block.crossThreads.byteIdenticalMp4 ? 'равны' : 'различны'} — это ответ на вопрос, обязан ли threads быть числом в профиле`
      : 'сравнение threads=1/threads=4 не выполнено',
  );
  block.table = [
    '| энкод | threads | время, мс | размер, МБ | sha256(mp4) |',
    '|---|---|---|---|---|',
    ...block.runs.map(
      (r) => `| ${r.runId} | ${r.threads} | ${r.encodeMs} | ${(r.outputBytes / 1024 / 1024).toFixed(1)} | \`${r.outputSha256.slice(0, 16)}\` |`,
    ),
  ];
  flush();
  return block;
};


// ─────────────────────────────────────────────────────────────────────────────
// Блок E: PNG-сиквенс при concurrency 1 против concurrency 4 — БЕЗ энкодера.
// Матрица показала расхождение framemd5 между concurrency; этот блок отвечает,
// кто виноват: Chrome или энкодер. Энкодера здесь нет вовсе.
// ─────────────────────────────────────────────────────────────────────────────
const crossConcurrencyPngBlock = async ({gl, profile, refDir, refConcurrency, otherConcurrency}) => {
  const block = {
    id: 'E',
    title: 'PNG-сиквенс: concurrency 1 против concurrency 4 (энкодера нет)',
    configText: `renderFrames(imageFormat=png), профиль ${profile} (scale ${PROFILES[profile].scale}), gl=${gl}, concurrency ${otherConcurrency} против ${refConcurrency}`,
    kind: 'png-cross-concurrency',
    runs: [],
    comparisons: [],
    verdict: 'в процессе',
    notes: [],
  };
  doc.blocks.push(block);
  flush();

  if (!refDir || !fs.existsSync(refDir)) {
    block.verdict = 'SKIPPED — нет PNG-сиквенса из блока C';
    flush();
    return block;
  }

  const runId = `det-E-png-c${otherConcurrency}`;
  const framesOutDir = path.join(OUT, `frames-c${otherConcurrency}`);
  const resultPath = path.join(OUT, `${runId}.json`);
  console.log(`▶ ${runId}`);
  const r = await runRunner({
    runId,
    gl,
    concurrency: otherConcurrency,
    profile,
    mode: 'frames',
    bundleMode: 'warm',
    framesOutDir,
    resultPath,
  });
  if (r.code !== 0) {
    block.runs.push({runId, status: 'FAILED', commandLine: r.commandLine, stderr: r.stderr});
    block.verdict = 'FAILED — прогон не состоялся';
    flush();
    return block;
  }

  const hRef = hashPngDir(refDir);
  const hNew = hashPngDir(framesOutDir);
  const md5Path = path.join(MD5, `${runId}.framemd5`);
  const fm = await framemd5(path.join(framesOutDir, '*.png'), md5Path, {
    extraInputArgs: ['-framerate', '30', '-pattern_type', 'glob'],
  });
  block.runs.push({
    runId,
    status: 'OK',
    concurrency: otherConcurrency,
    commandLine: r.commandLine,
    wallMs: r.wallMs,
    peakRssSumMb: r.memory.peakRssSumMb,
    renderFps: r.record?.render?.fps ?? null,
    pngCount: hNew.count,
    pngDirHash: hNew.dirHash,
    framemd5: {...fm, file: path.relative(ROOT, md5Path)},
  });
  flush();

  const diff = firstPngDiff(hRef, hNew);
  const differingCount = hRef.perFile.filter((e, i) => hNew.perFile[i] && e.sha256 !== hNew.perFile[i].sha256).length;
  const psnr = await psnrBetweenPngDirs(refDir, framesOutDir, path.join(OUT, 'det-E.psnr'));
  block.comparisons.push({
    a: `concurrency ${refConcurrency} (блок C, прогон 1)`,
    b: `concurrency ${otherConcurrency}`,
    pngBytesEqual: diff === null,
    firstDiffPngIndex: diff?.index ?? null,
    firstDiffPngFile: diff?.file ?? null,
    differingPngCount: differingCount,
    totalPng: hRef.count,
    psnr,
    verdict: verdictText(diff === null, diff?.index ?? null),
  });
  block.verdict = diff === null
    ? `совпало (PNG побайтово равны при concurrency ${refConcurrency} и ${otherConcurrency} ⇒ Chrome не зависит от concurrency)`
    : `разошлось на кадре ${diff.index} (${differingCount} из ${hRef.count} PNG различаются) ⇒ источник расхождения — Chrome, не энкодер`;
  block.notes.push(
    psnr.worstFrame
      ? `худший кадр по PSNR: n=${psnr.worstFrame.n}, ${psnr.worstFrame.psnrDb.toFixed(2)} dB (MSE ${psnr.worstFrame.mse}); кадров, совпавших точно: ${psnr.identicalFrames} из ${psnr.framesCompared}`
      : `все ${psnr.framesCompared} кадров совпали точно (PSNR = inf)`,
  );
  block.table = [
    '| сравнение | PNG различается | первый расхождение | худший PSNR, dB | средний PSNR расходящихся, dB |',
    '|---|---|---|---|---|',
    `| c${refConcurrency} против c${otherConcurrency} | ${differingCount} из ${hRef.count} | ${diff ? `кадр ${diff.index}` : '—'} | ${psnr.worstFrame ? psnr.worstFrame.psnrDb.toFixed(2) : '—'} | ${psnr.meanPsnrDbOfDiffering ?? '—'} |`,
  ];
  flush();
  fs.rmSync(framesOutDir, {recursive: true, force: true});
  return block;
};

// ─────────────────────────────────────────────────────────────────────────────
const main = async () => {
  let keptFramesDir = null;
  if (ONLY.includes('A')) {
    await mp4Block({
      id: 'A',
      title: 'mp4, 3 прогона подряд: профиль final как в проде',
      profile: 'final',
      gl: 'swangle',
      concurrency: 4,
    });
  }
  if (ONLY.includes('B')) {
    await mp4Block({
      id: 'B',
      title: 'mp4, 3 прогона подряд: профиль ac4 (render.ac4.yaml)',
      profile: 'ac4',
      gl: 'swangle',
      concurrency: 1,
    });
  }
  if (ONLY.includes('C')) {
    const res = await pngBlock({gl: 'swangle', concurrency: 4, profile: 'final'});
    keptFramesDir = res.keptDir ?? null;
  }
  if (ONLY.includes('D')) {
    await encoderBlock({framesDir: keptFramesDir ?? path.join(OUT, 'frames-r1')});
  }
  if (ONLY.includes('E')) {
    await crossConcurrencyPngBlock({
      gl: 'swangle',
      profile: 'final',
      refDir: keptFramesDir ?? path.join(OUT, 'frames-r1'),
      refConcurrency: 4,
      otherConcurrency: 1,
    });
    // PNG-сиквенсы — гигабайты; в репозиторий они не идут и после сравнения не нужны.
    if (keptFramesDir) fs.rmSync(keptFramesDir, {recursive: true, force: true});
  }
  doc.stateAtEnd = snapshotState();
  doc.finishedAt = new Date().toISOString();
  flush();
  console.log('\nДетерминизм — вердикты:');
  for (const b of doc.blocks) console.log(`  ${b.id}. ${b.title}: ${b.verdict}`);
};

await main();
