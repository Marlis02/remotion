// `M-03` — WAV как контейнер на границах: канонический заголовок, round-trip, отказы.
//
// Ни одного бинарника: всякий WAV этого файла построен здесь же — либо своим писателем,
// либо руками из полей (тогда поле можно испортить прицельно).

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  AudioError,
  WAVE_FORMAT_EXTENSIBLE,
  WAVE_FORMAT_MPEGLAYER3,
  WAVE_FORMAT_PCM,
  WAV_HEADER_BYTES,
  assertProjectRate,
  decodeWav,
  encodeWav,
  pcmS16,
  readWavFile,
  writeWavFile,
} from '../src/index.js';

import { projectSampleRateFixture, ramp, samplesOf } from './audio-helpers.js';

const RATE = projectSampleRateFixture();

let DIR = '';
beforeAll(() => {
  DIR = mkdtempSync(path.join(tmpdir(), 'vpe-m03-wav-'));
});
afterAll(() => {
  rmSync(DIR, { recursive: true, force: true });
});

interface WavFields {
  readonly audioFormat?: number;
  readonly channels?: number;
  readonly sampleRate?: number;
  readonly byteRate?: number;
  readonly blockAlign?: number;
  readonly bitsPerSample?: number;
  readonly dataSize?: number;
  readonly extraChunk?: { readonly tag: string; readonly body: readonly number[] };
}

