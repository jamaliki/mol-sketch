#!/usr/bin/env bash
# Regenerates every image in docs/img from the settings files in looks/.
# Each block is the exact command for one look; docs/looks.md explains the settings.
# Usage:  ./make-previews.sh            (run from the repo root; needs `npm install` done once)
set -euo pipefail
cd "$(dirname "$0")"
R="node render.js"
# Previews are rendered at --scale 1 (960×720) to keep the repo small; use --scale 2 or 3 for real output.
OUT=.previews; mkdir -p docs/img "$OUT"

# 6GZQ (70S ribosome, mmCIF, 144k atoms) is not in the repo; fetch it once.
[ -f 6GZQ.cif ] || curl -sSL -o 6GZQ.cif https://files.rcsb.org/download/6GZQ.cif

# 1. Serine hydrolase mechanism, watercolour — frame 28 = end of the first hold, arrows fully drawn
$R examples/mechanism.json --settings looks/watercolour.json --scale 1 --frames 28 --out "$OUT/mechanism_watercolour"
cp "$OUT/mechanism_watercolour/frame_0028.png" docs/img/mechanism_watercolour.png

# 2. Same frame, ink colour
$R examples/mechanism.json --settings looks/ink-colour.json --scale 1 --frames 28 --out "$OUT/ink_colour"
cp "$OUT/ink_colour/frame_0028.png" docs/img/ink_colour.png

# 3. Same frame, plain ink
$R examples/mechanism.json --settings looks/ink.json --scale 1 --frames 28 --out "$OUT/ink"
cp "$OUT/ink/frame_0028.png" docs/img/ink.png

# 4. Same frame, coloured pencil with construction lines
$R examples/mechanism.json --settings looks/pencil.json --scale 1 --frames 28 --out "$OUT/pencil"
cp "$OUT/pencil/frame_0028.png" docs/img/pencil.png

# 5. Protein: watercolour cartoon + ligand sticks, then the same as a surface coloured by residue
$R examples/test_protein.pdb --settings looks/watercolour.json --set view.yaw=30 --set view.pitch=20 \
   --scale 1 --frames 0 --out "$OUT/protein_cartoon"
cp "$OUT/protein_cartoon/frame_0000.png" docs/img/protein_cartoon_watercolour.png
$R examples/test_protein.pdb --settings looks/watercolour.json --set view.yaw=30 --set view.pitch=20 \
   --set reps.cartoon= --set reps.surface=polymer --set reps.sticks=hetatm --set rep.surfaceColor=carbon --set rep.colorBy=residue \
   --scale 1 --frames 0 --out "$OUT/protein_surface"
cp "$OUT/protein_surface/frame_0000.png" docs/img/protein_surface_watercolour.png

# 6. Ribosome surface coloured by subunit (S green, L orange, tRNA rose), square
$R 6GZQ.cif --settings looks/assembly-surface.json --set reps.cartoon= --set reps.sticks= --set reps.surface=polymer \
   --size 900x900 --scale 1 --frames 0 --out "$OUT/ribosome_surface"
cp "$OUT/ribosome_surface/frame_0000.png" docs/img/ribosome_surface_by_subunit.png

# 7. Ribosome cartoon (tubes for RNA, ribbons for protein) coloured by subunit
$R 6GZQ.cif --settings looks/assembly-cartoon.json --set reps.cartoon=polymer --set reps.sticks= --set reps.surface= \
   --size 900x900 --scale 1 --frames 0 --out "$OUT/ribosome_cartoon"
cp "$OUT/ribosome_cartoon/frame_0000.png" docs/img/ribosome_cartoon_by_subunit.png

# 8. Turntable of the surface: 36 frames of one yaw turn with a 12° pitch nod → GIF/MP4
$R 6GZQ.cif --settings looks/assembly-surface.json --set reps.cartoon= --set reps.sticks= --set reps.surface=polymer \
   --set view.pitchSwing=12 --size 720x720 --scale 1 --turntable 36 --out "$OUT/ribosome_turntable"
if command -v ffmpeg >/dev/null; then
  ffmpeg -y -loglevel error -framerate 12 -pattern_type glob -i "$OUT/ribosome_turntable/frame_*.png" \
         -c:v libx264 -pix_fmt yuv420p -crf 18 docs/img/ribosome_turntable.mp4
  ffmpeg -y -loglevel error -framerate 12 -pattern_type glob -i "$OUT/ribosome_turntable/frame_*.png" \
         -vf "scale=480:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer" \
         docs/img/ribosome_turntable.gif
fi
echo "done → docs/img"
