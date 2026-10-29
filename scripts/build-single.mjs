/**
 * 把 vite build 的产物打成「一个 html 文件」，双击就能玩，不需要服务器。
 * 用法：npm run build:single
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dist = 'dist';
const assetsDir = join(dist, 'assets');
const assets = readdirSync(assetsDir);

const jsName = assets.find((f) => f.endsWith('.js'));
const cssName = assets.find((f) => f.endsWith('.css'));
if (!jsName) throw new Error('dist/assets 里找不到 js，请先执行 vite build');

let html = readFileSync(join(dist, 'index.html'), 'utf8');

const js = readFileSync(join(assetsDir, jsName), 'utf8');
const css = cssName ? readFileSync(join(assetsDir, cssName), 'utf8') : '';

// 内联 JS（替换外链 script）
html = html.replace(
  /<script[^>]*src="[^"]*"[^>]*><\/script>/i,
  () => `<script type="module">\n${js}\n</script>`,
);

// 内联 CSS
if (css) {
  if (/<link[^>]*stylesheet[^>]*>/i.test(html)) {
    html = html.replace(/<link[^>]*stylesheet[^>]*>/i, () => `<style>\n${css}\n</style>`);
  } else {
    html = html.replace('</head>', `<style>\n${css}\n</style>\n</head>`);
  }
}

writeFileSync('godbox.html', html, 'utf8');
console.log(`已生成 godbox.html（${(html.length / 1024).toFixed(0)} KB）—— 双击即可游玩`);
