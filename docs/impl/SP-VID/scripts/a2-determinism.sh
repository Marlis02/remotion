#!/usr/bin/env bash
# SP-VID A2 — ДЕТЕРМИНИЗМ ffmpeg НА КОМПОЗИЦИИ ВИДЕО.
#
# ОДНА команда ffmpeg делает всё, что требует гипотеза «(а)»:
#   вход 0 — синтетическое видео 20 с (НИЖНИЙ слой) со своим звуком (бэд);
#   вход 1 — PNG-последовательность с альфой из A1 (ВЕРХНИЙ слой, `overlay`), зациклена
#            фильтром `loop` и ОБРЕЗАНА `trim` по длине ролика;
#   вход 2 — «голос» (sine с паузами);
#   стоп-кадр 2 с посередине — `loop=loop=60:size=1:start=270` (кадр 270 = 9-я секунда);
#   зум на ходу — `zoompan` (вариант A2; варианты A3 меряются отдельно);
#   звук — `sidechaincompress` (бэд под голосом) + `amix`, ресемплер и энкодер канальные.
#
# ═══ ДВА ДЕФЕКТА ПЕРВОГО ВАРИАНТА ГРАФА, НАЙДЕННЫЕ ИЗМЕРЕНИЕМ (03:14) ═══
#   1. `overlay=…:eof_action=repeat` при БЕСКОНЕЧНОЙ графике (`loop=loop=-1`) даёт
#      БЕСКОНЕЧНЫЙ выход: framesync продолжает работу, пока жив хоть один вход, а
#      бесконечный вход жив всегда. Измерено: 436 МБ за 12 минут, прогон не кончился.
#      Лечение — конечная графика (`trim=duration=…`) И `shortest=1`; оба, а не одно:
#      первое чинит причину, второе не даёт ей вернуться при правке длины.
#   2. Стоп-кадр через `split`+`trim`+`concat` заставляет ffmpeg БУФЕРИЗОВАТЬ хвост
#      источника (ветка `trim=9:20` потребляется последней) — 743 МБ RSS на 20 с
#      1080×1920. Лечение — `loop`, он работает в порядке потока и держит один кадр.
#
# ═══ ТРЕТИЙ ДЕФЕКТ, И ОН НЕ НАШ (найден повтором прогона, 04:15) ═══
# `sidechaincompress` в этой сборке ffmpeg НЕДЕТЕРМИНИРОВАН: при неизменных входах он в
# части прогонов даёт другой звук. Видео при этом побитово то же — `framemd5` совпадает
# всегда, расходится только `sha256` файла. Изоляция и попытки лечения — `a2b-audio.sh`.
# Поэтому прогонов здесь ВОСЕМЬ, а не четыре: при доле срыва ~1 из 8 четыре прогона его
# пропускают чаще, чем ловят.

# ВОСЕМЬ ПРОГОНОВ → ВОСЕМЬ sha256 + framemd5.

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/lib.sh"

SRC="$HERE/src"
FRAMES="${1:-$HERE/a1/frames-clear}"
OUT="$HERE/a2"
mkdir -p "$OUT"

NF=$(ls "$FRAMES"/*.png 2>/dev/null | wc -l)
if [ "$NF" -eq 0 ]; then echo "A2: нет кадров в $FRAMES — сначала A1" >&2; exit 2; fi

DUR=22          # 20 с источника + 2 с стоп-кадра
FREEZE_AT=270   # кадр 9-й секунды
FREEZE_N=60     # 2 с при 30 fps

FILTER="
[0:v]loop=loop=${FREEZE_N}:size=1:start=${FREEZE_AT},setpts=N/${FPS}/TB[frozen];
[frozen]zoompan=z='min(zoom+0.0003,1.2)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${W}x${H}:fps=${FPS}[bg];
[1:v]loop=loop=-1:size=${NF}:start=0,trim=duration=${DUR},setpts=N/${FPS}/TB,format=rgba[gfx];
[bg][gfx]overlay=0:0:format=auto:shortest=1,format=yuv420p[vout];
[2:a]asplit=2[vo1][vosc];
[0:a][vosc]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=300[bedduck];
[bedduck][vo1]amix=inputs=2:duration=longest:normalize=0,${ARESAMPLE}[aout]
"

run() {
  local n="$1"
  "$FF" "${COMMON[@]}" \
    -i "$SRC/src-video.mp4" \
    -framerate "$FPS" -i "$FRAMES/frame_%06d.png" \
    -i "$SRC/voice.wav" \
    -filter_complex "$FILTER" -map '[vout]' -map '[aout]' \
    "${VENC[@]}" "${AENC[@]}" "${BITEXACT[@]}" -f mp4 "$OUT/run$n.mp4"
  "$FF" "${COMMON[@]}" -i "$OUT/run$n.mp4" -map 0:v -f framemd5 "$OUT/run$n.framemd5"
}

echo "== A2: 8 прогонов одной команды =="
for n in 1 2 3 4 5 6 7 8; do
  t0=$(date +%s.%N)
  run "$n"
  t1=$(date +%s.%N)
  printf 'run%s  sha %s  framemd5 %s  %.1f с  %s Б\n' \
    "$n" "$(sha "$OUT/run$n.mp4")" "$(sha "$OUT/run$n.framemd5")" "$(echo "$t1 - $t0" | bc)" "$(stat -c%s "$OUT/run$n.mp4")"
done

echo "-- сводка --"
sha256sum "$OUT"/run?.mp4 | awk '{print $1}' | sort -u | wc -l | xargs printf 'различных sha256 файла: %s\n'
sha256sum "$OUT"/run?.framemd5 | awk '{print $1}' | sort -u | wc -l | xargs printf 'различных framemd5:     %s\n'
"$FP" -v error -show_entries stream=codec_name,width,height,nb_frames,pix_fmt,sample_rate -of csv=p=0 "$OUT/run1.mp4"
"$FP" -v error -show_entries format=duration -of csv=p=0 "$OUT/run1.mp4"
