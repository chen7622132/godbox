/**
 * 水系诊断：把生成出来的水体按连通区域分类，
 * 长宽比 > 3 的算「河流」，接近 1 的算「湖泊」。
 */
import { generateWorld } from '../src/core/world.ts';

const w = generateWorld({ size: 'medium', seed: Number(process.env.SEED ?? 20261029), landRatio: 0.45, fragmentation: 0.35 });
const W = w.w, H = w.h;
const ter = w.terrain;

const isWater = (i) => ter[i] === 0 || ter[i] === 1;
let waterTotal = 0;
for (let i = 0; i < W * H; i++) if (isWater(i)) waterTotal++;

const seen = new Uint8Array(W * H);
const regions = [];

for (let i = 0; i < W * H; i++) {
  if (!isWater(i) || seen[i]) continue;
  const stack = [i];
  seen[i] = 1;
  let n = 0, minx = W, maxx = 0, miny = H, maxy = 0;
  const cells = [];
  while (stack.length) {
    const c = stack.pop();
    n++;
    cells.push(c);
    const x = c % W, y = (c / W) | 0;
    if (x < minx) minx = x;
    if (x > maxx) maxx = x;
    if (y < miny) miny = y;
    if (y > maxy) maxy = y;
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (isWater(j) && !seen[j]) { seen[j] = 1; stack.push(j); }
    }
  }
  const bw = maxx - minx + 1, bh = maxy - miny + 1;
  const ratio = Math.max(bw, bh) / Math.max(1, Math.min(bw, bh));
  regions.push({ n, bw, bh, ratio, x: minx, y: miny });
}

regions.sort((a, b) => b.n - a.n);
console.log(`地图 ${W}x${H}  水格 ${waterTotal}  连通水体 ${regions.length} 块\n`);
console.log('最大 12 块：');
console.log('  格数   宽x高   长宽比   左上角');
for (const r of regions.slice(0, 12)) {
  const kind = r.ratio >= 3 && r.n > 30 ? '← 河流' : (r.n > 200 ? '湖/海' : '小水洼');
  console.log(`  ${String(r.n).padStart(5)}  ${String(r.bw).padStart(3)}x${String(r.bh).padEnd(3)}  ${r.ratio.toFixed(1).padStart(5)}   (${r.x},${r.y})  ${kind}`);
}

const rivers = regions.filter((r) => r.ratio >= 3 && r.n > 30 && r.n < 2000);
const lakes = regions.filter((r) => r.ratio < 3 && r.n >= 30 && r.n < 2000);
console.log(`\n判定：河流样 ${rivers.length} 块，湖泊样 ${lakes.length} 块`);
if (rivers.length) {
  console.log('河流样区域：');
  for (const r of rivers.slice(0, 6)) console.log(`  ${r.bw}x${r.bh} (${r.n} 格) @ (${r.x},${r.y})`);
}
