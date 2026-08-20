/** SP-3: стоимость проверок над готовым сегментом (ADR-0008: framemd5 и ffprobe на сегмент). */
import {execFile} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {promisify} from 'node:util';

const pexecFile = promisify(execFile);

export const sha256File = (file) =>
  crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** framemd5 = md5 КАЖДОГО ДЕКОДИРОВАННОГО кадра. Стоит полного декодирования сегмента. */
export const framemd5 = async (input, outFile, {extraInputArgs = []} = {}) => {
  const args = [
    '-hide_banner', '-nostdin', '-loglevel', 'error',
    ...extraInputArgs,
    '-i', input,
    '-an', '-f', 'framemd5', '-y', outFile,
  ];
  const t = Date.now();
  await pexecFile('ffmpeg', args);
  const ms = Date.now() - t;
  const lines = fs.readFileSync(outFile, 'utf8').split('\n').filter((l) => l && !l.startsWith('#'));
  return {
    ms,
    file: outFile,
    frameLines: lines.length,
    sha256: sha256File(outFile),
    command: `ffmpeg ${args.join(' ')}`,
  };
};

/** Сравнение двух framemd5: номер первого разошедшегося кадра или null. */
export const compareFramemd5 = (fileA, fileB) => {
  const parse = (f) =>
    fs
      .readFileSync(f, 'utf8')
      .split('\n')
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => l.trim().split(/[,\s]+/).filter(Boolean))
      .map((c) => ({frame: Number(c[1]), md5: c[c.length - 1]}));
  const a = parse(fileA);
  const b = parse(fileB);
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i].md5 !== b[i].md5) return {equal: false, firstDiffIndex: i, firstDiffFrame: a[i].frame, framesCompared: n, lengths: [a.length, b.length]};
  }
  if (a.length !== b.length) return {equal: false, firstDiffIndex: n, firstDiffFrame: null, reason: 'разное число кадров', framesCompared: n, lengths: [a.length, b.length]};
  return {equal: true, firstDiffIndex: null, firstDiffFrame: null, framesCompared: n, lengths: [a.length, b.length]};
};

