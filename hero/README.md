# The website hero

The serine hydrolase mechanism as a 26-second loop for the front page of jamali-lab: atoms and bonds only, no text,
no arrows, framed for the hero's layout, on the site's own colours. Two papers: `hero_dark.json` on the hero's navy
(`#0f172a`) and `hero_cream.json` on the site's paper (`#f2efe8`).

```bash
cd app && npm install && npm run build        # once
cd ../hero
./render.sh dark                              # → hero_dark.mp4, hero_dark.webm, hero_dark_poster.jpg (~3 min)
./render.sh cream                             # the cream variant
SOFTWARE="" ./render.sh dark                  # on a machine with a GPU
```

`render.sh` is the whole recipe: the scene file (the mechanism with the hero's camera and residue colours), the look
(`dark-paper`, new in `looks/` and in the app, or `watercolour` with the site's palette for cream), the `--set show.*=false`
flags that remove labels, captions, step numbers, arrows, charges and lone pairs, and the ffmpeg lines that encode
H.264 (every browser), VP9 (smaller, first choice) and the poster.

## On the page

Replace the sources of the hero `<video>` and drop the Blender clip's filter classes (`brightness-[0.82]
contrast-[1.6] saturate-[1.65]`), which were tuned for that footage and would crush this one:

```html
<video loop playsinline muted autoplay preload="none" poster="/assets/hero_dark_poster.jpg" class="h-full w-full object-cover">
  <source src="/assets/hero_dark.webm" type="video/webm">
  <source src="/assets/hero_dark.mp4" type="video/mp4">
</video>
```

and in the CSS, `.hero-art video { object-position: 70% 40%; }` instead of `60% 40%`. The overlay gradient stays.

For the cream variant the hero's text flips to the site's ink: `.home-hero` gets `background: var(--paper); color:
var(--ink)`, the paragraph `color: var(--muted)`, the secondary button a dark border, and the overlay becomes a cream
gradient with `mix-blend-mode: normal` (`mockup.html` has the exact rules).

## Composition

The molecule sits in the video at x 57–92 %, y 13–58 % (its centre at 74 %, 36 %). That clears the fixed nav (9 % of a
900 px viewport) and the headline, which at 1440×900 starts at 50 % of the height and runs to 50 % of the width on
its first line and 74 % on its second. With `object-position: 70% 40%` the crop at 16:10 and 4:3 is taken mostly from
the empty left of the frame, so the drawing keeps its place beside the headline instead of sliding under it; at 4:3 the
lowest atoms touch the second headline line, and on a phone the viewport shows the middle of the drawing. The
leaving group exits to the right and is cropped as it goes, which reads as leaving.

## Colours

Dark: carbons per residue in the site's oranges and their neighbours — Ser195 `#f97316` (the brand orange, the
nucleophile), His57 `#fbbf24`, Asp102 `#7dd3fc`, Gly193 `#a8a29e`, the substrate and water `#d6d3d1`; oxygen
`#fb923c`, nitrogen `#a5b4fc`, hydrogens and the ink `#f2efe8`. On dark paper pigment is laid down before the
translucent layers (screened layers alone never reach the colour), shading goes toward near-black rather than
toward the pale ink, and there is no wash: the `dark-paper` look. Cream: Ser195 `#f97316`, His57 `#f59e0b`, Asp102
`#3b8ea5`, Gly193 `#a8a29e`, substrate `#78716c`; oxygen `#ea580c`, nitrogen `#4f6fb5`, ink `#0f172a`, a faint orange
wash (0.2) that breathes through the loop.
