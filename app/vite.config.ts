import { defineConfig, type Plugin } from 'vite';
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';

/* The app's web fonts, from the copies the Python package keeps (python/molsketch/fonts: the files Google Fonts serves
   the app, with their weights and unicode ranges in manifest.json): served at fonts/ while developing, written into the
   build, so the app needs no font service and works offline. The drawing worker loads the same stylesheet. */
const FONTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../python/molsketch/fonts');
const hex = (n: number) => n.toString(16).toUpperCase();
function fontFaces(): { css: string; files: string[] } {
  const m = JSON.parse(fs.readFileSync(path.join(FONTS, 'manifest.json'), 'utf8')) as { faces: { family: string; weight: number; style: string; ranges: [number, number][]; file: string }[] };
  const css = m.faces.map(f => `@font-face{font-family:'${f.family}';font-style:${f.style};font-weight:${f.weight};font-display:swap;src:url(${f.file}) format('truetype');unicode-range:${f.ranges.map(([a, b]) => a === b ? 'U+' + hex(a) : `U+${hex(a)}-${hex(b)}`).join(',')}}`).join('\n');
  return { css, files: [...new Set(m.faces.map(f => f.file))] };
}
function fonts(): Plugin {
  return {
    name: 'molsketch-fonts',
    configureServer(server) {
      server.middlewares.use('/fonts/', (req, res, next) => {
        const name = path.basename(decodeURIComponent((req.url || '').split('?')[0]));
        if (name === 'fonts.css') { res.setHeader('Content-Type', 'text/css'); res.end(fontFaces().css); return }
        const f = path.join(FONTS, name); if (!/\.ttf$/.test(name) || !fs.existsSync(f)) return next();
        res.setHeader('Content-Type', 'font/ttf'); res.setHeader('Cache-Control', 'max-age=86400'); fs.createReadStream(f).pipe(res);
      });
    },
    generateBundle() {
      const { css, files } = fontFaces();
      this.emitFile({ type: 'asset', fileName: 'fonts/fonts.css', source: css });
      for (const f of files) this.emitFile({ type: 'asset', fileName: 'fonts/' + f, source: fs.readFileSync(path.join(FONTS, f)) });
    },
    // the stylesheet's link, added after vite has looked at the page's own links (it is not a module of the bundle)
    transformIndexHtml: { order: 'post', handler: () => [{ tag: 'link', attrs: { rel: 'stylesheet', href: 'fonts/fonts.css', 'data-fonts': '' }, injectTo: 'head-prepend' }] },
  };
}

// base './': the built app runs from any folder or sub-path (GitHub Pages, a lab server, molsketch serve)
export default defineConfig({ base: './', plugins: [fonts()], server: { port: 5173, host: true }, build: { target: 'es2022' } });
