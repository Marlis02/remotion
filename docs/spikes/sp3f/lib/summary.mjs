/** SP-3f: пересборка results/summary.md из results/raw. Только числа, без истолкования. */
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from './env.mjs';

const raw = path.join(ROOT, 'results/raw');
const runs = fs.readdirSync(raw).filter((f) => /^(V|Vd|L|L450|PROBE)-?.*\.json$/.test(f) && !/^(determinism|where|loc|hf-energy|t8)/.test(f))
  .map((f) => { try { return JSON.parse(fs.readFileSync(path.join(raw, f), 'utf8')); } catch { return null; } })
  .filter((r) => r && r.runId);
runs.sort((a, b) => a.runId.localeCompare(b.runId, 'en'));
const det = (() => { try { return JSON.parse(fs.readFileSync(path.join(raw, 'determinism.json'), 'utf8')); } catch { return null; } })();
const t8 = (() => { try { return JSON.parse(fs.readFileSync(path.join(raw, 't8-captions.json'), 'utf8')); } catch { return null; } })();
const loc = (() => { try { return JSON.parse(fs.readFileSync(path.join(raw, 'loc.json'), 'utf8')); } catch { return null; } })();
const whr = (() => { try { return JSON.parse(fs.readFileSync(path.join(raw, 'where.json'), 'utf8')); } catch { return null; } })();

const L = [];
L.push('# SP-3f — числа\n');
L.push('Сгенерировано `lib/summary.mjs` из `results/raw`. Истолкование — в [findings.md](findings.md).\n');

L.push('## 1. Прогоны\n');
L.push('| runId | проект | кадров | статус | wall, с | кадра/с (frames) | кадра/с (renderPhase) | кадра/с (end-to-end) | байт | sha256 (16) | framemd5 (16) | пик RSS/PSS дерева, МБ | захват |');
L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of runs) {
  const v = r.verification ?? {}; const d = r.derived ?? {}; const m = r.memory ?? {};
  L.push(`| ${r.runId} | ${r.config?.project ?? '—'} | ${r.config?.frames ?? '—'} | ${r.status} | ${d.wallTimeSec ?? '—'} | ${d.framesPerSecond_framesOnly ?? '—'} | ${d.framesPerSecond_renderPhase ?? '—'} | ${d.framesPerSecond_endToEnd ?? '—'} | ${v.outputBytes ?? '—'} | ${v.outputSha256?.slice(0, 16) ?? '—'} | ${v.framemd5?.sha256?.slice(0, 16) ?? '—'} | ${m.peakRssSumMb ?? "—"} / ${m.peakPssSumMb ?? "—"} | ${r.captureMode ?? '—'} |`);
}
L.push('');

if (det) {
  L.push('## 2. Гейт «N прогонов = один файл»\n');
  L.push('| группа | прогонов | разных sha256 | разных framemd5 | размеры, б | мин. PSNR по всем парам, dB | кадра/с (renderPhase, медиана) | пик RSS/PSS дерева, МБ |');
  L.push('|---|---|---|---|---|---|---|---|');
  for (const g of det.groups) {
    L.push(`| ${g.key} | ${g.runs} | **${g.uniqueSha256}** | ${g.uniqueFramemd5} | ${g.bytes.join(' / ')} | ${g.minPsnrAcrossPairs ?? '— (все пары побайтово равны)'} | ${g.fpsRenderPhaseMedian} | ${g.peakRssMb} / ${g.peakPssMb} |`);
  }
  L.push('');
  L.push('### 2.1. ВЧ-энергия по слоям (метод SP-3d §1.2)\n');
  L.push('| группа | кадр 20 (фон) | кадр 150 (типографика+частицы) | кадр 250 (стекло) | кадр 400 (финал+субтитры) |');
  L.push('|---|---|---|---|---|');
  for (const g of det.groups) {
    if (!g.energies?.length) continue;
    const u = g.uniqueEnergyLevels;
    L.push(`| ${g.key} | ${u.f20.join(' / ') || '—'} | ${u.f150.join(' / ') || '—'} | ${u.f250.join(' / ') || '—'} | ${u.f400.join(' / ') || '—'} |`);
  }
  L.push('');
  L.push('Кроп прибора (520×520 в точке слоя) рассчитан на кадр 1080×1920. На профиле `draftHalf`');
  L.push('кадр 540×960, кроп выходит за его границы, и нули в строке `draftHalf` — артефакт прибора,');
  L.push('а не измерение: ВЧ-энергия на половинном разрешении не считалась и не сравнивается.\n');
  const pairs = det.groups.flatMap((g) => (g.psnr ?? []).map((p) => ({...p, key: g.key})));
  if (pairs.length) {
    L.push('### 2.2. PSNR по всем парам\n');
    L.push('| группа | пара | побайтово равны | различающихся кадров | мин. PSNR, dB | медиана PSNR, dB | кадров < 40 dB |');
    L.push('|---|---|---|---|---|---|---|');
    for (const p of pairs) L.push(`| ${p.key} | ${p.pair.join(' / ')} | ${p.identical ? 'да' : 'нет'} | ${p.differingFrames} из ${p.totalFrames} | ${p.minPsnrAvg ?? '—'} | ${p.medianPsnrAvg ?? '—'} | ${p.framesBelow40Db ?? '—'} |`);
    L.push('');
  }
}

