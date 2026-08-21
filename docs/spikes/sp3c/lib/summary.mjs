/**
 * SP-3c: сборка results/summary.md из results/raw. Только числа; истолкование — в findings.md.
 * Пересобирается сколько угодно раз, ничего не считает заново.
 */
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from './env.mjs';

const RAW = path.join(ROOT, 'results/raw');
const readJson = (f) => {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
};
const num = (v, d = 2) => (v === null || v === undefined || Number.isNaN(v) ? '—' : typeof v === 'number' ? String(Math.round(v * 10 ** d) / 10 ** d) : String(v));
const short = (h) => (h ? String(h).slice(0, 16) : '—');
const tbl = (head, rows) =>
  [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');

export const writeSummary = () => {
  const runs = fs
    .readdirSync(RAW)
    .filter((f) => f.endsWith('.json'))
    .map((f) => readJson(path.join(RAW, f)))
    .filter((r) => r && r.schema === 'sp3c-run/1');
  const machine = readJson(path.join(ROOT, 'results/machine.json'));
  const fixture = readJson(path.join(ROOT, 'results/fixture.json'));
  const det = readJson(path.join(RAW, 'determinism.json'));
  const net = readJson(path.join(RAW, 'network-isolation.json'));
  const enc = readJson(path.join(RAW, 'own-encode.json'));
  const startup = readJson(path.join(RAW, 'startup-cost.json'));
  const long = readJson(path.join(RAW, 'long-run.json'));
  const bundleRepro = readJson(path.join(RAW, 'build-repro.json'));

  const hf = runs.filter((r) => r.renderer === 'hyperframes');
  const rm = runs.filter((r) => r.renderer === 'remotion');
  const ok = (r) => r.status === 'OK';

  const L = [];
  L.push('# SP-3c — сводка замеров: HyperFrames рядом с числами SP-3');
  L.push('');
  L.push(`* **Собрано:** ${new Date().toISOString()} (файл пересобирается из \`results/raw\`)`);
  if (machine) {
    L.push(
      `* **Машина:** ${machine.machine.cpuModel}, ${machine.machine.cpuPhysicalCores} ядер / ${machine.machine.cpuLogical} потоков, ${machine.machine.ramTotalGiB} GiB, ${machine.machine.os}, kernel ${machine.machine.kernel}, governor ${machine.machine.cpuGovernor}, питание: ${machine.state.power.source} (батареи нет)`,
    );
    L.push(
      `* **ЭТО ДРУГАЯ МАШИНА, чем в SP-3.** SP-3 снят на ${machine.sp3Machine.machine.cpuModel}, ${machine.sp3Machine.machine.cpuLogical} потоков, ${machine.sp3Machine.machine.ramTotalGiB} GiB, ${machine.sp3Machine.machine.os}. Кадров/с из SP-3 и SP-3c напрямую не сравнимы — для сравнения на одном железе снят контрольный Remotion (раздел «Контроль»).`,
    );
    const v = machine.versions;
    L.push(
      `* **Версии:** node ${v.node}, hyperframes ${v.hyperframesCli} (core/engine/producer ${v.hyperframesCore}), gsap ${v.gsap}, puppeteer ${v.puppeteer}, ${v.chromeHeadlessShell}, ffmpeg ${v.ffmpeg?.match(/version (\S+)/)?.[1]}, ffprobe ${v.ffprobe?.match(/version (\S+)/)?.[1]}; контрольный remotion ${v.remotionControl}`,
    );
  }
  if (fixture) {
    L.push(
      `* **Композиция:** ${fixture.composition.width}×${fixture.composition.height}, ${fixture.composition.fps} fps, ${fixture.composition.durationInFrames} кадров: фон + Ken Burns 1.0→1.15, пословные субтитры (${fixture.composition.captionPages} страниц, ${fixture.composition.captionTokens} токенов), затемнение. Общие с SP-3 ассеты совпали побайтово: ${fixture.assetIdentityWithSp3.every((p) => p.equal) ? 'да' : 'НЕТ'}.`,
    );
  }
  L.push('* **Этот файл — только числа.** Истолкование с пометками FACT/INFERENCE/UNKNOWN — в [findings.md](findings.md); решения по ходу — в [decisions.md](decisions.md).');
  L.push('');

  // ── Матрица HyperFrames ───────────────────────────────────────────────
  const matrixRows = (list, filter) =>
    list
      .filter((r) => ok(r) && filter(r))
      .sort((a, b) => a.runId.localeCompare(b.runId))
      .map((r) => [
        r.runId,
        r.config.profile,
        String(r.config.workers),
        r.config.gpu === 'sw' ? 'SwiftShader' : 'аппаратный',
        r.captureMode ?? '—',
        num(r.derived?.framesPerSecond_framesOnly),
        num(r.derived?.framesPerSecond_renderPhase),
        num(r.derived?.framesPerSecond_endToEnd),
        num(r.derived?.wallTimeSec, 1),
        num(r.memory?.peakRssSumMb, 0),
        short(r.verification?.outputSha256 ?? r.verification?.dirHash),
      ]);
  const HEAD = ['прогон', 'профиль', 'workers', 'GPU', 'захват', 'кадров/с (кадры)', 'кадров/с (фаза рендера)', 'кадров/с (весь процесс)', 'wall, с', 'пик RSS, МБ', 'sha256'];

  L.push('## Матрица HyperFrames');
  L.push('');
  L.push('**«кадров/с (кадры)»** — только фаза захвата. При `workers=1` HyperFrames кодирует потоково, поэтому энкод вплетён в эту фазу; при `workers>1` захват (`capture_disk`) и энкод (`encode`) разделены, и это число — чистая растеризация.');
  L.push('**«кадров/с (фаза рендера)»** — от старта захвата до конца конвейера: захват + энкод + сборка.');
  L.push('**«кадров/с (весь процесс)»** — весь вызов CLI, включая старт node, компиляцию HTML, пробу браузера и файловый сервер.');
  L.push('**«пик RSS»** — сумма VmRSS по дереву процессов тем же прибором, что в SP-3 (`sp3/lib/proctree.mjs`); завышает за счёт общих страниц, честная нижняя оценка Pss — в raw-JSON.');
  L.push('');
  const rowsA = matrixRows(hf, (r) => r.runId.startsWith('hfA-'));
  if (rowsA.length) {
    L.push('### Блок A — путь по умолчанию: beginFrame + аппаратный GPU');
    L.push('');
    L.push(tbl(HEAD, rowsA));
    L.push('');
  }
  const rowsB = matrixRows(hf, (r) => r.runId.startsWith('hfB-'));
  if (rowsB.length) {
    L.push('### Блок B — SwiftShader (`--no-browser-gpu`), аналог `gl=swangle` из SP-3');
    L.push('');
    L.push(tbl(HEAD, rowsB));
    L.push('');
  }
  const rowsC = matrixRows(hf, (r) => r.runId.startsWith('hfC-'));
  if (rowsC.length) {
    L.push('### Блок C — под посторонней нагрузкой CPU (6 занятых потоков из 12)');
    L.push('');
    L.push(tbl(HEAD, rowsC));
    L.push('');
  }
  const rowsD = matrixRows(hf, (r) => r.runId.startsWith('hfD-'));
  if (rowsD.length) {
    L.push('### Блок D — fallback-режим захвата (`PRODUCER_FORCE_SCREENSHOT=true`), тот же mp4');
    L.push('');
    L.push(tbl(HEAD, rowsD));
    L.push('');
  }
  const rowsE = hf
    .filter((r) => ok(r) && r.runId.startsWith('hfE-'))
    .sort((a, b) => a.runId.localeCompare(b.runId))
    .map((r) => [
      r.runId,
      String(r.config.workers),
      r.config.gpu === 'sw' ? 'SwiftShader' : 'аппаратный',
      String(r.verification?.fileCount ?? '—'),
      num((r.verification?.totalBytes ?? 0) / 1024 ** 2, 0),
      num(r.derived?.wallTimeSec, 1),
      num(r.memory?.peakRssSumMb, 0),
      short(r.verification?.dirHash),
      short(r.verification?.framemd5?.sha256),
    ]);
  if (rowsE.length) {
    L.push('### Блок E — PNG-сиквенс без энкодера (`--format png-sequence`)');
    L.push('');
    L.push('> `--format png-sequence` переводит захват в **screenshot**-режим (см. `browserLaunchLine` в raw-JSON), поэтому это детерминизм fallback-пути, а не beginFrame.');
    L.push('');
    L.push(tbl(['прогон', 'workers', 'GPU', 'PNG', 'суммарно, МБ', 'wall, с', 'пик RSS, МБ', 'dirHash', 'sha256(framemd5)'], rowsE));
    L.push('');
  }
  const rowsF = matrixRows(hf, (r) => r.runId.startsWith('hfF-') || r.runId.startsWith('hfG-'));
  if (rowsF.length) {
    L.push('### Блоки F/G — добавочные прогоны (workers 8, половинный draft 540×960, серия повторов)');
    L.push('');
    L.push(tbl(HEAD, rowsF));
    L.push('');
  }

  // ── Контроль Remotion ────────────────────────────────────────────────
  if (rm.length) {
    L.push('## Контроль: Remotion 4.0.513 на ЭТОЙ же машине');
    L.push('');
    L.push('Композиция — `docs/spikes/sp3/src` без единой правки, профили и флаги энкодера — `docs/spikes/sp3/lib/profiles.mjs`. Числа SP-3 при этом не пересматриваются: этот блок нужен только чтобы кадров/с HyperFrames было с чем сравнивать на одном железе.');
    L.push('');
    L.push(
      tbl(
        ['прогон', 'gl', 'concurrency', 'профиль', 'кадров/с (кадры)', 'кадров/с (фаза рендера)', 'кадров/с (весь процесс)', 'wall, с', 'пик RSS, МБ', 'sha256'],
        rm
          .filter(ok)
          .sort((a, b) => a.runId.localeCompare(b.runId))
          .map((r) => [
            r.runId,
            r.config.gl,
            String(r.config.concurrency),
            r.config.profile,
            num(r.render?.fps?.framesOnly),
            num(r.render?.fps?.renderPhase),
            num(r.render?.fps?.endToEnd),
            num((r.timings?.totalMs ?? 0) / 1000, 1),
            num(r.memory?.peakRssSumMb, 0),
            short(r.verification?.outputSha256),
          ]),
      ),
    );
    L.push('');
  }

  // ── Из чего складывается wall-time ───────────────────────────────────
  const wallRows = hf
    .filter(ok)
    .sort((a, b) => a.runId.localeCompare(b.runId))
    .map((r) => [
      r.runId,
      num(r.timings?.nodeBootMs, 0),
      num(r.timings?.preRenderOverheadMs, 0),
      num(r.timings?.toCaptureStartMs, 0),
      num(r.timings?.captureMs, 0),
      num(r.timings?.encodeMs, 0),
      num(r.timings?.assembleMs, 0),
      num(r.timings?.postPipelineMs, 0),
      num(r.verification?.framemd5?.ms, 0),
      num(r.verification?.ffprobe?.ms, 0),
    ]);
  if (wallRows.length) {
    L.push('## Из чего складывается wall-time (HyperFrames, мс)');
    L.push('');
    L.push('**«до старта захвата»** — компиляция HTML, проба браузера, файловый сервер, проба GPU внутри конвейера. **«старт на сегмент»** = старт node + загрузка CLI + всё до старта захвата: это то, что ADR-0008 кладёт в `minSegmentDurationFrames`.');
    L.push('');
    L.push(tbl(['прогон', 'boot node', 'старт на сегмент', 'до старта захвата', 'захват', 'энкод', 'сборка', 'хвост после конвейера', 'framemd5', 'ffprobe'], wallRows));
    L.push('');
  }

  // ── AC2 ──────────────────────────────────────────────────────────────
  const ac2 = [...hf, ...rm]
    .filter(ok)
    .filter((r) => (r.config.profile ?? '') === 'final')
    .sort((a, b) => a.runId.localeCompare(b.runId))
    .map((r) => {
      const fpsRender = r.derived?.framesPerSecond_renderPhase ?? r.render?.fps?.renderPhase ?? null;
      const fpsAll = r.derived?.framesPerSecond_endToEnd ?? r.render?.fps?.endToEnd ?? null;
      const band = (f) => (f === null ? '—' : f >= 4 ? '≥ 4 кадра/с' : f >= 2 ? '2–4 кадра/с' : f >= 1 ? '1–2 кадра/с' : f >= 0.5 ? '0.5–1 кадр/с' : '< 0.5 кадра/с');
      return [
        r.runId,
        r.renderer,
        num(fpsRender),
        fpsRender ? num(1800 / fpsRender / 60) : '—',
        num(fpsAll),
        fpsAll ? num(1800 / fpsAll / 60) : '—',
        band(fpsRender),
      ];
    });
  if (ac2.length) {
    L.push('## Экстраполяция на AC2 (1800 кадров = 60 c при 30 fps), профиль final');
    L.push('');
    L.push(tbl(['прогон', 'рендерер', 'кадров/с (фаза рендера)', 'AC2, мин (фаза рендера)', 'кадров/с (весь процесс)', 'AC2, мин (весь процесс)', 'полоса ADR-0008'], ac2));
    L.push('');
    L.push('> Экстраполяция линейна и потому оптимистична. Прямой замер на 1800 кадрах — ниже, в разделе «Прямой замер 60 секунд».');
    L.push('');
  }

  if (long) {
    L.push('## Прямой замер 60 секунд (1800 кадров одним сегментом, без экстраполяции)');
    L.push('');
    L.push(
      tbl(
        ['прогон', 'рендерер', 'кадров', 'кадров/с (кадры)', 'кадров/с (весь процесс)', 'wall, мин', 'пик RSS, МБ', 'sha256'],
        long.runs.map((r) => [r.runId, r.renderer, String(r.frames), num(r.fpsFramesOnly), num(r.fpsEndToEnd), num(r.wallSec / 60), num(r.peakRssMb, 0), short(r.sha256)]),
      ),
    );
    L.push('');
  }

  // ── Сводка детерминизма по настройкам ────────────────────────────────
  {
    const key = (r) => {
      if (r.renderer === 'hyperframes') {
        const c = r.config;
        const comp = {src: 'точная', 'src-idiomatic': 'идиоматичная', 'src-draft': 'половинная'}[c.project] ?? c.project;
        const mode = c.profile === 'pngseq' ? 'PNG-сиквенс' : c.envOverrides?.PRODUCER_FORCE_SCREENSHOT ? 'screenshot' : 'beginFrame';
        return [comp, c.profile, c.gpu === 'sw' ? 'SwiftShader' : 'аппаратный', `w${c.workers}`, c.cpuLoadProcesses ? 'нагрузка 6' : 'вхолостую', mode];
      }
      const c = r.config;
      return ['Remotion (контроль)', c.profile, c.gl, `c${c.concurrency}`, 'вхолостую', c.mode === 'frames' ? 'PNG-сиквенс' : 'media'];
    };
    const groups = new Map();
    for (const r of runs.filter(ok)) {
      const h = r.verification?.outputSha256 ?? r.verification?.dirHash;
      if (!h) continue;
      const k = key(r).join('\u0001');
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(h);
    }
    const rows = [...groups.entries()]
      .map(([k, hs]) => [...k.split('\u0001'), String(hs.length), String(new Set(hs).size)])
      .sort((a, b) => a.join().localeCompare(b.join()));
    L.push('## Сводка детерминизма по настройкам');
    L.push('');
    L.push('Одна строка — одна настройка. «прогонов» — сколько снято, «разных выходов» — сколько различных sha256 (для PNG-сиквенсов — dirHash) среди них. Единица во второй колонке означает, что все прогоны этой настройки дали побайтово равный результат.');
    L.push('');
    L.push(tbl(['композиция', 'профиль', 'бэкенд', 'параллелизм', 'условие', 'путь захвата', 'прогонов', 'разных выходов'], rows));
    L.push('');
    L.push(`Всего прогонов с наблюдаемым выходом: **${[...groups.values()].reduce((a, v) => a + v.length, 0)}**.`);
    L.push('');
  }

  // ── Детерминизм ──────────────────────────────────────────────────────
  if (det) {
    L.push('## Детерминизм');
    L.push('');
    L.push(`* прибор: ${det.method.fileHash}; ${det.method.framemd5}`);
    L.push('');
    L.push(
      tbl(
        ['группа', 'прогонов', 'разных файлов', 'разных framemd5', 'вердикт', 'первый разошедшийся кадр'],
        det.groups.map((g) => [g.title, String(g.runs.length), String(g.distinctFileHashes), String(g.distinctFramemd5), `**${g.verdict}**`, g.firstDiffFrame === null ? '—' : String(g.firstDiffFrame)]),
      ),
    );
    L.push('');
  }

  if (enc) {
    L.push('## Собственный энкод PNG-сиквенса (рецепт SP-3 блок D)');
    L.push('');
    L.push(`* рецепт: ${enc.recipe}`);
    L.push('');
    L.push(
      tbl(
        ['вход', 'кадров', 'threads=4 энкод 1', 'threads=4 энкод 2', 'энкодер детерминирован', 'threads=1 == threads=4'],
        enc.encodes.filter((e) => !e.error).map((e) => [e.framesDir, String(e.frames), short(e.threads4_encode1.sha256), short(e.threads4_encode2.sha256), e.encoderDeterministic ? 'да' : 'НЕТ', e.threads1VsThreads4Equal ? 'да' : 'нет']),
      ),
    );
    L.push('');
  }

  // ── Расхождения в пикселях ───────────────────────────────────────────
  const pxFiles = fs.readdirSync(RAW).filter((f) => f.startsWith('pixeldiff-') && f.endsWith('.json'));
  if (pxFiles.length) {
    L.push('## Расхождения в пикселях (сырые кадры)');
    L.push('');
    L.push(
      tbl(
        ['сравнение', 'кадров', 'совпало побитово', 'медиана доли различающихся субпикселей, %', 'макс отклонение, уровней', 'PSNR min, dB', 'PSNR медиана, dB'],
        pxFiles
          .map((f) => readJson(path.join(RAW, f)))
          .filter(Boolean)
          .map((d) => [
            `${d.a.label} против ${d.b.label}`,
            String(d.summary?.framesCompared ?? '—'),
            String(d.summary?.identicalFrames ?? '—'),
            num(d.summary?.medianDifferingSharePercent, 4),
            String(d.summary?.maxAbsDiffOverall ?? '—'),
            num(d.summary?.minPsnrDb),
            num(d.summary?.medianPsnrDb),
          ]),
      ),
    );
    L.push('');
  }

  if (startup) {
    L.push('## Стоимость старта на сегмент (Q5)');
    L.push('');
    L.push(
      tbl(
        ['измерение', 'мс'],
        Object.entries(startup.measurements).map(([k, v]) => [k, num(v, 0)]),
      ),
    );
    L.push('');
  }

  if (bundleRepro) {
    L.push('## Воспроизводимость сборки (U3 для нового кандидата)');
    L.push('');
    L.push(
      tbl(
        ['что', 'значение'],
        Object.entries(bundleRepro.summary).map(([k, v]) => [k, String(v)]),
      ),
    );
    L.push('');
  }

  if (net) {
    L.push('## Сеть во время рендера (V9)');
    L.push('');
    for (const c of net.checks) L.push(`* ${c.passed === null ? '·' : c.passed ? '✓' : '✗'} ${c.title} — ожидалось: ${c.expected ?? c.note}`);
    L.push(`* вердикт: **${net.verdict}**`);
    L.push('');
  }

  const failed = runs.filter((r) => r.status !== 'OK');
  L.push('## Прогоны, которые не сняты');
  L.push('');
  if (!failed.length) L.push('Все запущенные прогоны завершились успешно.');
  else L.push(tbl(['прогон', 'причина'], failed.map((r) => [r.runId, r.error?.message ?? '—'])));
  L.push('');

  fs.writeFileSync(path.join(ROOT, 'results/summary.md'), L.join('\n') + '\n');
  return {runs: runs.length, ok: runs.filter(ok).length, failed: failed.length};
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const s = writeSummary();
  console.log(`summary.md собран: ${s.ok} OK, ${s.failed} FAILED из ${s.runs}`);
}
