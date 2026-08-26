// ОДНОРАЗОВЫЙ измеритель ширины строки в DejaVu Sans Bold. Не тест, в репозиторий не идёт:
// шрифт временный (долг №13, адрес TS-01) и в репозитории его нет.
// Читает head (unitsPerEm), OS/2 (xAvgCharWidth), hhea+hmtx (advance), cmap формат 4 (char→glyph).
import { readFileSync } from 'node:fs';

const file = process.argv[2] ?? '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
const b = readFileSync(file);
const u16 = (o) => b.readUInt16BE(o);
const i16 = (o) => b.readInt16BE(o);
const u32 = (o) => b.readUInt32BE(o);

const numTables = u16(4);
const tables = new Map();
for (let i = 0; i < numTables; i += 1) {
  const rec = 12 + i * 16;
  tables.set(b.toString('latin1', rec, rec + 4), { off: u32(rec + 8), len: u32(rec + 12) });
}

const head = tables.get('head').off;
const unitsPerEm = u16(head + 18);
const os2 = tables.get('OS/2').off;
const xAvgCharWidth = i16(os2 + 2);
const hhea = tables.get('hhea').off;
const numberOfHMetrics = u16(hhea + 34);
const hmtx = tables.get('hmtx').off;
const advanceOfGlyph = (g) =>
  g < numberOfHMetrics ? u16(hmtx + g * 4) : u16(hmtx + (numberOfHMetrics - 1) * 4);

// cmap: берём подтаблицу (3,1) формат 4.
const cmap = tables.get('cmap').off;
let sub = -1;
for (let i = 0; i < u16(cmap + 2); i += 1) {
  const rec = cmap + 4 + i * 8;
  if (u16(rec) === 3 && u16(rec + 2) === 1) sub = cmap + u32(rec + 4);
}
if (sub < 0 || u16(sub) !== 4) throw new Error('нет подтаблицы cmap (3,1) формата 4');
const segX2 = u16(sub + 6);
const seg = segX2 / 2;
const endO = sub + 14;
const startO = endO + segX2 + 2;
const deltaO = startO + segX2;
const rangeO = deltaO + segX2;
function glyphOf(cp) {
  for (let s = 0; s < seg; s += 1) {
    if (cp > u16(endO + s * 2)) continue;
    const start = u16(startO + s * 2);
    if (cp < start) return 0;
    const ro = u16(rangeO + s * 2);
    if (ro === 0) return (cp + i16(deltaO + s * 2)) & 0xffff;
    const gi = u16(rangeO + s * 2 + ro + (cp - start) * 2);
    return gi === 0 ? 0 : (gi + i16(deltaO + s * 2)) & 0xffff;
  }
  return 0;
}
const advOfChar = (ch) => advanceOfGlyph(glyphOf(ch.codePointAt(0)));

console.log(`файл: ${file}`);
console.log(`unitsPerEm = ${unitsPerEm}`);
console.log(`OS/2.xAvgCharWidth = ${xAvgCharWidth} (= ${(xAvgCharWidth / unitsPerEm).toFixed(4)} em)`);

// Реальный текст субтитров фикстуры — surface-формы токенов (display, не spoken).
const surfaces = process.argv.slice(3);
if (surfaces.length > 0) {
  const all = surfaces.join(' ');
  const chars = [...all];
  const total = chars.reduce((s, ch) => s + advOfChar(ch), 0);
  console.log(`\nтекст фикстуры: ${chars.length} символов, Σ advance = ${total} units`);
  console.log(`средний advance по фактическому тексту = ${(total / chars.length).toFixed(1)} units = ${(total / chars.length / unitsPerEm).toFixed(4)} em`);
  const wide = 'm';
  console.log(`худший буквенный: '${wide}' = ${advOfChar(wide)} units = ${(advOfChar(wide) / unitsPerEm).toFixed(4)} em`);
  console.log(`'W' = ${advOfChar('W')} units, ' ' = ${advOfChar(' ')} units, 'i' = ${advOfChar('i')} units`);
  const band = 1080 - 60 - 60;
  for (const size of [56, 64, 72, 80, 88]) {
    const avgPx = (total / chars.length / unitsPerEm) * size;
    const widePx = (advOfChar(wide) / unitsPerEm) * size;
    const xavgPx = (xAvgCharWidth / unitsPerEm) * size;
    console.log(
      `кегль ${size} px: полоса ${band} px ⇒ по фактическому среднему ${Math.floor(band / avgPx)} симв., ` +
        `по OS/2.xAvg ${Math.floor(band / xavgPx)} симв., по 'm' ${Math.floor(band / widePx)} симв.`,
    );
  }
}
