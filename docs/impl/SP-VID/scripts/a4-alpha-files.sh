#!/usr/bin/env bash
# SP-VID A4 — ФАЙЛЫ С ПРОЗРАЧНОСТЬЮ: кодеки, декод, детерминизм, занятая область.
#
# Четыре вопроса, на каждый — число:
#   1. есть ли в НАШЕМ static-ffmpeg энкодеры `prores_ks` и `libvpx-vp9` — и ПИШУТ ли они альфу;
#   2. декод альфа-видео → PNG с альфой: два прогона дают равные sha256 кадров?
#   3. работает ли `overlay` с альфой ПРЯМО ИЗ ФАЙЛА (путь A2, без промежуточных PNG);
#   4. занятая область: прямоугольник непрозрачных пикселей по кадрам — детерминирован ли.
#
# ═══ НАЙДЕНО ИЗМЕРЕНИЕМ (03:24): `libvpx-vp9` В ЭТОЙ СБОРКЕ АЛЬФУ МОЛЧА ТЕРЯЕТ ═══
# `ffmpeg -h encoder=libvpx-vp9` перечисляет `yuva420p`, команда с `-pix_fmt yuva420p`
# проходит БЕЗ ПРЕДУПРЕЖДЕНИЯ, но в файле альфы нет: `ffprobe` показывает `yuv420p`, а
# `alphaextract` при декоде отвечает `Requested planes not available`. То же с `libvpx`
# (VP8) и с `-auto-alt-ref 0`. Поэтому вторым РАБОЧИМ кодеком меряется `qtrle` (`argb`,
# без потерь), а VP9 остаётся измеренным отрицательным результатом.

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/lib.sh"

OUT="$HERE/a4"
mkdir -p "$OUT"

echo "== A4.1: энкодеры/декодеры в нашем ffmpeg =="
for e in prores_ks libvpx-vp9 qtrle ffv1; do
  fmts=$("$FF" -hide_banner -h encoder=$e 2>/dev/null | sed -n 's/.*Supported pixel formats: //p')
  hit=$(echo "$fmts" | tr ' ' '\n' | grep -E "^(rgba|yuva|bgra|argb|gbrap)" | tr '\n' ' ')
  printf '%-14s энкодер: %s   альфа-форматы: %s\n' "$e" \
    "$([ -n "$fmts" ] && echo есть || echo НЕТ)" "${hit:-—}"
done
for d in prores libvpx-vp9 qtrle; do
  printf '%-14s декодер: %s\n' "$d" "$("$FF" -hide_banner -decoders 2>/dev/null | grep -c " $d ")"
done

# ── источник с альфой: непрозрачные прямоугольники, ездящие по прозрачному холсту ──
# `color=black@0` — прозрачный холст 1080×1920; поверх — два `drawbox` с `replace=1`,
# которые ЗАМЕЩАЮТ пиксель вместе с альфой. Оба ездят по горизонтали: постоянный
# прямоугольник дал бы детерминизм «занятой области» по построению.
#
# ПОЧЕМУ НЕ `geq`. Он считает выражение НА КАЖДЫЙ ПИКСЕЛЬ интерпретатором: 2 Мпикс × 150
# кадров × 4 канала — минуты на файл, и прибор мерил бы скорость своего генератора.
#
# ПОЧЕМУ НЕ `overlay` (измерено 03:21). У `overlay` опция `format` не принимает `rgba`
# (её значения — `yuv420|yuv422|yuv444|rgb|gbrp|auto`), а в rgb-режиме альфа выхода берётся
# у ГЛАВНОГО входа: прозрачный холст остался бы прозрачным и под накладкой.
# У `drawbox` константы размера входа — `iw`/`ih` (`W`/`H` там не определены; `w`/`h` — это
# СВОИ ширина и высота коробки). Измерено 03:22: `W` даёт `Unknown function in 'W-400)…'`.
X="(iw-400)/2+180*sin(2*PI*t/5)"
ALPHA_SRC=(-f lavfi -i "color=c=black@0:s=${W}x${H}:r=${FPS}:d=5,format=rgba")
ALPHA_FILTER="[0:v]drawbox=x='${X}':y='(ih-400)/2':w=400:h=400:color=red@1:t=fill:replace=1,drawbox=x='${X}+80':y='(ih-400)/2+80':w=240:h=240:color=yellow@1:t=fill:replace=1,format=rgba[a]"

echo
echo "== A4.2: альфа-файлы, по два прогона каждый =="
mk_prores() {
  "$FF" "${COMMON[@]}" "${ALPHA_SRC[@]}" -filter_complex "$ALPHA_FILTER" -map '[a]' \
    -c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le -an "${BITEXACT[@]}" "$1"
}
mk_qtrle() {
  "$FF" "${COMMON[@]}" "${ALPHA_SRC[@]}" -filter_complex "$ALPHA_FILTER" -map '[a]' \
    -c:v qtrle -pix_fmt argb -an "${BITEXACT[@]}" "$1"
}
mk_vp9() {
  "$FF" "${COMMON[@]}" "${ALPHA_SRC[@]}" -filter_complex "$ALPHA_FILTER" -map '[a]' \
    -c:v libvpx-vp9 -pix_fmt yuva420p -b:v 2M -deadline good -cpu-used 2 -threads 4 -an "${BITEXACT[@]}" "$1"
}
mk_prores "$OUT/alpha-prores-1.mov"; mk_prores "$OUT/alpha-prores-2.mov"
mk_qtrle  "$OUT/alpha-qtrle-1.mov";  mk_qtrle  "$OUT/alpha-qtrle-2.mov"
mk_vp9    "$OUT/alpha-vp9-1.webm";   mk_vp9    "$OUT/alpha-vp9-2.webm"
for f in alpha-prores-1.mov alpha-prores-2.mov alpha-qtrle-1.mov alpha-qtrle-2.mov alpha-vp9-1.webm alpha-vp9-2.webm; do
  printf '%-22s %s  %9s Б  pix_fmt %s\n' "$f" "$(sha "$OUT/$f")" "$(stat -c%s "$OUT/$f")" \
    "$("$FP" -v error -select_streams v:0 -show_entries stream=pix_fmt -of csv=p=0 "$OUT/$f")"
