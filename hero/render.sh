#!/usr/bin/env bash
# Renders one hero loop and encodes it for the site: H.264 mp4, VP9 webm, poster jpg.
#   ./render.sh NAME [OUTDIR]        from hero/; needs `cd app && npm run build` once
#   NAME  dark | cream          the serine hydrolase demo (no text, no arrows), 1920x1080
#         dark-mobile           the same, framed for a phone, 1080x1920
#         calb | calb-chalk     CALB / pNPA from mechazyme (arrows, charges, lone pairs), 1920x1080
#         calb-mobile | calb-chalk-mobile             the same for a phone, 1080x1920
#   SOFTWARE="" ./render.sh calb     uses the GPU (default is CPU GL, which any machine has)
set -euo pipefail
SOFTWARE=${SOFTWARE:---software}
name=${1:-dark}; here="$(cd "$(dirname "$0")" && pwd)"; out=${2:-$here/.frames/$name}; cd "$here/../app"
NOTEXT="--set show.labels=false --set show.resLabels=false --set show.caption=false --set show.stepLabel=false"
NOCHEM="--set show.arrows=false --set show.charges=false --set show.lonePairs=false"
CHEM="--set show.arrows=true --set show.charges=true --set show.lonePairs=true --set annot=1.5 --set sphereScale=0.3"
HOLD="--set boilHold=${BOILHOLD:-2}"   # strokes re-jitter every 2nd drawing (motion still every drawing): a third off the file size; BOILHOLD=1 for the nervier boil
CREAM="--set palette.paper=#f2efe8 --set palette.ink=#0f172a --set palette.hatch=#0f172a --set palette.C=#57534e --set palette.N=#4f6fb5 --set palette.O=#ea580c --set palette.H=#faf9f5 --set palette.wash=#f97316 --set paper.wash=0.2"
case "$name" in
  dark)              scene=$here/hero_dark.json;             look=dark-paper;  size=1920x1080; extra="$NOCHEM" ;;
  cream)             scene=$here/hero_cream.json;            look=watercolour; size=1920x1080; extra="$NOCHEM $CREAM" ;;
  dark-mobile)       scene=$here/hero_dark_mobile.json;      look=dark-paper;  size=1080x1920; extra="$NOCHEM" ;;
  calb)              scene=$here/calb/calb_hero.json;        look=dark-paper;  size=1920x1080; extra="$CHEM --set palette.arrow=#f2efe8" ;;
  calb-chalk)        scene=$here/calb/calb_hero.json;        look=chalkboard;  size=1920x1080; extra="$CHEM" ;;
  calb-mobile)       scene=$here/calb/calb_hero_mobile.json; look=dark-paper;  size=1080x1920; extra="$CHEM --set palette.arrow=#f2efe8" ;;
  calb-chalk-mobile) scene=$here/calb/calb_hero_mobile.json; look=chalkboard;  size=1080x1920; extra="$CHEM" ;;
  *) echo "unknown name $name"; exit 1 ;;
esac
# the hero looks are frozen in hero/looks/: the app's looks can change without changing the website
pin=(); [ -f "$here/looks/$look.json" ] && pin=(--style "$here/looks/$look.json")
node cli/render.mjs "$scene" --look "$look" ${pin[@]+"${pin[@]}"} $NOTEXT $HOLD $extra --size "$size" --frames drawn --out "$out" $SOFTWARE
mkdir -p "$here/out"
# three encodes, smallest first: AV1 (Chrome, Firefox, Edge, Safari 17+ on hardware with a decoder), VP9, H.264 for the rest
ffmpeg -y -loglevel error -framerate 12 -pattern_type glob -i "$out/frame_*.png" -c:v libsvtav1 -crf 40 -preset 4 -svtav1-params tune=0 -pix_fmt yuv420p -movflags +faststart "$here/out/hero_$name.av1.mp4"
ffmpeg -y -loglevel error -framerate 12 -pattern_type glob -i "$out/frame_*.png" -c:v libvpx-vp9 -b:v 0 -crf 38 -row-mt 1 -deadline good -cpu-used 1 -pix_fmt yuv420p "$here/out/hero_$name.webm"
ffmpeg -y -loglevel error -framerate 12 -pattern_type glob -i "$out/frame_*.png" -c:v libx264 -preset slow -crf 24 -pix_fmt yuv420p -movflags +faststart "$here/out/hero_$name.mp4"
ffmpeg -y -loglevel error -i "$out/frame_0028.png" -q:v 4 "$here/out/hero_${name}_poster.jpg"
ls -la "$here/out/hero_$name".* | awk '{printf "%8.2f MB  %s\n", $5/1048576, $9}'
