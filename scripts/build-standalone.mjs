// Bundles the client into one self-contained HTML file (play.html) for
// offline play: local battles and bots, no game server needed. Open it
// straight from disk or from any static host.
import { build } from 'esbuild';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = await build({
  entryPoints: [path.join(ROOT, 'public/js/main.js')],
  bundle: true, write: false, format: 'iife', minify: true, target: ['chrome64', 'firefox62', 'safari12'],
  plugins: [{
    name: 'shared',
    setup(b) { b.onResolve({ filter: /^\/shared\// }, a => ({ path: path.join(ROOT, a.path) })); },
  }],
});
const js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = await readFile(path.join(ROOT, 'public/style.css'), 'utf8');
let html = await readFile(path.join(ROOT, 'public/index.html'), 'utf8');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'))
  .replace(/<script type="module" src="\/js\/main.js"><\/script>/, '');
html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Brawlheim</title>
<style>
:root { color-scheme: dark; }
${css}
</style>
</head>
<body>
${body}
<script>window.BRAWL_STANDALONE = true;</script>
<script>${js}</script>
</body>
</html>
`;
await writeFile(path.join(ROOT, 'play.html'), html);
// dist/ is what GitHub Pages serves (see .github/workflows/pages.yml)
await rm(path.join(ROOT, 'dist'), { recursive: true, force: true });
await mkdir(path.join(ROOT, 'dist'), { recursive: true });
await writeFile(path.join(ROOT, 'dist/index.html'), html);
await writeFile(path.join(ROOT, 'dist/.nojekyll'), '');
console.log(`play.html and dist/index.html (${(html.length / 1024).toFixed(0)} KB)`);

// test.html: the graphics test page (see public/js/gfxtest.js)
const test = await build({
  entryPoints: [path.join(ROOT, 'public/js/gfxtest.js')],
  plugins: [{ name: 'shared', setup(b) { b.onResolve({ filter: /^\/shared\// }, a => ({ path: path.join(ROOT, a.path) })); } }],
  bundle: true, write: false, format: 'iife', minify: true, target: ['chrome64', 'firefox62', 'safari12'],
});
const testHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Brawlheim Graphics Test</title>
<style>
:root { color-scheme: dark; }
body { margin: 0; padding: 16px; background: #0d0b1e; color: #f2f0ff; font-family: system-ui, sans-serif; }
h1 { margin: 0 0 4px; font-size: 22px; }
.lead { margin: 0 0 14px; opacity: 0.85; }
#tests { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 12px; }
.test { background: #1d173f; border: 2px solid #4a3a8a; border-radius: 12px; padding: 10px; }
.test h3 { margin: 0 0 8px; font-size: 14px; }
.test canvas, .test img { display: block; width: 240px; height: 150px; max-width: 100%; background: #000; border-radius: 6px; }
.expect { margin: 6px 0 0; font-size: 12px; opacity: 0.8; }
.res { margin: 4px 0 0; font-size: 12px; }
.ok { color: #7be08a; } .bad { color: #ff7b7b; }
#info { white-space: pre-wrap; font: 12px ui-monospace, monospace; background: #000; padding: 10px; border-radius: 8px; margin-top: 14px; overflow-wrap: anywhere; }
</style>
</head>
<body>
<h1>Brawlheim graphics test</h1>
<p class="lead">Each box draws a picture a different way. Boxes 8 to 14 run the real game with one feature switched off at a time. Scroll down and take screenshots of all 14 boxes, so we can see which ones show up black on your computer.</p>
<div id="tests"></div>
<div id="info"></div>
<script>${test.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script>
</body>
</html>
`;
await writeFile(path.join(ROOT, 'test.html'), testHtml);
await writeFile(path.join(ROOT, 'dist/test.html'), testHtml);
console.log(`test.html (${(testHtml.length / 1024).toFixed(0)} KB)`);