done

# Есть ли в файле альфа ВООБЩЕ — вопрос к декодеру, а не к строке команды.
echo
echo '-- альфа в файле есть? (alphaextract на первом кадре) --'
has_alpha() {
  if "$FF" -v error -i "$1" -vframes 1 -vf alphaextract -f rawvideo -pix_fmt gray -y /dev/null 2>/dev/null; then
    "$FF" -v error -i "$1" -vframes 1 -vf alphaextract -f rawvideo -pix_fmt gray - 2>/dev/null |
      python3 -c "
import sys
from collections import Counter
b = sys.stdin.buffer.read()
c = Counter(b)
top = ', '.join(f'{v}×{n}' for v, n in c.most_common(3))
print(f'ДА — пикселей {len(b)}, различных значений альфы {len(c)}, чаще всего: {top}')"
  else
    echo 'НЕТ — декодер отвечает `Requested planes not available` (альфа в файл не попала)'
  fi
}
for f in alpha-prores-1.mov alpha-qtrle-1.mov alpha-vp9-1.webm; do
  printf '%-22s ' "$f"; has_alpha "$OUT/$f"
done

echo
echo "== A4.3: декод → PNG с альфой, два прогона =="
decode_png() {
  local src="$1" dst="$2"
  rm -rf "$dst"; mkdir -p "$dst"
  "$FF" "${COMMON[@]}" -i "$src" -vf "format=rgba" -f image2 "$dst/f_%04d.png"
}
for pair in "alpha-prores-1.mov prores" "alpha-qtrle-1.mov qtrle" "alpha-vp9-1.webm vp9"; do
  set -- $pair
  decode_png "$OUT/$1" "$OUT/png-$2-a"
  decode_png "$OUT/$1" "$OUT/png-$2-b"
  a=$(cat "$OUT/png-$2-a"/*.png | sha256sum | cut -d' ' -f1)
  b=$(cat "$OUT/png-$2-b"/*.png | sha256sum | cut -d' ' -f1)
  n=$(ls "$OUT/png-$2-a"/*.png | wc -l)
  bytes=$(du -sb "$OUT/png-$2-a" | cut -f1)
  printf '%-8s кадров %3d  sha прогона A %s  B %s  равны: %s  Б/кадр %d  всего %d МиБ\n' \
    "$2" "$n" "${a:0:16}" "${b:0:16}" "$([ "$a" = "$b" ] && echo да || echo НЕТ)" \
    "$((bytes / n))" "$((bytes / 1048576))"
done

echo
echo "== A4.4: overlay альфы ПРЯМО ИЗ ФАЙЛА (путь A2) =="
for pair in "alpha-prores-1.mov prores" "alpha-qtrle-1.mov qtrle" "alpha-vp9-1.webm vp9"; do
  set -- $pair
  "$FF" "${COMMON[@]}" -i "$HERE/src/src-video.mp4" -i "$OUT/$1" \
    -filter_complex "[1:v]format=rgba[gfx];[0:v][gfx]overlay=0:0:format=auto:eof_action=pass,format=yuv420p[v]" \
    -map '[v]' -t 5 -an "${VENC[@]}" "${BITEXACT[@]}" -f mp4 "$OUT/over-$2.mp4"
  printf '%-8s overlay из файла: %s  %9s Б\n' "$2" "$(sha "$OUT/over-$2.mp4")" "$(stat -c%s "$OUT/over-$2.mp4")"
done
echo '  (over-vp9.mp4 — контроль: у файла без альфы наложение закрывает кадр целиком)'

echo
echo "== A4.5: занятая область =="
# `cropdetect` по альфе оставлен в приборе как ИЗМЕРЕННЫЙ отрицательный результат: на
# двухцветной альфе (0 либо 255) он возвращает ПОЛНЫЙ КАДР. Паспорт ассета обязан нести
# точный прямоугольник, поэтому считает его свой обход rawvideo (`a4-bbox.py`).
echo "-- cropdetect по альфе (готовый инструмент): самые частые ответы --"
"$FF" -hide_banner -nostdin -loglevel info -i "$OUT/alpha-prores-1.mov" \
  -vf "alphaextract,cropdetect=limit=0:round=2:reset=1" -f null - 2>&1 |
  sed -n 's/.*crop=\([0-9:]*\).*/\1/p' | sort | uniq -c | sort -rn | head -3 | sed 's/^/   prores /'
python3 "$HERE/a4-bbox.py" "$OUT/alpha-prores-1.mov" "$OUT/alpha-prores-2.mov" prores
python3 "$HERE/a4-bbox.py" "$OUT/alpha-qtrle-1.mov" "$OUT/alpha-qtrle-2.mov" qtrle
