#!/usr/bin/env bash
# SP-VID A6 — DUCK: три пресета `sidechaincompress`, файлы на уши + измерение `ebur128`.
#
# Что меряется. LUFS ФОНА под голосом и без него — две величины, а не одна: «подавление»
# есть РАЗНОСТЬ, и без второй половины число не значит ничего. Голос из фона выключен
# (в дорожку идёт только бэд, пропущенный через компрессор с голосом на sidechain), иначе
# `ebur128` мерил бы сумму и разность бы съело.
#
# Окна: голос звучит 0–3, 5–10, 12–22 с (паузы 3–5 и 10–12 — см. `a0-sources.sh`).
# «Под голосом» берётся 6–9 с, «без голоса» — 3.3–4.7 с (внутри первой паузы, с отступом
# на attack/release).

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/lib.sh"

SRC="$HERE/src"
OUT="$HERE"

duck() {
  local name="$1" thr="$2" ratio="$3" attack="$4" release="$5"
  "$FF" "${COMMON[@]}" -i "$SRC/src-video.mp4" -i "$SRC/voice.wav" \
    -filter_complex "[0:a]atrim=0:20,asetpts=PTS-STARTPTS[bed];[1:a]atrim=0:20,asetpts=PTS-STARTPTS[vo];[bed][vo]sidechaincompress=threshold=${thr}:ratio=${ratio}:attack=${attack}:release=${release}[out]" \
    -map '[out]' -c:a pcm_s16le -f wav "$OUT/duck-$name.wav"
  # Микс «как в ролике» — отдельным файлом, чтобы слушать результат, а не только фон.
  "$FF" "${COMMON[@]}" -i "$OUT/duck-$name.wav" -i "$SRC/voice.wav" \
    -filter_complex "[0:a][1:a]amix=inputs=2:duration=first:normalize=0[m]" \
    -map '[m]' -c:a pcm_s16le -f wav "$OUT/duck-$name-mix.wav"
}

lufs() {  # файл, начало, конец
  "$FF" -hide_banner -nostdin -loglevel info -ss "$2" -to "$3" -i "$1" -af ebur128=peak=true -f null - 2>&1 |
    sed -n '/Integrated loudness/,/Threshold/p' | sed -n 's/.*I: *\(-\?[0-9.]*\) LUFS.*/\1/p' | tail -1
}

echo "== A6: три пресета duck =="
duck soft 0.10 4  50 400
duck mid  0.05 8  20 300
duck hard 0.02 20 5  150

base_under=$(lufs "$SRC/src-video.mp4" 6 9)
base_gap=$(lufs "$SRC/src-video.mp4" 3.3 4.7)
printf '%-6s фон под голосом %8s LUFS · фон в паузе %8s LUFS · подавление %s дБ\n' \
  "исход" "$base_under" "$base_gap" "0.0"
for n in soft mid hard; do
  u=$(lufs "$OUT/duck-$n.wav" 6 9)
  g=$(lufs "$OUT/duck-$n.wav" 3.3 4.7)
  printf '%-6s фон под голосом %8s LUFS · фон в паузе %8s LUFS · подавление %6.2f дБ (к своей же паузе)\n' \
    "$n" "$u" "$g" "$(echo "$u - $g" | bc -l)"
done
echo "файлы на уши: $OUT/duck-{soft,mid,hard}.wav (только фон) и duck-*-mix.wav (фон+голос)"
