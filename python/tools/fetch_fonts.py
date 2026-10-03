"""Fetch the web fonts exactly as Chrome gets them for the app (app/index.html's Google Fonts request, with Chrome's
user agent), convert each woff2 subset to TTF, and write molsketch/fonts/manifest.json: one face per @font-face rule,
with its family, weight, style, unicode ranges and file. Run from python/: .venv/bin/python tools/fetch_fonts.py"""
import hashlib, io, json, pathlib, re, subprocess
from fontTools.ttLib import TTFont

HERE = pathlib.Path(__file__).resolve().parent.parent
OUT = HERE / "molsketch" / "fonts"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36"

def get(url):
    return subprocess.run(["curl", "-sfL", "-A", UA, url], check=True, capture_output=True).stdout   # curl: the system's certificates

def main():
    html = (HERE.parent / "app" / "index.html").read_text()   # the request the app's fonts come from, noted in its head
    url = re.search(r'https://fonts\.googleapis\.com/css2[^"\s,]*(?:,[^"\s,]*)*[^"\s,]', html).group(0).replace("&amp;", "&")
    css = get(url).decode()
    faces, files = [], {}
    for block in re.findall(r"@font-face\s*{([^}]*)}", css):
        prop = dict((k.strip(), v.strip()) for k, v in (l.split(":", 1) for l in block.split(";") if ":" in l))
        src = re.search(r"url\(([^)]+)\)", prop["src"]).group(1)
        if src not in files:
            ttf = TTFont(io.BytesIO(get(src))); ttf.flavor = None; buf = io.BytesIO(); ttf.save(buf)
            name = hashlib.sha1(src.encode()).hexdigest()[:12] + ".ttf"; (OUT / name).write_bytes(buf.getvalue()); files[src] = name
        ranges = []
        for r in prop.get("unicode-range", "U+0-10FFFF").split(","):
            a, _, b = r.strip()[2:].partition("-"); ranges.append([int(a, 16), int(b or a, 16)])
        t = TTFont(OUT / files[src]); os2, hhea = t["OS/2"], t["hhea"]
        metrics = {"upem": t["head"].unitsPerEm, "typoAscender": os2.sTypoAscender, "typoDescender": os2.sTypoDescender,
                   "hheaAscender": hhea.ascent, "hheaDescender": hhea.descent, "lineGap": hhea.lineGap,
                   "winAscent": os2.usWinAscent, "winDescent": os2.usWinDescent, "useTypo": bool(os2.fsSelection & (1 << 7)),
                   "axes": {a.axisTag: [a.minValue, a.defaultValue, a.maxValue] for a in t["fvar"].axes} if "fvar" in t else {}}
        faces.append({"family": prop["font-family"].strip("'\""), "weight": int(prop.get("font-weight", "400")),
                      "style": prop.get("font-style", "normal"), "ranges": ranges, "file": files[src], "metrics": metrics})
    (OUT / "manifest.json").write_text(json.dumps({"source": url, "faces": faces}, indent=1))
    print(f"{len(faces)} faces, {len(files)} files → {OUT}")

if __name__ == "__main__":
    main()
