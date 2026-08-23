// `C-04` — минт `w:` (ADR-0004 §4, ревизия M3).
//
// ФОРМА ПРОВЕРЯЕТСЯ СХЕМОЙ СЕМЕЙСТВА, А НЕ ВТОРОЙ РЕГУЛЯРКОЙ В ТЕСТЕ. Регулярка, написанная
// здесь, проверяла бы саму себя: разошлась бы со схемой при первой правке и осталась зелёной.
// Поэтому форма — через `asAnchorId`, то есть через `AnchorEntrySchema.shape.id`.

import { AnchorEntrySchema, asAnchorId } from '@vpe/schema';
import { describe, expect, it } from 'vitest';

import { AnchorLedgerError, csprng, MINT_BYTES, MINT_LENGTH, mintAnchorId } from '../src/index.js';
import { seededRandom } from './anchors-helpers.js';

describe('`C-04` минт якоря — 128 бит CSPRNG (ADR-0004 §4, M3)', () => {
  it('id проходит форму семейства `anchors/1`: `w:` + 16 символов base32', () => {
    const id = mintAnchorId(csprng);
    expect(AnchorEntrySchema.shape.id.safeParse(id).success).toBe(true);
    expect(id.startsWith('w:')).toBe(true);
    expect(id.length).toBe(2 + MINT_LENGTH);
    // Алфавит — RFC 4648 §6 строчными, без паддинга (`S-01`): ни `0`, ни `1`, ни `8`, ни `9`.
    expect(/^w:[a-z2-7]{16}$/u.test(id)).toBe(true);
  });

  it('два минта дают разные id — источник случаен, а не константа', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 200; i += 1) ids.add(mintAnchorId(csprng));
    expect(ids.size).toBe(200);
  });

  it('в минт уходит ровно 128 бит: источник спрашивают о 16 байтах', () => {
    const asked: number[] = [];
    mintAnchorId((byteLength) => {
      asked.push(byteLength);
      return new Uint8Array(byteLength);
    });
    expect(asked).toEqual([MINT_BYTES]);
    expect(MINT_BYTES * 8).toBe(128);
  });

  it('источник, вернувший не то число байтов, — ошибка, а не id из мусора', () => {
    expect(() => mintAnchorId(() => new Uint8Array(8))).toThrow(AnchorLedgerError);
    expect(() => mintAnchorId(() => new Uint8Array(8))).toThrow(/128 бит/u);
  });

  it('подставленный источник даёт воспроизводимый id — на этом стоят тесты детерминизма', () => {
    expect(mintAnchorId(seededRandom())).toBe(mintAnchorId(seededRandom()));
  });

  it('нулевые байты дают законный id: форма не зависит от значения', () => {
    const id = mintAnchorId(() => new Uint8Array(MINT_BYTES));
    expect(id).toBe(asAnchorId('w:aaaaaaaaaaaaaaaa'));
  });
});