L.push('## 3. Цена слоёв\n');
L.push('| прогон | проект | кадров | кадра/с (renderPhase) | wall, с |');
L.push('|---|---|---|---|---|');
for (const r of runs.filter((x) => /^L/.test(x.runId))) {
  L.push(`| ${r.runId} | ${r.config?.project} | ${r.config?.frames} | ${r.derived?.framesPerSecond_renderPhase ?? '—'} | ${r.derived?.wallTimeSec ?? '—'} |`);
}
L.push('');

if (t8) {
  L.push('## 4. Тест ADR-0003 T8: границы субтитров\n');
  L.push(`Файл: \`${t8.file}\`, кроп \`${t8.crop.w}×${t8.crop.h}+${t8.crop.x}+${t8.crop.y}\` (внутри непрозрачной плашки), прочитано кадров ${t8.framesRead}.\n`);
  L.push('| величина | значение |');
  L.push('|---|---|');
  L.push(`| ожидалось смен полосы субтитров | ${t8.expectedChanges} |`);
  L.push(`| наблюдалось | ${t8.observedChanges} |`);
  L.push(`| границ страниц попало на расчётный кадр | ${t8.pageBoundariesHit} из ${t8.totalPages} |`);
  L.push(`| границ слов попало на расчётный кадр | ${t8.wordBoundariesHit} из ${t8.totalWords} |`);
  L.push(`| пропущенных границ | ${t8.missing.length}${t8.missing.length ? ' → ' + t8.missing.join(', ') : ''} |`);
  L.push(`| лишних смен (полоса изменилась вне границы) | ${t8.extra.length}${t8.extra.length ? ' → ' + t8.extra.slice(0, 20).join(', ') : ''} |`);
  L.push(`| **итог** | **${t8.pass ? 'ПРОЙДЕН' : 'НЕ ПРОЙДЕН'}** |`);
  L.push('');
}

if (whr?.pairs?.length) {
  L.push('## 5. Где расходится (`where`)\n');
  for (const o of whr.pairs) {
    L.push(`**${o.pair.join(' / ')}** — различается ${o.differingFrames} кадров из ${o.totalFrames}; первый ${o.firstDiffFrame}, последний ${o.lastDiffFrame}.\n`);
    L.push('| окно слоя | кадры | различается |');
    L.push('|---|---|---|');
    for (const [k, v] of Object.entries(o.byWindow)) L.push(`| ${k} | [${v.window[0]}..${v.window[1]}) | ${v.differing} из ${v.framesInWindow} (${v.share} %) |`);
    L.push('');
    L.push('| опорный кадр | bbox расхождения | различается субпикселей | макс. отклонение, уровней |');
    L.push('|---|---|---|---|');
    for (const [fr, bb] of Object.entries(o.bboxAtFrames)) {
      L.push(`| ${fr} | ${bb.identical ? 'кадры равны' : bb.empty ? 'пусто' : `x ${bb.x[0]}…${bb.x[1]}, y ${bb.y[0]}…${bb.y[1]}`} | ${bb.differingPixels ?? '—'}${bb.sharePct !== undefined ? ` (${bb.sharePct} %)` : ''} | ${bb.maxLevel ?? '—'} |`);
    }
    L.push('');
  }
}

if (loc) {
  L.push('## 6. Строки кода по элементам режиссуры\n');
  L.push('| элемент | style | build | timeline | всего |');
  L.push('|---|---|---|---|---|');
  for (const e of loc.elements) L.push(`| ${e.el} | ${e.style} | ${e.build} | ${e.timeline} | ${e.total} |`);
  L.push(`| **ИТОГО** | **${loc.total.style}** | **${loc.total.build}** | **${loc.total.timeline}** | **${loc.total.all}** |`);
  L.push('');
}

fs.writeFileSync(path.join(ROOT, 'results/summary.md'), L.join('\n') + '\n');
console.log('results/summary.md записан');
