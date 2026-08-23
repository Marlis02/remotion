// `M-01` — **P6** (фундамент): `missing()` возвращает ТОЧНЫЙ список и договорную ошибку.
//
// ГРАНИЦА, КОТОРУЮ ЭТОТ ФАЙЛ НЕ ПЕРЕХОДИТ И НЕ ДЕЛАЕТ ВИД, ЧТО ПЕРЕХОДИТ. Критерий roadmap
// звучит как «клон без стора компилируется до Timeline и падает на первой стадии, которой
// нужны байты, с точным списком недостающих sha256». Timeline в репозитории ещё нет — он
// появится в `CP-01`, — поэтому сценарий целиком сегодня невоспроизводим. Охраняется то, что
// существует: точность и детерминированность списка плюс договор об ошибке, которая этот
// список НЕСЁТ полем, а не текстом. Строка **P6** реестра остаётся `named` с пометкой.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { asSha256, type Sha256 } from '@vpe/schema';

import { LocalStore, MissingBlobsError } from '../src/index.js';

const TMP = mkdtempSync(path.join(tmpdir(), 'vpe-m01-missing-'));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const sha = (hex: string): Sha256 => asSha256(hex.repeat(64).slice(0, 64));

const A = sha('1'); // 1111…
const B = sha('7'); // 7777…
const C = sha('a'); // aaaa…
const D = sha('f'); // ffff…

const bytesFor = (marker: string): Uint8Array => new TextEncoder().encode(marker);

function storeAt(name: string): LocalStore {
  return new LocalStore(path.join(TMP, name));
}

describe('**P6** — `missing()` на пустом сторе', () => {
  it('пустой стор: не хватает ВСЕГО требуемого', async () => {
    expect(await storeAt('empty').missing([A, B, C])).toEqual([A, B, C]);
  });

  it('пустое требование — пустой ответ, а не «всё пропало»', async () => {
    expect(await storeAt('empty').missing([])).toEqual([]);
  });

  it('порядок ответа детерминирован: hex по возрастанию, независимо от порядка входа', async () => {
    const store = storeAt('empty');
    expect(await store.missing([D, A, C, B])).toEqual([A, B, C, D]);
    expect(await store.missing([B, D, A, C])).toEqual([A, B, C, D]);
  });

  it('повтор во входе не удваивает строку в ответе: «чего не хватает» — множество', async () => {
    expect(await storeAt('empty').missing([A, A, B, A])).toEqual([A, B]);
  });
});

describe('**P6** — `missing()` на частично заполненном сторе', () => {
  it('список ТОЧЕН: ни одного лишнего, ни одного пропущенного', async () => {
    const store = storeAt('partial');
    const present = await store.put(bytesFor('первый'), 'voice');
    const alsoPresent = await store.put(bytesFor('второй'), 'asset');

    expect(await store.missing([present, alsoPresent])).toEqual([]);

    const wanted = [present, alsoPresent, A, D].sort();
    expect(await store.missing(wanted)).toEqual([A, D].sort());
  });

  it('положили недостающее — список сократился ровно на него', async () => {
    const store = storeAt('healing');
    const sought = await store.put(bytesFor('нужное'), 'voice');

    expect(await store.missing([sought, C])).toEqual([C]);
    const now = await store.put(bytesFor('ещё нужное'), 'snapshot');
    expect(await store.missing([sought, now])).toEqual([]);
  });
});

describe('**P6** — договорная ошибка несёт перечень sha, а не текст', () => {
  it('`read` на отсутствующем блобе: `MissingBlobsError` с полем `missing`', async () => {
    const store = storeAt('contract');
    let caught: unknown;
    try {
      await store.read(A);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(MissingBlobsError);
    expect((caught as MissingBlobsError).missing).toEqual([A]);
    // Список читается ПОЛЕМ; сообщение — для человека, и в нём тот же sha и что делать.
    expect(String(caught)).toContain(A);
    expect(String(caught)).toMatch(/vpe store fetch/);
  });

  it('`path` на отсутствующем блобе тоже бросает — рендерер не получит путь в никуда', async () => {
    const store = storeAt('contract');
    await expect(store.path(B)).rejects.toBeInstanceOf(MissingBlobsError);
  });

  it('`path` на существующем блобе возвращает путь, по которому лежат байты', async () => {
    const store = storeAt('contract-ok');
    const put = await store.put(bytesFor('для рендерера'), 'font');
    expect(path.basename(await store.path(put))).toBe(put);
  });

  it('перечень из ошибки годится как ВХОД `vpe store fetch`: это те же бренды `Sha256`', async () => {
    // Клон без стора: спрашиваем весь список `store.lock` разом и получаем его же обратно.
    const store = storeAt('clone');
    const required = [A, B, C, D];
    const absent = await store.missing(required);
    expect(absent).toEqual(required);

    const error = new MissingBlobsError(absent, 'сборка');
    expect(error.missing).toEqual(required);
    expect(error.message.split('\n')).toHaveLength(required.length + 2);
  });
});
