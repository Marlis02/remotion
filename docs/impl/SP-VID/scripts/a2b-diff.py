#!/usr/bin/env python3
"""SP-VID A2-бис — ЧЕМ различаются два исхода одного набора прогонов.

«sha разошёлся» — это ещё не характеристика дефекта: разойтись может один сэмпл на краю, а
может половина дорожки. Прибор берёт ДОМИНИРУЮЩИЙ результат набора и первый отличный от
него и печатает три числа: доля различных сэмплов, максимальный модуль разности и время
ПЕРВОГО расхождения. По ним видно, дефект это слышимый или бухгалтерский.
"""

import array
import collections
import glob
import hashlib
import sys
import wave


def sha(path: str) -> str:
    with open(path, "rb") as handle:
        return hashlib.sha256(handle.read()).hexdigest()


def samples(path: str):
    with wave.open(path, "rb") as handle:
        data = handle.readframes(handle.getnframes())
        rate = handle.getframerate()
        channels = handle.getnchannels()
    values = array.array("h")
    values.frombytes(data)
    return values, rate, channels


def main() -> int:
    prefix = sys.argv[1]
    files = sorted(glob.glob(f"{prefix}-*.wav"))
    if len(files) < 2:
        print("   (нечего сравнивать)")
        return 0
    by_hash = collections.Counter(sha(f) for f in files)
    if len(by_hash) == 1:
        print(f"   все {len(files)} прогонов дали один файл — сравнивать нечего")
        return 0
    dominant = by_hash.most_common(1)[0][0]
    a = next(f for f in files if sha(f) == dominant)
    b = next(f for f in files if sha(f) != dominant)

    xa, rate, channels = samples(a)
    xb, _, _ = samples(b)
    n = min(len(xa), len(xb))
    diff = 0
    biggest = 0
    first = None
    for i in range(n):
        d = abs(xa[i] - xb[i])
        if d:
            diff += 1
            if d > biggest:
                biggest = d
            if first is None:
                first = i
    print(f"   доминирующий {a.rsplit('/', 1)[-1]} ({by_hash[dominant]} из {len(files)})")
    print(f"   отличный     {b.rsplit('/', 1)[-1]}")
    print(f"   длины: {len(xa)} и {len(xb)} сэмплов" + ("" if len(xa) == len(xb) else "  ← РАЗНЫЕ"))
    if first is None:
        print("   перекрывающиеся сэмплы РАВНЫ побитово: расходится только длина хвоста")
    else:
        seconds = first / channels / rate
        print(
            f"   различных сэмплов {diff} ({100 * diff / n:.4f} %), "
            f"макс |Δ| {biggest} из 32767 ({100 * biggest / 32767:.2f} % шкалы), "
            f"первое расхождение на t = {seconds:.3f} с"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
