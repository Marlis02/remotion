#!/usr/bin/env python3
"""SP-VID A4 — ТОЧНЫЙ прямоугольник занятой области по альфе, свой подсчёт по rawvideo.

Зачем свой, если есть `cropdetect`. Тот округляет до кратных (`round`), имеет порог по
яркости и «залипает» на первом решении (`reset`), то есть отвечает на вопрос «что обрезать»,
а не «что занято». Паспорт ассета обязан нести ТОЧНЫЙ прямоугольник непрозрачных пикселей —
его и считает этот скрипт: границы по первой и последней строке/столбцу, где альфа > 0.

Прибор сравнивает ДВА файла (два прогона одного энкода) покадрово: детерминирована ли
занятая область — это и есть ответ пункта A4.

Скорость. Построчный обход в Python по 2 Мпикс × 150 кадров × 2 файла не окупается, поэтому
границы строки берутся `lstrip`/`rstrip` по NUL, а число непрозрачных — `count(0)`: обе
операции идут в C, а не в интерпретаторе.
"""

import subprocess
import sys

FF = "/usr/local/bin/ffmpeg"
W, H = 1080, 1920
NUL = b"\x00"


def alpha_frames(path: str):
    """Кадры альфы как байты, по одному кадру W*H."""
    run = subprocess.run(
        [FF, "-v", "error", "-i", path, "-vf", "alphaextract", "-f", "rawvideo", "-pix_fmt", "gray", "-"],
        capture_output=True,
        check=True,
    )
    buf = run.stdout
    size = W * H
    return [buf[i : i + size] for i in range(0, len(buf) - size + 1, size)]


def bbox(frame: bytes):
    """(x0, y0, x1, y1, доля непрозрачных) либо None, если кадр пуст."""
    y0, y1 = -1, -1
    x0, x1 = W, -1
    opaque = 0
    for y in range(H):
        row = frame[y * W : (y + 1) * W]
        nonzero = W - row.count(0)
        if nonzero == 0:
            continue
        opaque += nonzero
        if y0 < 0:
            y0 = y
        y1 = y
        first = W - len(row.lstrip(NUL))
        last = len(row.rstrip(NUL)) - 1
        if first < x0:
            x0 = first
        if last > x1:
            x1 = last
    if y1 < 0:
        return None
    return (x0, y0, x1, y1, opaque / (W * H))


def main() -> int:
    a, b, tag = sys.argv[1], sys.argv[2], sys.argv[3]
    fa, fb = alpha_frames(a), alpha_frames(b)
    print(f"-- {tag}: свой подсчёт bbox по альфе, кадров {len(fa)} / {len(fb)}")
    same = 0
    diff = 0
    shown = 0
    for i, (x, y) in enumerate(zip(fa, fb)):
        ba, bb = bbox(x), bbox(y)
        if ba == bb:
            same += 1
        else:
            diff += 1
        if shown < 3 and ba is not None:
            print(
                f"   кадр {i:3d}  bbox x{ba[0]}..{ba[2]} y{ba[1]}..{ba[3]} "
                f"({ba[2] - ba[0] + 1}×{ba[3] - ba[1] + 1})  непрозрачных {100 * ba[4]:.2f} %"
            )
            shown += 1
    print(f"   bbox совпал на {same} кадрах из {same + diff}; разошёлся на {diff}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
