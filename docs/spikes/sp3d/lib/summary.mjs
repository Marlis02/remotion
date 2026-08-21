/**
 * SP-3d: сборка results/summary.md из results/raw. Только числа; истолкование — в findings.md.
 * Ничего не считает заново, пересобирается сколько угодно раз.
 */
import fs from 'node:fs';
import path from 'node:path';
import {ROOT, SP3C} from './env.mjs';

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
const median = (a) => {
  const s = a.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((x, y) => x - y);
  if (!s.length) return null;
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

const COMP = {src: 'точная', 'src-idiomatic': 'идиоматичная', 'src-draft': 'половинная', 'src-60s': 'точная 60 с'};
const SEP = '§';

export const writeSummary = () => {
  const runs = fs
    .readdirSync(RAW)
    .filter((f) => f.endsWith('.json'))
    .map((f) => readJson(path.join(RAW, f)))
    .filter((r) => r && r.schema === 'sp3d-run/1');
  const ok = (r) => r.status === 'OK';
  const machine = readJson(path.join(ROOT, 'results/machine.json'));
  const fixture = readJson(path.join(ROOT, 'results/fixture.json'));
  const det = readJson(path.join(RAW, 'determinism.json'));
  const net = readJson(path.join(RAW, 'network-isolation.json'));
  const q4 = readJson(path.join(RAW, 'q4-compare.json'));
  const probe = readJson(path.join(RAW, 'image-probe.json'));
  const enc = readJson(path.join(RAW, 'own-encode.json'));
  const sp3cMachine = readJson(path.join(SP3C, 'results/machine.json'));
  const localRuns = fs
    .readdirSync(RAW)
    .filter((f) => f.endsWith('.json'))
    .map((f) => readJson(path.join(RAW, f)))
    .filter((r) => r && r.schema === 'sp3d-local-run/1');
  const hostLoad = (() => {
    const f = path.join(ROOT, 'results/hostload.jsonl');
    if (!fs.existsSync(f)) return null;
    const rows = fs
      .readFileSync(f, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    if (!rows.length) return null;
    const l1 = rows.map((r) => r.load1);
    const mem = rows.map((r) => r.memAvailableKb / 1024 ** 2);
    return {
      samples: rows.length,
      from: rows[0].at,
      to: rows[rows.length - 1].at,
      load1Min: Math.min(...l1),
      load1Median: median(l1),
      load1Max: Math.max(...l1),
      memAvailMinGiB: Math.min(...mem),
      memAvailMedianGiB: median(mem),
      tempMaxC: Math.max(...rows.map((r) => r.tempMilliC / 1000)),
    };
  })();

  const L = [];
  L.push('# SP-3d — сводка замеров: Docker-режим HyperFrames');
  L.push('');
  L.push(`* **Собрано:** ${new Date().toISOString()} (файл пересобирается из \`results/raw\`)`);
  if (machine) {
    L.push(
      `* **Машина:** ${machine.machine.cpuModel}, ${machine.machine.cpuPhysicalCores} ядер / ${machine.machine.cpuLogical} потоков, ${machine.machine.ramTotalGiB} GiB, ${machine.machine.os}, kernel ${machine.machine.kernel}, governor ${machine.machine.cpuGovernor}. **Та же машина, что SP-3c**${sp3cMachine ? ` (${sp3cMachine.machine.cpuModel})` : ''}; SP-3 снят на другой.`,
    );
    L.push(
      `* **Docker:** сервер ${machine.docker.info?.ServerVersion}, storage ${machine.docker.info?.Driver}, cgroup ${machine.docker.info?.CgroupVersion}/${machine.docker.info?.CgroupDriver}, ${machine.docker.info?.NCPU} CPU, ${Math.round((machine.docker.info?.MemTotal ?? 0) / 1024 ** 3)} GiB.`,
    );
    L.push(
      `* **Образ:** \`${machine.image.tag}\`, id \`${machine.image.id}\`, создан ${machine.image.created}, ${Math.round((machine.image.sizeBytes ?? 0) / 1024 ** 2)} МБ, ${machine.image.architecture}. **Собран локально, не скачан.** RepoDigests: \`${JSON.stringify(machine.image.repoDigests)}\` — это повтор локального id, а не digest реестра.`,
    );
    L.push(`* **База образа:** ${machine.image.baseImage.reference}; на момент сверки \`${(machine.image.baseImage.repoDigests ?? []).join(', ') || '—'}\`, создана ${machine.image.baseImage.created}.`);
    const v = machine.versions;
    L.push(`* **Версии на хосте:** node ${v.node}, hyperframes ${v.hyperframesCli}, ffmpeg ${v.ffmpeg?.match(/version (\S+)/)?.[1]}, ffprobe ${v.ffprobe?.match(/version (\S+)/)?.[1]}, chrome-headless-shell (локальный путь SP-3c) ${v.chromeHeadlessShell}.`);
  }
  if (probe) {
    const p = (k) => probe.probes[k]?.out ?? '—';
    L.push(
      `* **Версии внутри образа:** ${p('osRelease').split('\n')[0].replace('PRETTY_NAME=', '').replace(/"/g, '')}, node ${p('nodeVersion')}, hyperframes ${(p('hyperframesVersion').match(/hyperframes@(\S+)/) ?? [])[1]}, ` +
        `chrome-headless-shell ${(p('headlessShellVersion').match(/Chrome for Testing (\S+)/) ?? [])[1]}, ffmpeg ${(p('ffmpegVersion').match(/ffmpeg version (\S+)/) ?? [])[1]}, шрифтовых начертаний ${p('fontsCount')}.`,
    );
  }
  if (fixture) {
    L.push(
      `* **Композиции:** взяты из SP-3c как есть, без правок; sha256 каждого файла — в [fixture.json](fixture.json). ${fixture.composition.width}×${fixture.composition.height}, ${fixture.composition.fps} fps, ${fixture.composition.durationInFrames} кадров.`,
    );
  }
  if (hostLoad) {
    L.push(
      `* **ХОСТ НЕ ПРОСТАИВАЛ.** За время матрицы (${hostLoad.samples} замеров, ${hostLoad.from} — ${hostLoad.to}) loadavg(1 мин) шёл от **${num(hostLoad.load1Min, 1)}** до **${num(hostLoad.load1Max, 1)}** при медиане **${num(hostLoad.load1Median, 1)}** на 12 потоках; доступной памяти медианно ${num(hostLoad.memAvailMedianGiB, 1)} GiB (минимум ${num(hostLoad.memAvailMinGiB, 1)} GiB), максимум температуры ${num(hostLoad.tempMaxC, 0)} °C. Постороннюю нагрузку создают процессы владельца (\`next-server\`, ~700 % CPU и 53 % RAM, и \`qemu-system-x86_64\` — Win10 VM на 4 vCPU / 8 ГБ). **Числа кадров/с из SP-3c сняты ночью на простаивающей машине и с числами этой таблицы напрямую не сравниваются.** Для честного сравнения снят парный ЛОКАЛЬНЫЙ софтверный путь в тех же условиях — раздел «Парный локальный путь».`,
    );
  }
  L.push('* **Этот файл — только числа.** Истолкование с пометками FACT/INFERENCE/UNKNOWN — в [findings.md](findings.md); решения по ходу — в [decisions.md](decisions.md).');
  L.push('');

  // ── Матрица одной таблицей ────────────────────────────────────────────
  L.push('## Матрица Docker-прогонов (одной таблицей)');
  L.push('');
  L.push('**«кадров/с (кадры)»** — фаза захвата. **«кадров/с (фаза рендера)»** — от старта захвата до конца конвейера (захват + энкод + сборка). **«кадров/с (весь процесс)»** — весь вызов CLI на хосте, включая старт контейнера. **«пик RSS контейнера»** — прибор SP-3 (`sp3/lib/proctree.mjs`), наведённый на хостовый PID init-процесса контейнера; **«cgroup peak»** — `memory.peak` cgroup-v2 того же контейнера. Обе величины сняты НЕ тем же корнем, что локальные числа SP-3c, и в одной таблице с ними не стоят.');
  L.push('');
  L.push(
    tbl(
      ['прогон', 'композиция', 'профиль', 'workers', 'условие', 'захват', 'кадров/с (кадры)', 'кадров/с (фаза рендера)', 'кадров/с (весь процесс)', 'wall, с', 'пик RSS контейнера, МБ', 'cgroup peak, МБ', 'байт', 'sha256'],
      runs
        .filter(ok)
        .sort((a, b) => a.runId.localeCompare(b.runId))
        .map((r) => [
          r.runId,
          COMP[r.config.project] ?? r.config.project,
          r.config.profile,
          String(r.config.workers),
          r.config.cpuLoadProcesses ? `нагрузка ${r.config.cpuLoadProcesses}` : 'вхолостую',
          r.captureMode ?? '—',
          num(r.derived?.framesPerSecond_framesOnly),
          num(r.derived?.framesPerSecond_renderPhase),
          num(r.derived?.framesPerSecond_endToEnd),
          num(r.derived?.wallTimeSec, 1),
          num(r.memory?.peakRssSumMb, 0),
          num(r.memoryContainer?.cgroupPeakMb, 0),
          String(r.verification?.outputBytes ?? r.verification?.totalBytes ?? '—'),
          short(r.verification?.outputSha256 ?? r.verification?.dirHash),
        ]),
    ),
  );
  L.push('');

  // ── Сводка детерминизма по настройкам ────────────────────────────────
  {
    const groups = new Map();
    for (const r of runs.filter(ok)) {
      const h = r.verification?.outputSha256 ?? r.verification?.dirHash;
      if (!h) continue;
      const k = [
        COMP[r.config.project] ?? r.config.project,
        r.config.profile,
        `w${r.config.workers}`,
        r.config.cpuLoadProcesses ? `нагрузка ${r.config.cpuLoadProcesses}` : 'вхолостую',
      ].join(SEP);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(h);
    }
    const rows = [...groups.entries()]
      .map(([k, hs]) => [...k.split(SEP), String(hs.length), String(new Set(hs).size), short([...new Set(hs)][0])])
      .sort((a, b) => a.join().localeCompare(b.join()));
    L.push('## Сводка детерминизма по настройкам (Docker)');
    L.push('');
    L.push('Одна строка — одна настройка. «разных выходов» — сколько различных sha256 среди прогонов настройки. Единица означает побайтово равные mp4.');
    L.push('');
    L.push(tbl(['композиция', 'профиль', 'параллелизм', 'условие', 'прогонов', 'разных выходов', 'sha256'], rows));
    L.push('');
    const exactFinal = runs.filter((r) => ok(r) && r.config.profile === 'final' && r.config.project === 'src');
    L.push(
      `Всего прогонов с наблюдаемым выходом: **${[...groups.values()].reduce((a, v) => a + v.length, 0)}**. ` +
        `Профиль final на точной композиции: **${exactFinal.length}** прогонов, различных sha256 среди них — **${new Set(exactFinal.map((r) => r.verification?.outputSha256)).size}**.`,
    );
    L.push('');
  }

  if (det) {
    L.push('## Детерминизм по группам');
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

  // ── Детерминизм: локально SP-3c против Docker SP-3d ──────────────────
  {
    const cc = readJson(path.join(RAW, 'crosscompare.json'));
    if (cc) {
      L.push('## Детерминизм по конфигурациям: локально SP-3c против Docker SP-3d');
      L.push('');
      L.push(`* ${cc.method}`);
      L.push(`* ${cc.note}`);
      L.push('');
      L.push(cc.markdown);
      L.push('');
      const forced = cc.rows.filter((r) => r.sp3cHardwareForcedScreenshot && r.sp3cHardwareForcedScreenshot.text !== '—');
      if (forced.length) {
        L.push('Отдельно — строки SP-3c, где захват был принудительно переведён в screenshot (`PRODUCER_FORCE_SCREENSHOT=true`) на аппаратном GPU. Это ближайший локальный аналог Docker по пути захвата, потому что Docker всегда software, а software у HyperFrames всегда screenshot:');
        L.push('');
        L.push(tbl(['композиция', 'профиль', 'workers', 'условие', 'локально SP-3c, аппаратный + screenshot', 'Docker SP-3d'], forced.map((r) => [r.composition, r.profile, r.workers, r.condition, r.sp3cHardwareForcedScreenshot.text, `**${r.dockerSp3d.text}**`])));
        L.push('');
      }
    }
  }

  // ── Скорость и память ────────────────────────────────────────────────
  {
    const med = (filter) => {
      const set = runs.filter((r) => ok(r) && filter(r));
      return {
        n: set.length,
        framesOnly: median(set.map((r) => r.derived?.framesPerSecond_framesOnly)),
        renderPhase: median(set.map((r) => r.derived?.framesPerSecond_renderPhase)),
        endToEnd: median(set.map((r) => r.derived?.framesPerSecond_endToEnd)),
        rss: median(set.map((r) => r.memory?.peakRssSumMb)),
        cgroup: median(set.map((r) => r.memoryContainer?.cgroupPeakMb)),
        overhead: median(set.map((r) => r.timings?.preRenderOverheadMs)),
        encode: median(set.map((r) => r.timings?.encodeMs)),
        capture: median(set.map((r) => r.timings?.captureMs)),
      };
    };
    const rows = [];
    for (const w of [1, 2, 4, 8]) {
      const m = med((r) => r.config.profile === 'final' && r.config.project === 'src' && r.config.workers === w && !r.config.cpuLoadProcesses);
      if (m.n) rows.push([`точная, final, w=${w}, вхолостую`, String(m.n), num(m.framesOnly), num(m.renderPhase), num(m.endToEnd), num(m.capture, 0), num(m.encode, 0), num(m.overhead, 0), num(m.rss, 0), num(m.cgroup, 0)]);
    }
    for (const [label, f] of [
      ['точная, draft, w=4, вхолостую', (r) => r.config.profile === 'draft' && r.config.project === 'src' && !r.config.cpuLoadProcesses],
      ['точная, final, w=4, нагрузка 6', (r) => r.config.profile === 'final' && r.config.project === 'src' && r.config.workers === 4 && r.config.cpuLoadProcesses === 6],
      ['идиоматичная, final, w=1, вхолостую', (r) => r.config.project === 'src-idiomatic' && r.config.workers === 1 && !r.config.cpuLoadProcesses],
      ['идиоматичная, final, w=4, вхолостую', (r) => r.config.project === 'src-idiomatic' && r.config.workers === 4 && !r.config.cpuLoadProcesses],
      ['идиоматичная, final, w=4, нагрузка 6', (r) => r.config.project === 'src-idiomatic' && r.config.workers === 4 && r.config.cpuLoadProcesses === 6],
      ['точная 60 с, final, w=4', (r) => r.config.project === 'src-60s'],
    ]) {
      const m = med(f);
      if (m.n) rows.push([label, String(m.n), num(m.framesOnly), num(m.renderPhase), num(m.endToEnd), num(m.capture, 0), num(m.encode, 0), num(m.overhead, 0), num(m.rss, 0), num(m.cgroup, 0)]);
    }
    L.push('## Скорость и память Docker (медианы по прогонам)');
    L.push('');
    L.push(tbl(['настройка', 'прогонов', 'кадров/с (кадры)', 'кадров/с (фаза рендера)', 'кадров/с (весь процесс)', 'захват, мс', 'энкод, мс', 'старт на сегмент, мс', 'пик RSS контейнера, МБ', 'cgroup peak, МБ'], rows));
    L.push('');
    L.push('> Числа SP-3c для сравнения берутся из `docs/spikes/sp3c/results/summary.md` как есть, без пересчёта; сопоставление — в findings.md, раздел Q2.');
    L.push('');
  }

  // ── Парный локальный софтверный путь, снятый в тех же условиях хоста ──
  if (localRuns.length) {
    const okLocal = localRuns.filter(ok);
    L.push('## Парный локальный путь (без Docker, `--no-browser-gpu`), снят в тех же условиях хоста');
    L.push('');
    L.push('Тот же CLI той же версии, та же композиция, тот же прибор памяти (корень дерева — процесс CLI, как в SP-3c). Нужен потому, что числа SP-3c сняты ночью на простаивающей машине: без этой пары «Docker медленнее локального» было бы утверждением о загрузке хоста, а не о режиме.');
    L.push('');
    L.push(
      tbl(
        ['прогон', 'профиль', 'workers', 'захват', 'кадров/с (кадры)', 'кадров/с (фаза рендера)', 'кадров/с (весь процесс)', 'wall, с', 'пик RSS дерева CLI, МБ', 'loadavg на старте', 'байт', 'sha256'],
        okLocal
          .sort((a, b) => a.runId.localeCompare(b.runId))
          .map((r) => [
            r.runId,
            r.config.profile,
            String(r.config.workers),
            r.captureMode ?? '—',
            num(r.derived?.framesPerSecond_framesOnly),
            num(r.derived?.framesPerSecond_renderPhase),
            num(r.derived?.framesPerSecond_endToEnd),
            num(r.derived?.wallTimeSec, 1),
            num(r.memory?.peakRssSumMb, 0),
            num(r.stateAtStart?.loadAvg?.[0], 1),
            String(r.verification?.outputBytes ?? r.verification?.totalBytes ?? '—'),
            short(r.verification?.outputSha256 ?? r.verification?.dirHash),
          ]),
      ),
    );
    L.push('');
    // Прямое сопоставление медиан Docker ↔ локально при одинаковых workers.
    const rows = [];
    for (const w of [1, 2, 4]) {
      const d = runs.filter((r) => ok(r) && r.config.profile === 'final' && r.config.project === 'src' && r.config.workers === w && !r.config.cpuLoadProcesses);
      const l = okLocal.filter((r) => r.config.profile === 'final' && r.config.workers === w);
      if (!d.length || !l.length) continue;
      const dm = median(d.map((r) => r.derived?.framesPerSecond_framesOnly));
      const lm = median(l.map((r) => r.derived?.framesPerSecond_framesOnly));
      const dr = median(d.map((r) => r.derived?.framesPerSecond_renderPhase));
      const lr = median(l.map((r) => r.derived?.framesPerSecond_renderPhase));
      const de = median(d.map((r) => r.derived?.framesPerSecond_endToEnd));
      const le = median(l.map((r) => r.derived?.framesPerSecond_endToEnd));
      rows.push([
        `w=${w}`,
        `${d.length} / ${l.length}`,
        `${num(dm)} / ${num(lm)}`,
        lm ? num(dm / lm) : '—',
        `${num(dr)} / ${num(lr)}`,
        lr ? num(dr / lr) : '—',
        `${num(de)} / ${num(le)}`,
        le ? num(de / le) : '—',
        `${num(median(d.map((r) => r.memory?.peakRssSumMb)), 0)} / ${num(median(l.map((r) => r.memory?.peakRssSumMb)), 0)}`,
      ]);
    }
    if (rows.length) {
      L.push('### Docker против локального софтверного пути (медианы, одна и та же машина, одни и те же сутки)');
      L.push('');
      L.push(tbl(['workers', 'прогонов Docker / локально', 'кадров/с (кадры) D / L', 'отношение', 'кадров/с (фаза рендера) D / L', 'отношение', 'кадров/с (весь процесс) D / L', 'отношение', 'пик RSS D(контейнер) / L(дерево CLI), МБ'], rows));
      L.push('');
      L.push('> Колонка RSS в этой таблице сравнивает величины, снятые ОТ РАЗНЫХ КОРНЕЙ (дерево контейнера против дерева процесса CLI). Прибор один, объект разный; читать как порядок величины, а не как разность.');
      L.push('');
    }

    // Блок K: прогоны шли строго по очереди Docker ↔ локально, поэтому отношение
    // не зависит от того, чем хост был занят в тот час.
    const kd = runs.filter((r) => ok(r) && r.runId.startsWith('dK-docker-'));
    const kl = okLocal.filter((r) => r.runId.startsWith('dK-local-'));
    if (kd.length && kl.length) {
      const rows = [];
      for (const w of [1, 4]) {
        const d = kd.filter((r) => r.config.workers === w);
        const l = kl.filter((r) => r.config.workers === w);
        if (!d.length || !l.length) continue;
        const f = (set, k) => median(set.map((r) => r.derived?.[k]));
        const dl = median([...d, ...l].map((r) => r.stateAtStart?.loadAvg?.[0]));
        rows.push([
          `w=${w}`,
          `${d.length} / ${l.length}`,
          num(dl, 1),
          `${num(f(d, 'framesPerSecond_framesOnly'))} / ${num(f(l, 'framesPerSecond_framesOnly'))}`,
          num(f(d, 'framesPerSecond_framesOnly') / f(l, 'framesPerSecond_framesOnly')),
          `${num(f(d, 'framesPerSecond_renderPhase'))} / ${num(f(l, 'framesPerSecond_renderPhase'))}`,
          num(f(d, 'framesPerSecond_renderPhase') / f(l, 'framesPerSecond_renderPhase')),
          `${num(f(d, 'framesPerSecond_endToEnd'))} / ${num(f(l, 'framesPerSecond_endToEnd'))}`,
          num(f(d, 'framesPerSecond_endToEnd') / f(l, 'framesPerSecond_endToEnd')),
        ]);
      }
      L.push('### Блок K — прогоны СТРОГО ПО ОЧЕРЕДИ Docker ↔ локально');
      L.push('');
      L.push('Загрузка хоста за время спайка плавала в разы, поэтому два блока, снятых подряд, видят разные машины, и отношение их медиан говорит о времени суток, а не о режиме. Здесь Docker-прогон и локальный идут вплотную друг за другом, и отношение считается только по этой паре. **Это и есть ответ на Q2.**');
      L.push('');
      L.push(tbl(['workers', 'прогонов D / L', 'медиана loadavg(1)', 'кадров/с (кадры) D / L', 'отношение', 'кадров/с (фаза рендера) D / L', 'отношение', 'кадров/с (весь процесс) D / L', 'отношение'], rows));
      L.push('');
    }
  }

  if (q4) {
    L.push('## Q4 — Docker против локального софтверного пути SP-3c');
    L.push('');
    L.push(`* ${q4.method.fileHash}`);
    L.push(`* ${q4.method.framemd5}`);
    L.push(`* ${q4.method.bitstream}`);
    L.push('');
    L.push(
      tbl(
        ['сравнение', 'кадры (framemd5)', 'битстрим h264', 'sha256 mp4', 'Δ байт mp4', 'Δ байт битстрима', 'первый разошедшийся кадр'],
        q4.comparisons.map((c) => [
          c.pair,
          c.framemd5Equal === null ? '—' : c.framemd5Equal ? '**равны**' : 'разошлись',
          c.bitstreamEqual === null ? '—' : c.bitstreamEqual ? '**равен**' : 'различается',
          c.sha256Equal === null ? '—' : c.sha256Equal ? 'равен' : 'различается',
          c.bytesDelta === null ? '—' : String(c.bytesDelta),
          c.bitstreamBytesDelta === null ? '—' : String(c.bitstreamBytesDelta),
          c.framemd5Compare?.firstDiffFrame ?? '—',
        ]),
      ),
    );
    L.push('');
    L.push('### Что именно стоит по сторонам сравнения');
    L.push('');
    L.push(
      tbl(
        ['сторона', 'прогон', 'спайк', 'захват', 'браузер', 'энкодер (тег в mp4)', 'байт', 'sha256'],
        q4.sides.map((s) => [
          s.label,
          s.runId,
          s.spike,
          s.captureMode ?? '—',
          (s.browserLaunchLine ?? '—').replace('[BrowserManager] Browser launched (', '').replace(/\)$/, ''),
          s.encoderTag?.streams?.[0]?.tags?.encoder ?? '—',
          String(s.actualBytes ?? s.recordedBytes ?? '—'),
          short(s.actualSha256 ?? s.recordedSha256),
        ]),
      ),
    );
    L.push('');
    const bs = readJson(path.join(RAW, 'bitstream-diff.json'));
    if (bs) {
      L.push('### Где именно расходятся битстримы');
      L.push('');
      L.push(`* ${bs.method}`);
      L.push('');
      L.push(
        tbl(
          ['пара (Docker против локального SwiftShader)', 'байт в потоке', 'одинаковой длины', 'различается байт', 'позиции', 'доля потока, %', 'вердикт'],
          bs.pairs.filter((p) => !p.skipped).map((p) => [
            p.label,
            String(p.bytesDocker),
            p.sameLength ? 'да' : 'нет',
            String(p.differingBytes),
            p.differingRegion ? p.differingRegion.join('..') : '—',
            num(p.shareOfStreamPercent, 7),
            p.verdict,
          ]),
        ),
      );
      L.push('');
      if (bs.x264Signature) {
        L.push('Источник различия — подпись энкодера в SEI:');
        L.push('');
        L.push('```');
        L.push(`Docker:   ${bs.x264Signature.docker}`);
        L.push(`локально: ${bs.x264Signature.local}`);
        L.push('```');
        L.push('');
      }
    }
    L.push('### Флаги энкодера');
    L.push('');
    L.push(`* **HyperFrames (и локально, и в Docker):** \`${q4.encoderFlags.hyperframes}\``);
    L.push(`* **Docker против локального:** ${q4.encoderFlags.hyperframesDockerVsLocal}`);
    L.push(`* **Наш рецепт (блок D SP-3), применяется к PNG-сиквенсу:** \`${q4.encoderFlags.sp3OwnRecipe}\``);
    L.push('');
  }

  if (enc) {
    L.push('## Собственный энкод PNG-сиквенса (рецепт SP-3 блок D)');
    L.push('');
    L.push(`* рецепт: ${enc.recipe}`);
    L.push('');
    L.push(
      tbl(
        ['вход', 'кадров', 'threads=4 энкод 1', 'threads=4 энкод 2', 'энкодер детерминирован', 'threads1 == threads4'],
        enc.encodes.filter((e) => !e.error).map((e) => [e.framesDir, String(e.frames), short(e.threads4_encode1.sha256), short(e.threads4_encode2.sha256), e.encoderDeterministic ? 'да' : 'НЕТ', e.threads1VsThreads4Equal ? 'да' : 'нет']),
      ),
    );
    L.push('');
  }

  // ── PNG-сиквенсы ─────────────────────────────────────────────────────
  {
    const png = readJson(path.join(RAW, 'png-compare.json'));
    if (png) {
      L.push('## PNG-сиквенс: сырые кадры до энкодера');
      L.push('');
      L.push(`* ${png.method}`);
      L.push('');
      L.push(tbl(['сторона', 'источник', 'PNG', 'суммарно, МБ', 'dirHash', 'sha256(framemd5)'], png.sides.map((s) => [s.label, s.source, String(s.fileCount ?? '—'), num((s.totalBytes ?? 0) / 1024 ** 2, 0), short(s.dirHash), short(s.framemd5Sha256)])));
      L.push('');
      L.push(tbl(['сравнение', 'dirHash равен', 'framemd5 равен', 'файлов совпало из', 'первый различающийся файл'], png.comparisons.map((c) => [c.pair, c.dirHashEqual ? '**да**' : 'нет', c.framemd5Equal === null ? '—' : c.framemd5Equal ? '**да**' : 'нет', `${c.identicalFiles} из ${c.filesCompared}`, c.firstDifferentFile ?? '—'])));
      L.push('');
    }
  }

  // ── Расхождения в пикселях, если считались ───────────────────────────
  {
    const pxFiles = fs.readdirSync(RAW).filter((f) => f.startsWith('pixeldiff-') && f.endsWith('.json'));
    if (pxFiles.length) {
      L.push('## Расхождения в пикселях (сырые кадры, прибор SP-3)');
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
  }

  if (net) {
    L.push('## Q5 — сеть контейнера');
    L.push('');
    for (const c of net.checks) {
      L.push(`* ${c.passed === null ? '·' : c.passed ? '✓' : '✗'} ${c.title} — ожидалось: ${c.expected}${c.reachable !== undefined ? `; фактически ${c.reachable ? 'ДОСТУПНА' : 'недоступна'}` : ''}${c.wallSec ? `; ${c.wallSec} с` : ''}`);
    }
    L.push('');
    for (const f of net.facts ?? []) L.push(`* ${f}`);
    L.push(`* вердикт: **${net.verdict}**`);
    L.push('');
  }

  if (probe) {
    L.push('## Q3 — что лежит в образе и чем пришпилено');
    L.push('');
    const rows = [
      ['ОС', probe.probes.osRelease?.out.split('\n')[0].replace('PRETTY_NAME=', '').replace(/"/g, '')],
      ['node внутри', probe.probes.nodeVersion?.out],
      ['hyperframes внутри', (probe.probes.hyperframesVersion?.out.match(/hyperframes@(\S+)/) ?? [])[1]],
      ['chrome-headless-shell (им и рендерит)', (probe.probes.headlessShellVersion?.out.match(/Chrome for Testing (\S+)/) ?? [])[1]],
      ['sha256 бинаря chrome-headless-shell', (probe.probes.headlessShellSha256?.out.split(/\s+/) ?? [])[0]],
      ['chromium (пакет Debian, рендером не используется)', (probe.probes.chromiumVersion?.out.match(/Version: (\S+)/) ?? [])[1]],
      ['ffmpeg', (probe.probes.ffmpegVersion?.out.match(/ffmpeg version (\S+)/) ?? [])[1]],
      ['libx264 в ffmpeg', /libx264/.test(probe.probes.ffmpegX264?.out ?? '') ? 'есть' : 'НЕТ'],
      ['шрифтовых начертаний (fc-list)', probe.probes.fontsCount?.out],
      ['sha256 всех файлов /usr/share/fonts', (probe.probes.fontconfigCacheHash?.out.split(/\s+/) ?? [])[0]],
      ['TZ / LANG внутри', probe.probes.timezoneLocale?.out.split('\n').slice(1).join(' ')],
    ];
    L.push(tbl(['что', 'значение'], rows.map(([a, b]) => [a, b ?? '—'])));
    L.push('');
    L.push('### Шрифтовые пакеты в образе');
    L.push('');
    L.push('```');
    L.push(probe.probes.fontPackages?.out ?? '—');
    L.push('```');
    L.push('');
    if (machine) {
      L.push('### Чем пришпилено (строки `Dockerfile.render`)');
      L.push('');
      L.push(tbl(['что', 'как пришпилено'], Object.entries(machine.image.dockerfile.pinning).map(([k, v]) => [k, v])));
      L.push('');
      L.push(`sha256 самого \`Dockerfile.render\`: \`${machine.image.dockerfile.sha256}\` (${machine.image.dockerfile.bytes} байт).`);
      L.push('');
    }
    const pin = readJson(path.join(RAW, 'chrome-pin.json'));
    if (pin) {
      L.push('### Во что разрешается `chrome-headless-shell@stable`');
      L.push('');
      L.push(
        tbl(
          ['что', 'значение'],
          [
            ['версия в образе', pin.versionInsideImage],
            ['`@stable` на момент сверки', pin.stableNow],
            ['совпадают', pin.equalRightNow ? 'да' : 'нет'],
            ['когда указатель Stable обновлялся в последний раз', pin.endpointResponse?.timestamp ?? '—'],
            ['локальный путь: версия puppeteer', pin.localPathForComparison?.puppeteer ?? '—'],
            ['локальный путь: версия chrome-headless-shell', pin.localPathForComparison?.chromeHeadlessShell ?? '—'],
          ],
        ),
      );
      L.push('');
    }
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
