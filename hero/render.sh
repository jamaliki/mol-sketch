#!/usr/bin/env bash
# Renders the hero animation: 312 drawings (26 s at 12 fps), 1920x1080, no text and no arrows.
# usage: ./render.sh dark|cream OUTDIR      (from app/: needs `npm run build` once)
set -euo pipefail
SOFTWARE=${SOFTWARE:---software}   # CPU GL (SwiftShader); SOFTWARE="" to use the GPU
paper=${1:-dark}; out=${2:-out_hero_$paper}
here="$(cd "$(dirname "$0")" && pwd)"; cd "$here/../app"
NOTEXT="--set show.labels=false --set show.resLabels=false --set show.caption=false --set show.stepLabel=false --set show.arrows=false --set show.charges=false --set show.lonePairs=false"
if [ "$paper" = dark ]; then
  node cli/render.mjs "$here/hero_dark.json" --look dark-paper $NOTEXT --size 1920x1080 --frames drawn --out "$out" $SOFTWARE
else
  node cli/render.mjs "$here/hero_cream.json" --look watercolour $NOTEXT --size 1920x1080 --frames drawn --out "$out" $SOFTWARE \
    --set palette.paper=#f2efe8 --set palette.ink=#0f172a --set palette.hatch=#0f172a --set palette.C=#57534e --set palette.N=#4f6fb5 \
    --set palette.O=#ea580c --set palette.H=#faf9f5 --set palette.wash=#f97316 --set paper.wash=0.2
fi
# the site files: H.264 for every browser, VP9 as the smaller first choice, and the poster (frame 28, the Michaelis complex)
ffmpeg -y -loglevel error -framerate 12 -pattern_type glob -i "$out/frame_*.png" -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -movflags +faststart "$here/hero_$paper.mp4"
ffmpeg -y -loglevel error -framerate 12 -pattern_type glob -i "$out/frame_*.png" -c:v libvpx-vp9 -b:v 0 -crf 33 -row-mt 1 -pix_fmt yuv420p "$here/hero_$paper.webm"
ffmpeg -y -loglevel error -i "$out/frame_0028.png" -q:v 3 "$here/hero_${paper}_poster.jpg"