/** WAV, собранный из полей: единственный способ испортить ровно одно поле и ничего больше. */
function buildWav(payload: readonly number[], fields: WavFields = {}): Uint8Array {
  const channels = fields.channels ?? 1;
  const bits = fields.bitsPerSample ?? 16;
  const rate = fields.sampleRate ?? RATE;
  const blockAlign = fields.blockAlign ?? (channels * bits) / 8;
  const byteRate = fields.byteRate ?? rate * blockAlign;
  const extra = fields.extraChunk;
  const extraBytes = extra === undefined ? 0 : 8 + extra.body.length + (extra.body.length % 2);

  const bytes = new Uint8Array(WAV_HEADER_BYTES + extraBytes + payload.length);
  const view = new DataView(bytes.buffer);
  const tag = (offset: number, text: string): void => {
    for (let i = 0; i < 4; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };

  tag(0, 'RIFF');
  view.setUint32(4, bytes.length - 8, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, fields.audioFormat ?? WAVE_FORMAT_PCM, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bits, true);

  let cursor = 36;
  if (extra !== undefined) {
    tag(cursor, extra.tag);
    view.setUint32(cursor + 4, extra.body.length, true);
    bytes.set(Uint8Array.from(extra.body), cursor + 8);
    cursor += 8 + extra.body.length + (extra.body.length % 2);
  }
  tag(cursor, 'data');
  view.setUint32(cursor + 4, fields.dataSize ?? payload.length, true);
  bytes.set(Uint8Array.from(payload), cursor + 8);
  return bytes;
}

describe('канонический заголовок — 44 байта, поле за полем', () => {
  const pcm = pcmS16(RATE, samplesOf([1, -1]));
  const bytes = encodeWav(pcm);
  const view = new DataView(bytes.buffer);

  it('длина ровно `44 + 2·N`: ни `LIST`, ни `INFO`, ни выравнивающего байта', () => {
    expect(bytes.length).toBe(WAV_HEADER_BYTES + 4);
  });

  it('поля заголовка — точные числа', () => {
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(40);
    expect(String.fromCharCode(...bytes.subarray(8, 12))).toBe('WAVE');
    expect(String.fromCharCode(...bytes.subarray(12, 16))).toBe('fmt ');
    expect(view.getUint32(16, true)).toBe(16);
    expect(view.getUint16(20, true)).toBe(WAVE_FORMAT_PCM);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(24000);
    expect(view.getUint32(28, true)).toBe(48000);
    expect(view.getUint16(32, true)).toBe(2);
    expect(view.getUint16(34, true)).toBe(16);
    expect(String.fromCharCode(...bytes.subarray(36, 40))).toBe('data');
    expect(view.getUint32(40, true)).toBe(4);
  });
});

describe('round-trip', () => {
  it('write → read даёт побайтово те же сэмплы (вся шкала, включая края)', () => {
    const pcm = pcmS16(RATE, samplesOf([0, 1, -1, 32767, -32768, 12345, -12345]));
    const back = decodeWav(encodeWav(pcm), 'память');
    expect([...back.samples]).toEqual([...pcm.samples]);
    expect(back.sampleRate).toBe(RATE);
  });

  it('байты → дорожка → байты: файл восстанавливается побайтово', () => {
    const bytes = encodeWav(pcmS16(RATE, ramp(512, -256, 1)));
    expect([...encodeWav(decodeWav(bytes, 'память'))]).toEqual([...bytes]);
  });

  it('через диск: `writeWavFile` атомарен, `readWavFile` возвращает те же сэмплы', async () => {
    const file = path.join(DIR, 'roundtrip.wav');
    const pcm = pcmS16(RATE, ramp(1024, -512, 1));
    await writeWavFile(file, pcm);
    expect([...readFileSync(file)]).toEqual([...encodeWav(pcm)]);
    expect([...(await readWavFile(file)).samples]).toEqual([...pcm.samples]);
  });
});

describe('чужая частота ЧИТАЕТСЯ, но в микс не попадает', () => {
  it('WAV на 44100 разбирается, а `assertProjectRate` его отвергает', () => {
    const alien = decodeWav(buildWav([0, 0, 0, 0], { sampleRate: 44100, byteRate: 88200 }), 'чужой');
    expect(alien.sampleRate).toBe(44100);
    expect(() => assertProjectRate(alien, RATE, 'микс')).toThrow(AudioError);
  });
});

describe('отказы читателя', () => {
  it('`WAVE_FORMAT_EXTENSIBLE` — отдельное сообщение, тракт не угадывает GUID', () => {
    let error: unknown;
    try {
      decodeWav(buildWav([0, 0], { audioFormat: WAVE_FORMAT_EXTENSIBLE }), 'x.wav');
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(AudioError);
    expect((error as AudioError).rule).toBe('M-03 формат тракта (INFERENCE)');
    // Отказ называет формат ПО ИМЕНИ, а не «неверный формат» (требование владельца B).
    expect((error as AudioError).message).toContain('WAVE_FORMAT_EXTENSIBLE');
    expect((error as AudioError).message).toContain('SubFormat');
  });

  it('mp3 внутри RIFF (`audioFormat` 0x0055) — отказ по правилу **V6**, а не по формату', () => {
    let error: unknown;
    try {
      decodeWav(buildWav([0, 0], { audioFormat: WAVE_FORMAT_MPEGLAYER3 }), 'bed.wav');
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(AudioError);
    expect((error as AudioError).rule).toBe('ADR-0010 §9 (V6)');
  });

  it('байты mp3, поданные читателю WAV, — отказ V6 до разбора заголовка', () => {
    let error: unknown;
    try {
      decodeWav(Uint8Array.from([0x49, 0x44, 0x33, 0x04, ...new Array<number>(64).fill(0)]), 'bed.wav');
    } catch (caught) {
      error = caught;
    }
    expect((error as AudioError).rule).toBe('ADR-0010 §9 (V6)');
  });

  it.each([
    ['не RIFF', (): Uint8Array => Uint8Array.from(new Array<number>(64).fill(0x41))],
    ['короче заголовка', (): Uint8Array => Uint8Array.from([0x52, 0x49, 0x46, 0x46])],
    ['24 бита', (): Uint8Array => buildWav([0, 0, 0], { bitsPerSample: 24, blockAlign: 3, byteRate: 72000 })],
    ['стерео', (): Uint8Array => buildWav([0, 0, 0, 0], { channels: 2, blockAlign: 4, byteRate: 96000 })],
    ['`blockAlign` не тот', (): Uint8Array => buildWav([0, 0], { blockAlign: 4 })],
    ['`byteRate` не тот', (): Uint8Array => buildWav([0, 0], { byteRate: 1 })],
    ['тело `data` нечётной длины', (): Uint8Array => buildWav([0, 0, 0], { dataSize: 3 })],
    ['`data` объявил больше, чем есть', (): Uint8Array => buildWav([0, 0], { dataSize: 4096 })],
    ['чужой `audioFormat`', (): Uint8Array => buildWav([0, 0], { audioFormat: 0x0003 })],
  ])('%s — отказ', (_title, make) => {
    expect(() => decodeWav(make(), 'x.wav')).toThrow(AudioError);
  });

  it('нет чанка `data` — отказ называет, какого чанка нет', () => {
    const full = buildWav([0, 0]);
    // Порча имени `data` руками: чанк перестаёт находиться, всё остальное остаётся целым.
    full[36] = 0x64;
    full[37] = 0x61;
    full[38] = 0x74;
    full[39] = 0x65;
    expect(() => decodeWav(full, 'x.wav')).toThrow(/data/);
  });
});

describe('неизвестные чанки пропускаются — вход бывает не от нас', () => {
  it('`LIST` между `fmt ` и `data` не мешает прочитать сэмплы', () => {
    const bytes = buildWav([0x01, 0x00, 0x02, 0x00], {
      extraChunk: { tag: 'LIST', body: [0x49, 0x4e, 0x46, 0x4f, 0x01] },
    });
    expect([...decodeWav(bytes, 'x.wav').samples]).toEqual([1, 2]);
  });

  it('но свой писатель их не пишет — длина остаётся 44 + тело', () => {
    expect(encodeWav(pcmS16(RATE, samplesOf([1, 2]))).length).toBe(WAV_HEADER_BYTES + 4);
  });
});
