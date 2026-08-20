/**
 * SP-3: пересборка results/summary.md из сырых JSON.
 * Вызывается после каждого прогона, поэтому сводка всегда соответствует тому,
 * что уже измерено, а не тому, что задумано.
 */
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from './sysinfo.mjs';
import {compareFramemd5} from './media.mjs';

const RAW_DIR = path.join(ROOT, 'results/raw');
const MD5_DIR = path.join(ROOT, 'results/framemd5');

const readJson = (f) => {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
};

const fmt = (v, digits = 2) => (v === null || v === undefined || Number.isNaN(v) ? '—' : Number(v).toFixed(digits));

/** Порог отката из ADR-0008 «Бюджет AC2» по кадрам/с профиля final. */
export const ac2Verdict = (fps) => {
  if (fps === null || fps === undefined) return {band: '—', decision: '—'};
  if (fps >= 4) return {band: '≥ 4 кадра/с', decision: 'бюджет есть с запасом ×2 — ничего не меняем'};
  if (fps >= 2) return {band: '2–4 кадра/с', decision: 'AC2 без запаса: minSegmentDurationFrames, framemd5 только ночью'};
  if (fps >= 1) return {band: '1–2 кадра/с', decision: 'откат №1: scale 0.75 либо fps 30→25'};
  if (fps >= 0.5) return {band: '0.5–1 кадр/с', decision: 'откат №2: --gl=angle на final, AC4 остаётся на render.ac4.yaml'};
  return {band: '< 0.5 кадра/с', decision: 'откат №3: план Б по рендереру'};
};

export const loadRuns = () => {
  if (!fs.existsSync(RAW_DIR)) return [];
  return fs
    .readdirSync(RAW_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => readJson(path.join(RAW_DIR, f)))
    .filter(Boolean)
    // Прогоном считается только файл со схемой прогона: в results/raw/ лежат ещё
    // bundle.json, determinism.json, distribution.json, pixeldiff.json, network-isolation.json.
    .filter((r) => r.schema === 'sp3-run/1' && r.config && typeof r.config === 'object' && r.runId)
    .sort((a, b) => {
      const k = (r) => `${r.config.profile}|${r.config.gl}|${String(r.config.concurrency).padStart(2, '0')}`;
      return k(a) < k(b) ? -1 : 1;
    });
};

/** Инвариантность к concurrency: сравнение с прогоном concurrency=1 той же группы (gl+профиль). */
const concurrencyDeterminism = (runs) => {
  const map = new Map();
  for (const r of runs) {
    if (r.status !== 'OK' || !r.verification?.framemd5) continue;
    const key = `${r.config.gl}|${r.config.profile}`;
    if (r.config.concurrency === 1) map.set(key, r);
  }
  const out = new Map();
  for (const r of runs) {
    const key = `${r.config.gl}|${r.config.profile}`;
    const ref = map.get(key);
    if (r.status !== 'OK' || !r.verification?.framemd5) {
      out.set(r.runId, {text: '—', equal: null});
      continue;
    }
    if (!ref) {
      out.set(r.runId, {text: 'нет эталона', equal: null});
      continue;
    }
    if (ref.runId === r.runId) {
      out.set(r.runId, {text: 'эталон группы', equal: null});
      continue;
    }
    const a = path.join(ROOT, ref.verification.framemd5.file);
    const b = path.join(ROOT, r.verification.framemd5.file);
    if (!fs.existsSync(a) || !fs.existsSync(b)) {
      out.set(r.runId, {text: '—', equal: null});
      continue;
    }
    const cmp = compareFramemd5(a, b);
    out.set(r.runId, {
      text: cmp.equal ? 'да' : `нет (кадр ${cmp.firstDiffFrame ?? cmp.firstDiffIndex})`,
      equal: cmp.equal,
      cmp,
    });
  }
  return out;
};

