// Bundles the client into one self-contained HTML file (dist/brawlheim.html)
// for offline play: local battles and bots, no game server needed.
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = await build({
  entryPoints: [path.join(ROOT, 'public/js/main.js')],
  bundle: true, write: false, format: 'iife', minify: true, target: 'es2020',
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
html = `<title>Brawlheim</title>
<style>
:root { color-scheme: dark; }
${css}
</style>
${body}
<script>window.BRAWL_STANDALONE = true;</script>
<script>${js}</script>
`;
await mkdir(path.join(ROOT, 'dist'), { recursive: true });
await writeFile(path.join(ROOT, 'dist/brawlheim.html'), html);
console.log(`dist/brawlheim.html (${(html.length / 1024).toFixed(0)} KB)`);
