# The website hero

The serine hydrolase mechanism as a 26-second loop for the front page of jamali-lab: atoms and bonds only, no text,
no arrows, framed for the hero's layout, on the site's own colours. Two papers: `hero_dark.json` on the hero's navy
(`#0f172a`) and `hero_cream.json` on the site's paper (`#f2efe8`).

```bash
cd app && npm install && npm run build        # once
cd ../hero
./render.sh dark                              # → out/hero_dark.{mp4,webm}, hero_dark_poster.jpg (~3 min)
./render.sh cream                             # the cream variant
./render.sh dark-mobile                       # 1080x1920, framed for a phone
./render.sh calb                              # CALB / pNPA from real coordinates, with the arrows — see calb/README.md
./render.sh calb-chalk                        # the same as chalk on the board;  calb-mobile, calb-chalk-mobile likewise
SOFTWARE="" ./render.sh dark                  # on a machine with a GPU
```

`render.sh` is the whole recipe: the scene file (the mechanism with the hero's camera and residue colours), the look
(`dark-paper` or `chalkboard`, both in `looks/` and in the app, or `watercolour` with the site's palette for cream),
the `--set` flags that remove text and, for the demo, the chemistry, and the ffmpeg lines that encode AV1, VP9 and
H.264 and the poster. `mockup.html` is the page with every variant behind a switch, and a phone frame.

To do the same for another mechanism: [`../docs/hero-workflow.md`](../docs/hero-workflow.md). In short, a recipe and
`tools/mech2scene.py` make the scene, `node cli/render.mjs scene.json --size 1920x1080 --fit 57,13,92,58 --write-view`
frames it for the hero (`--fit 11,15,89,45` at 1080x1920 for phones), and a `case` line in `render.sh` renders it.

## On the page

Replace the sources of the hero `<video>` and drop the Blender clip's filter classes (`brightness-[0.82]
contrast-[1.6] saturate-[1.65]`), which were tuned for that footage and would crush this one:

```html
<video loop playsinline muted autoplay preload="none" poster="/assets/hero_dark_poster.jpg" class="h-full w-full object-cover">
  <source src="/assets/hero_dark.av1.mp4" type="video/mp4; codecs=av01.0.08M.08">
  <source src="/assets/hero_dark.webm" type="video/webm; codecs=vp09.00.40.08">
  <source src="/assets/hero_dark.mp4" type="video/mp4">
</video>
```

Three encodes of every loop, listed smallest first; a browser takes the first `type` it can play. AV1 is about a
third the size of the H.264 file (Chrome, Firefox, Edge, Safari 17 on hardware with an AV1 decoder), VP9 about half
(everything else current), H.264 is the fallback. Two other things keep the files small: the strokes re-jitter every
second drawing while the atoms still move on every one (`boilHold=2`; `BOILHOLD=1 ./render.sh …` for the nervier
boil), and the quality settings (AV1 crf 40, VP9 crf 38, H.264 crf 24) were chosen by looking at 1:1 crops of the
strokes, which the site then shows under a darkening gradient.

and in the CSS, `.hero-art video { object-position: 70% 40%; }` instead of `60% 40%`. The overlay gradient stays.

## Phones

Browsers ignore `media` on a `<video>`'s `<source>`, so the portrait file is chosen once at load, the way the mock-up
does it: give the video no sources, and

```html
<video id="hero-video" loop playsinline muted autoplay preload="none" class="h-full w-full object-cover"></video>
<script>
  const v = document.getElementById('hero-video');
  const m = matchMedia('(max-width: 767px)').matches;          // the site's own phone breakpoint
  const f = m ? '/assets/hero_dark-mobile' : '/assets/hero_dark';
  v.poster = f + '_poster.jpg';
  for (const [ext, type] of [['av1.mp4', 'video/mp4; codecs=av01.0.08M.08'], ['webm', 'video/webm; codecs=vp09.00.40.08'], ['mp4', 'video/mp4']]) {
    const s = document.createElement('source'); s.src = f + '.' + ext; s.type = type; v.append(s);
  }
  v.load();
</script>
```

with `@media (max-width: 767px) { .hero-art video { object-position: 50% 35%; } }`. The portrait renders put the
drawing in the upper third, above where the headline starts on a phone (about 48 % of the height at 390×844), and
within the 82 % of the width a 9:16 file shows in a phone's taller viewport. In React the same goes in an effect
that sets `src` from `window.matchMedia` before the element mounts its sources.

For the cream variant the hero's text flips to the site's ink: `.home-hero` gets `background: var(--paper); color:
var(--ink)`, the paragraph `color: var(--muted)`, the secondary button a dark border, and the overlay becomes a cream
gradient with `mix-blend-mode: normal` (`mockup.html` has the exact rules).

## Composition

The molecule sits in the video at x 57–92 %, y 13–58 % (its centre at 74 %, 36 %): this is the `--fit 57,13,92,58` box,
and the *hero desktop* preset in the app's *Frame* section; the phone box is `11,15,89,45`. That clears the fixed nav (9 % of a
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