export const buildSummary = () => {
  const runs = loadRuns();
  const bundle = readJson(path.join(RAW_DIR, 'bundle.json'));
  const det = readJson(path.join(RAW_DIR, 'determinism.json'));
  const machine = readJson(path.join(ROOT, 'results/machine.json'));
  const detByConcurrency = concurrencyDeterminism(runs);
  // Матрица задания и добавочные прогоны (core.md §16) разводятся: иначе в таблице
  // оказываются две строки «swangle | 4 | final» с разными числами и без объяснения.
  const isMatrix = (r) => r.runId === `${r.config.gl}-${r.config.concurrency}-${r.config.profile}`;
  const matrixRuns = runs.filter(isMatrix);
  const extraRuns = runs.filter((r) => !isMatrix(r));

  const L = [];
  L.push('# SP-3 — сводка замеров: бюджет кадров и детерминизм Remotion');
  L.push('');
  L.push(`* **Собрано:** ${new Date().toISOString()} (файл пересобирается после каждого прогона)`);
  if (machine) {
    L.push(
      `* **Машина:** ${machine.machine.cpuModel}, ${machine.machine.cpuPhysicalCores} ядер / ${machine.machine.cpuLogical} потоков, ` +
        `${machine.machine.ramTotalGiB} GiB RAM, ${machine.machine.os}, питание: ${machine.state.power.source}` +
        ` (подробности — [machine.json](machine.json))`,
    );
    L.push(
      `* **Версии:** node ${machine.versions.node}, remotion ${machine.versions.remotion}, ` +
        `${machine.versions.chromeHeadlessShell}, ${String(machine.versions.ffmpeg).replace('ffmpeg version ', 'ffmpeg ').split(' Copyright')[0]}`,
    );
  }
  L.push('* **Композиция:** 1080×1920, 30 fps, 300 кадров (10 c): фон + Ken Burns 1.0→1.15, пословные субтитры (2–4 слова на страницу), затемнение. sha256 фикстуры — [fixture.json](fixture.json).');
  L.push('* **Этот файл — только числа.** Их истолкование с пометками FACT/INFERENCE/UNKNOWN — в [findings.md](findings.md); решения, принятые по ходу спайка, — в [decisions.md](decisions.md).');
  L.push('');
  L.push('## Матрица прогонов');
  L.push('');
  L.push('| gl | concurrency | профиль | кадров/с | wall-time, с | пик RSS, МБ | детерминизм |');
  L.push('|---|---|---|---|---|---|---|');
  for (const r of matrixRuns) {
    if (r.status !== 'OK') {
      L.push(
        `| ${r.config.gl} | ${r.config.concurrency} | ${r.config.profile} | FAILED | — | — | — · ${
          (r.error?.message ?? 'причина не записана').replace(/\|/g, '/').slice(0, 120)
        } |`,
      );
      continue;
    }
    const d = r.derived ?? {};
    const det1 = detByConcurrency.get(r.runId);
    L.push(
      `| ${r.config.gl} | ${r.config.concurrency} | ${r.config.profile} | ${fmt(d.framesPerSecond_renderPhase)} | ` +
        `${fmt(d.wallTimeSec, 1)} | ${fmt(r.memory?.peakRssSumMb, 0)} | ${det1?.text ?? '—'} |`,
    );
  }
  L.push('');
  L.push('**Колонка «кадров/с»** — фаза рендера (после того, как Chrome готов), то есть чистая пропускная способность рендерера.');
  L.push('**Колонка «wall-time»** — весь процесс целиком: старт node, тёплый бандл, старт Chrome, рендер, мукс.');
  L.push('**Колонка «пик RSS»** — сумма VmRSS по всему дереву процессов (node + вкладки Chrome + ffmpeg); завышает за счёт общих страниц, честная нижняя оценка — Pss, она в raw-JSON.');
  L.push('**Колонка «детерминизм»** — совпал ли framemd5 с прогоном `concurrency=1` того же (gl, профиль). Читать её как «инвариантность к concurrency» **нельзя**: блоки C/E/F показали, что вариант кадров меняется от прогона к прогону и при `concurrency=1` тоже. То есть колонка отвечает на вопрос «выпал ли этот прогон в тот же вариант, что эталонный», а не «виноват ли параллелизм».');
  L.push('');

  // Условия, в которых сняты числа: без них таблица читается как «характеристика Remotion»,
  // хотя это характеристика Remotion НА ЭТОМ ноутбуке В ЭТОТ ЧАС.
  const okRuns = runs.filter((r) => r.status === 'OK');
  const temps = okRuns.flatMap((r) => [r.stateAtStart?.cpuTempC, r.stateAtEnd?.cpuTempC]).filter((v) => typeof v === 'number');
  const loads = okRuns.map((r) => r.stateAtStart?.loadAvg?.[0]).filter((v) => typeof v === 'number');
  if (temps.length) {
    L.push('## Условия прогонов');
    L.push('');
    L.push(`* температура CPU по всем прогонам: ${Math.min(...temps).toFixed(1)}–${Math.max(...temps).toFixed(1)} °C.`);
    if (Math.max(...temps) >= 85) {
      L.push('  При таких значениях мобильный Ryzen уходит в тепловой троттлинг, то есть числа `swangle` — это **числа прогретого ноутбука**, а не пиковые. Для AC2 это правильная сторона осторожности: реальная сборка тоже идёт минутами подряд.');
    }
    if (loads.length) L.push(`* loadavg(1m) на входе в прогон: ${Math.min(...loads).toFixed(2)}–${Math.max(...loads).toFixed(2)} (прогоны шли подряд, поэтому загрузка не успевала опускаться до нуля).`);
    const powers = [...new Set(okRuns.map((r) => r.stateAtStart?.power?.source).filter(Boolean))];
    L.push(`* питание: ${powers.join(', ')}. Прогон от батареи (core.md §16) не выполнялся — см. \`decisions.md\` п. 13.`);
    L.push('* `cpuGovernor = powersave` (см. `machine.json`): повтор замера в другой день может отличаться на единицы процентов.');
    L.push('');
  }

  if (extraRuns.length) {
    L.push('## Добавочные прогоны (сверх матрицы задания, по core.md §16)');
    L.push('');
    L.push('| прогон | условие | gl | concurrency | профиль | кадров/с | wall-time, с | пик RSS, МБ | детерминизм |');
    L.push('|---|---|---|---|---|---|---|---|---|');
    for (const r of extraRuns) {
      if (r.status !== 'OK') {
        L.push(`| ${r.runId} | ${(r.extra?.note ?? '').replace(/\|/g, '/')} | ${r.config.gl} | ${r.config.concurrency} | ${r.config.profile} | FAILED | — | — | — |`);
        continue;
      }
      const d = r.derived ?? {};
      L.push(
        `| ${r.runId} | ${(r.extra?.note ?? '').replace(/\|/g, '/')} | ${r.config.gl} | ${r.config.concurrency} | ${r.config.profile} | ` +
          `${fmt(d.framesPerSecond_renderPhase)} | ${fmt(d.wallTimeSec, 1)} | ${fmt(r.memory?.peakRssSumMb, 0)} | ${detByConcurrency.get(r.runId)?.text ?? '—'} |`,
      );
    }
    L.push('');
  }

  L.push('## Из чего складывается wall-time');
  L.push('');
  L.push('| прогон | boot node, мс | тёплый бандл, мс | старт Chrome (проба), мс | до первого кадра, мс | рендер кадров, мс | хвост мукса, мс | framemd5, мс | ffprobe, мс |');
  L.push('|---|---|---|---|---|---|---|---|---|');
  for (const r of runs) {
    if (r.status !== 'OK') continue;
    const t = r.timings ?? {};
    L.push(
      `| ${r.runId} | ${t.nodeBootMs ?? '—'} | ${t.bundleMs ?? '—'} | ${t.chromeStartProbeMs ?? '—'} | ${t.preRenderOverheadMs ?? '—'} | ` +
        `${t.framesRenderPhaseMs ?? '—'} | ${t.stitchTailMs ?? '—'} | ${r.verification?.framemd5?.ms ?? '—'} | ${r.verification?.ffprobe?.ms ?? '—'} |`,
    );
  }
  L.push('');

  L.push('## Экстраполяция на AC2 (1800 кадров = 60 c при 30 fps)');
  L.push('');
  L.push('| прогон | кадров/с (рендер) | AC2, мин (рендер) | кадров/с (весь процесс) | AC2, мин (весь процесс) | порог ADR-0008 |');
  L.push('|---|---|---|---|---|---|');
  for (const r of runs) {
    if (r.status !== 'OK') continue;
    const d = r.derived ?? {};
    const v = r.config.profile === 'final' ? ac2Verdict(d.framesPerSecond_renderPhase) : {band: 'н/п (не final)'};
    L.push(
      `| ${r.runId} | ${fmt(d.framesPerSecond_renderPhase)} | ${fmt(d.ac2ProjectedMinutes_renderPhase)} | ` +
        `${fmt(d.framesPerSecond_endToEnd)} | ${fmt(d.ac2ProjectedMinutes_endToEnd)} | ${v.band} |`,
    );
  }
  L.push('');
  L.push('> Экстраполяция линейна и потому оптимистична: она не учитывает, что 60-секундный ролик — это ~8 сегментов, то есть ~8 стартов процесса и Chrome (столбец «до первого кадра»).');
  L.push('');

  if (bundle?.summary) {
    L.push('## Бандлинг');
    L.push('');
    L.push(`* холодный (пустой outDir и кэш, свежий процесс): ${bundle.summary.coldMsMin}–${bundle.summary.coldMsMax} мс`);
    L.push(`* тёплый: медиана ${bundle.summary.warmMsMedian} мс (${bundle.summary.warmMsMin}–${bundle.summary.warmMsMax} мс)`);
    L.push(
      `* два независимых холодных бандла побайтово ${bundle.summary.bundleReproducible ? '**совпали**' : '**разошлись**'}` +
        (bundle.summary.bundleReproducible ? '' : ` (файлы: ${bundle.summary.differingFiles.join(', ')})`) +
        ` — это ответ на U3 (ключ \`bundle\` в ADR-0006).`,
    );
    L.push('');
  }

  if (det) {
    L.push('## Детерминизм');
    L.push('');
    for (const block of det.blocks ?? []) {
      L.push(`### Блок ${block.id}. ${block.title}`);
      L.push('');
      L.push(`* конфигурация: ${block.configText}`);
      L.push(`* вердикт: **${block.verdict}**`);
      for (const note of block.notes ?? []) L.push(`* ${note}`);
      if (block.table) {
        L.push('');
        L.push(...block.table);
      }
      L.push('');
    }
  }

  const dist = readJson(path.join(RAW_DIR, 'distribution.json'));
  if (dist?.pairs?.length) {
    L.push('## Распределение расхождений (то, чем Charter предлагает задавать порог AC4)');
    L.push('');
    L.push('| пара прогонов | кадров совпало побитово | PSNR min, dB | p05 | p50 | p95 | max MSE |');
    L.push('|---|---|---|---|---|---|---|');
    for (const p of dist.pairs) {
      if (p.status !== 'OK') {
        L.push(`| ${p.label} | SKIPPED (${p.reason}) | — | — | — | — | — |`);
        continue;
      }
      const d = p.distribution;
      L.push(
        `| ${p.label} | ${d.identicalFrames} из ${d.frames} | ${d.psnrMinDb ?? '—'} | ${d.psnrP05Db ?? '—'} | ${d.psnrP50Db ?? '—'} | ${d.psnrP95Db ?? '—'} | ${d.maxMse ?? '—'} |`,
      );
    }
    L.push('');
    L.push('> `PSNR = inf` (кадр совпал побитово) исключён из перцентилей. Два совпадающих кадра в каждой паре — первый и последний: они полностью чёрные из-за входа/выхода через затемнение.');
    L.push('');
  }

  const px = readJson(path.join(RAW_DIR, 'pixeldiff.json'));
  if (px?.summary) {
    L.push('## Насколько велико расхождение в пикселях (сырые кадры, без энкодера)');
    L.push('');
    L.push(`* конфигурация: ${px.config}, кадры ${px.frameRange[0]}–${px.frameRange[1]}`);
    L.push(`* кадров сравнено ${px.summary.framesCompared}, побитово совпало ${px.summary.identicalFrames}`);
    L.push(`* доля различающихся субпикселей: медиана ${px.summary.medianDifferingSharePercent} %, максимум ${px.summary.maxDifferingSharepercent} %`);
    L.push(`* максимальное отклонение уровня: ${px.summary.maxAbsDiffOverall} из 255`);
    const f0 = (px.frames ?? []).find((f) => !f.identical);
    if (f0?.histogramOfAbsDiff) {
      const total = f0.differingSubpixels;
      const one = f0.histogramOfAbsDiff['1'] ?? 0;
      const two = (f0.histogramOfAbsDiff['1'] ?? 0) + (f0.histogramOfAbsDiff['2'] ?? 0);
      L.push(
        `* на кадре \`${f0.file}\`: из ${total.toLocaleString('ru-RU')} различающихся субпикселей ` +
          `${Math.round((one / total) * 1000) / 10} % отличаются ровно на 1 уровень, ${Math.round((two / total) * 1000) / 10} % — не больше чем на 2; хвост доходит до ${f0.maxAbsDiff}.`,
      );
    }
    L.push('');
  }

  const net = readJson(path.join(RAW_DIR, 'network-isolation.json'));
  if (net?.checks?.length) {
    L.push('## Сеть во время рендера (V9)');
    L.push('');
    for (const c of net.checks) L.push(`* ${c.passed ? '✓' : '✗'} ${c.title} — ожидалось: ${c.expected}`);
    L.push(`* вердикт: **${net.verdict}**`);
    L.push('');
  }

  const failed = runs.filter((r) => r.status !== 'OK');
  if (failed.length) {
    L.push('## Упавшие конфигурации');
    L.push('');
    L.push('| прогон | статус | причина |');
    L.push('|---|---|---|');
    for (const r of failed) {
      L.push(`| ${r.runId} | ${r.status} | ${(r.error?.message ?? '—').replace(/\|/g, '/').replace(/\n/g, ' ').slice(0, 300)} |`);
    }
    L.push('');
  }

  const finalRuns = matrixRuns.filter((r) => r.status === 'OK' && r.config.profile === 'final');
  if (finalRuns.length) {
    const best = finalRuns.reduce((a, b) =>
      (a.derived?.framesPerSecond_renderPhase ?? 0) >= (b.derived?.framesPerSecond_renderPhase ?? 0) ? a : b,
    );
    const bestSw = finalRuns
      .filter((r) => r.config.gl === 'swangle')
      .reduce((a, b) => ((a?.derived?.framesPerSecond_renderPhase ?? 0) >= (b.derived?.framesPerSecond_renderPhase ?? 0) ? a : b), null);
    L.push('## Вердикт по порогам ADR-0008');
    L.push('');
    if (bestSw) {
      const v = ac2Verdict(bestSw.derived.framesPerSecond_renderPhase);
      L.push(
        `* Лучший прогон профиля \`final\` на **swangle** (профиль по умолчанию): ${bestSw.runId}, ` +
          `${fmt(bestSw.derived.framesPerSecond_renderPhase)} кадра/с ⇒ полоса **${v.band}** ⇒ ${v.decision}.`,
      );
    }
    const v2 = ac2Verdict(best.derived.framesPerSecond_renderPhase);
    L.push(
      `* Лучший прогон профиля \`final\` вообще: ${best.runId}, ${fmt(best.derived.framesPerSecond_renderPhase)} кадра/с ⇒ полоса **${v2.band}**.`,
    );
    const worstSw = finalRuns
      .filter((r) => r.config.gl === 'swangle')
      .reduce((a, b) => ((a?.derived?.framesPerSecond_renderPhase ?? Infinity) <= (b.derived.framesPerSecond_renderPhase ?? Infinity) ? a : b), null);
    if (worstSw) {
      const v3 = ac2Verdict(worstSw.derived.framesPerSecond_renderPhase);
      L.push(
        `* Худший прогон профиля \`final\` на swangle: ${worstSw.runId}, ${fmt(worstSw.derived.framesPerSecond_renderPhase)} кадра/с ⇒ полоса **${v3.band}**.`,
      );
    }
    const load = extraRuns.find((r) => r.runId === 'extra-cpuload' && r.status === 'OK');
    if (load) {
      const vl = ac2Verdict(load.derived.framesPerSecond_renderPhase);
      L.push(
        `* Тот же профиль под нагрузкой CPU (6 занятых потоков из 12): ${fmt(load.derived.framesPerSecond_renderPhase)} кадра/с ⇒ полоса **${vl.band}** — ` +
          `запас съедается посторонней нагрузкой, и это не гипотеза, а измерение.`,
      );
    }
    L.push('');
  }

  return L.join('\n') + '\n';
};

export const writeSummary = () => {
  const out = path.join(ROOT, 'results/summary.md');
  fs.mkdirSync(path.dirname(out), {recursive: true});
  fs.writeFileSync(out, buildSummary());
  return out;
};