export const ffprobe = async (input) => {
  const args = ['-hide_banner', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', input];
  const t = Date.now();
  const {stdout} = await pexecFile('ffprobe', args);
  const ms = Date.now() - t;
  const json = JSON.parse(stdout);
  const v = (json.streams ?? []).find((s) => s.codec_type === 'video') ?? {};
  return {
    ms,
    command: `ffprobe ${args.join(' ')}`,
    // StreamFingerprint (ADR-0008): то, что обязано совпадать у сегментов перед concat -c copy
    fingerprint: {
      codec: v.codec_name,
      profile: v.profile,
      level: v.level,
      pixFmt: v.pix_fmt,
      width: v.width,
      height: v.height,
      rFrameRate: v.r_frame_rate,
      timeBase: v.time_base,
      colorSpace: v.color_space,
      colorPrimaries: v.color_primaries,
      colorTransfer: v.color_transfer,
      colorRange: v.color_range,
      nbFrames: v.nb_frames,
      hasBFrames: v.has_b_frames,
      durationSec: json.format?.duration ? Number(json.format.duration) : null,
      bitRate: json.format?.bit_rate ? Number(json.format.bit_rate) : null,
    },
  };
};

/** Закрытость GOP: список кадров с ключевым флагом (ADR-0008 — риск concat -c copy). */
export const keyframes = async (input) => {
  const args = [
    '-hide_banner', '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'frame=key_frame,pict_type,pkt_pts_time',
    '-of', 'csv=p=0', input,
  ];
  const t = Date.now();
  const {stdout} = await pexecFile('ffprobe', args, {maxBuffer: 32 * 1024 * 1024});
  const rows = stdout.trim().split('\n').filter(Boolean).map((l) => l.split(','));
  const keyIdx = rows.map((r, i) => (r[0] === '1' ? i : -1)).filter((i) => i >= 0);
  const gaps = keyIdx.slice(1).map((v, i) => v - keyIdx[i]);
  return {
    ms: Date.now() - t,
    command: `ffprobe ${args.join(' ')}`,
    frameCount: rows.length,
    keyframeCount: keyIdx.length,
    keyframeIndexes: keyIdx.slice(0, 40),
    gopSizes: [...new Set(gaps)].sort((a, b) => a - b),
    firstFrameIsKey: rows.length > 0 ? rows[0][0] === '1' : null,
  };
};

/**
 * Покадровый PSNR между двумя PNG-сиквенсами.
 * Нужен, чтобы отличить «кадры разошлись катастрофически» от «разошлись на единицы
 * младших битов»: для решения по AC4 это разные новости.
 */
export const psnrBetweenPngDirs = async (dirA, dirB, statsFile) => {
  const args = [
    '-hide_banner', '-nostdin', '-loglevel', 'error',
    '-framerate', '30', '-pattern_type', 'glob', '-i', `${dirA}/*.png`,
    '-framerate', '30', '-pattern_type', 'glob', '-i', `${dirB}/*.png`,
    '-lavfi', `psnr=stats_file=${statsFile}`,
    '-f', 'null', '-',
  ];
  const t = Date.now();
  await pexecFile('ffmpeg', args, {maxBuffer: 32 * 1024 * 1024});
  const rows = fs
    .readFileSync(statsFile, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => Object.fromEntries(line.trim().split(' ').map((kv) => kv.split(':'))));
  const parsed = rows.map((r) => ({
    n: Number(r.n),
    psnrAvg: r.psnr_avg === 'inf' ? Infinity : Number(r.psnr_avg),
    mseAvg: Number(r.mse_avg),
  }));
  const finite = parsed.filter((r) => Number.isFinite(r.psnrAvg));
  const identical = parsed.filter((r) => !Number.isFinite(r.psnrAvg)).length;
  const worst = finite.length ? finite.reduce((a, b) => (a.psnrAvg <= b.psnrAvg ? a : b)) : null;
  return {
    ms: Date.now() - t,
    command: `ffmpeg ${args.join(' ')}`,
    framesCompared: parsed.length,
    identicalFrames: identical,
    differingFrames: finite.length,
    worstFrame: worst ? {n: worst.n, psnrDb: worst.psnrAvg, mse: worst.mseAvg} : null,
    meanPsnrDbOfDiffering: finite.length
      ? Math.round((finite.reduce((a, b) => a + b.psnrAvg, 0) / finite.length) * 100) / 100
      : null,
    maxMseOfDiffering: finite.length ? Math.max(...finite.map((r) => r.mseAvg)) : null,
  };
};

/** Покадровый PSNR между двумя произвольными видеофайлами (для распределения расхождений AC4). */
export const psnrBetweenFiles = async (fileA, fileB, statsFile) => {
  const args = [
    '-hide_banner', '-nostdin', '-loglevel', 'error',
    '-i', fileA, '-i', fileB,
    '-lavfi', `psnr=stats_file=${statsFile}`,
    '-f', 'null', '-',
  ];
  const t = Date.now();
  await pexecFile('ffmpeg', args, {maxBuffer: 32 * 1024 * 1024});
  const parsed = fs
    .readFileSync(statsFile, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => Object.fromEntries(line.trim().split(' ').map((kv) => kv.split(':'))))
    .map((r) => ({
      n: Number(r.n),
      psnrAvg: r.psnr_avg === 'inf' ? Infinity : Number(r.psnr_avg),
      mseAvg: Number(r.mse_avg),
      psnrY: r.psnr_y === 'inf' ? Infinity : Number(r.psnr_y),
    }));
  return {ms: Date.now() - t, command: `ffmpeg ${args.join(' ')}`, frames: parsed};
};

/** Распределение расхождений: то, чем Charter предлагает задавать порог AC4 на профиле final. */
export const psnrDistribution = (frames) => {
  const identical = frames.filter((f) => !Number.isFinite(f.psnrAvg)).length;
  const differing = frames.filter((f) => Number.isFinite(f.psnrAvg));
  const sorted = [...differing].sort((a, b) => a.psnrAvg - b.psnrAvg);
  const at = (p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))].psnrAvg : null);
  const round = (v) => (v === null ? null : Math.round(v * 100) / 100);
  return {
    frames: frames.length,
    identicalFrames: identical,
    differingFrames: differing.length,
    differingShare: frames.length ? Math.round((differing.length / frames.length) * 1000) / 10 : null,
    psnrMinDb: round(at(0)),
    psnrP05Db: round(at(0.05)),
    psnrP50Db: round(at(0.5)),
    psnrP95Db: round(at(0.95)),
    psnrMaxDb: round(sorted.length ? sorted[sorted.length - 1].psnrAvg : null),
    maxMse: differing.length ? Math.max(...differing.map((f) => f.mseAvg)) : null,
    framesBelow40Db: differing.filter((f) => f.psnrAvg < 40).length,
    framesBelow50Db: differing.filter((f) => f.psnrAvg < 50).length,
  };
};
