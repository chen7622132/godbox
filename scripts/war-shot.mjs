/**
 * 战争特写自检：方阵 / 交火线 / 箭雨 / 尸体，全部截图 + 像素探针。
 * 用法：npx esbuild scripts/war-shot.mjs --bundle --platform=node --format=esm --external:@napi-rs/canvas --outfile=war.tmp.mjs && node war.tmp.mjs
 */
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { writeFileSync } from 'node:fs';

const proto = Object.getPrototypeOf(createCanvas(1, 1));
proto.getBoundingClientRect = function () {
  return { width: this.width || 1280, height: this.height || 860 };
};
globalThis.window = { devicePixelRatio: 1, addEventListener() {} };
globalThis.document = { createElement: () => createCanvas(1, 1) };

const { generateWorld } = await import('../src/core/world.ts');
const { seedRaces } = await import('../src/sim/seed.ts');
const { stepWorld } = await import('../src/sim/simulation.ts');
const { updateFire, updatePlague } = await import('../src/sim/disasters.ts');
const { Renderer } = await import('../src/render/renderer.ts');
const { formArmy, updateArmies } = await import('../src/sim/units.ts');

const W = 1280;
const H = 860;
const display = createCanvas(W, H);

const world = generateWorld({
  size: 'medium',
  seed: Number(process.env.SEED ?? 20261030),
  landRatio: 0.45,
  fragmentation: 0.35,
});
seedRaces(world, [0, 1, 2, 3]);
const r = new Renderer(display, world);

async function crop(name, cx, cy, zoom, cw = 420, chh = 300, zf = 3) {
  r.cam.zoom = zoom;
  r.cam.x = cx;
  r.cam.y = cy;
  r.markDirty();
  r.camDirty = true;
  r.render(world);
  const img = await loadImage(await display.encode('png'));
  const [sx, sy] = r.worldToScreen(cx, cy);
  const out = createCanvas(cw * zf, chh * zf);
  const g = out.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(img, Math.round(sx - cw / 2), Math.round(sy - chh / 2), cw, chh, 0, 0, cw * zf, chh * zf);
  writeFileSync(`/tmp/${name}.png`, await out.encode('png'));
  console.log(`  → /tmp/${name}.png (zoom=${zoom})`);
}

function probe(tag) {
  const d = display.getContext('2d').getImageData(0, 0, W, H).data;
  let bar = 0, white = 0, red = 0, arrow = 0;
  for (let i = 0; i < d.length; i += 4) {
    const rr = d[i], gg = d[i + 1], bb = d[i + 2];
    if (rr === 111 && gg === 212 && bb === 90) bar++;
    if (rr > 248 && gg > 248 && bb > 248) white++;
    if (rr > 195 && rr < 215 && gg > 35 && gg < 60 && bb < 45) red++;
    if (rr > 248 && gg > 245 && bb > 220 && bb < 240) arrow++;
  }
  console.log(`  探针[${tag}] 血条绿=${bar} 纯白=${white} 血花红=${red} 箭头白=${arrow}`);
}

// ---- 跑到第一场围攻打起来 ----
let found = null;
for (let i = 0; i < 9000; i++) {
  stepWorld(world);
  if (world.tick % 3 === 0) updateFire(world);
  if (world.tick % 12 === 0) updatePlague(world);
  if (!found) {
    const c = world.armies.find((a) => a.state === 'clash' && a.kind === 'attack');
    if (c) found = { id: c.id, tick: world.tick };
  }
  if (found && world.tick > found.tick + 70) break;
}

const atk = world.armies.find((a) => a.id === found?.id);
console.log(`第一场围城：${found ? 'tick ' + found.tick : '未出现'} | 军队=${world.armies.length} 尸体=${world.corpses.length} 火花=${world.sparks.length} 箭=${world.arrows.filter((a) => a.active).length}`);

if (atk) {
  console.log(`  攻方 兵力=${(atk.strength * 100).toFixed(0)}% 存活=${atk.units.length}/${atk.initial} 状态=${atk.state}`);
  const def = world.armies.find((d) => d.kind === 'defend' && d.to === atk.to);
  if (def) console.log(`  守方 兵力=${(def.strength * 100).toFixed(0)}% 存活=${def.units.length}/${def.initial}`);
  const mx = def ? (atk.x + def.x) / 2 : atk.x;
  const my = def ? (atk.y + def.y) / 2 : atk.y;
  await crop('war-clash', mx, my, 32, 480, 340, 3);
  probe('clash32');
  await crop('war-clash-close', mx, my, 64, 320, 220, 4);
  probe('clash64');
  await crop('war-clash-far', mx, my, 16, 560, 400, 2);
  probe('clash16');
} else {
  // 兜底：手动造一场
  const live = world.settlements.filter((s) => s.alive && !s.ruin).sort((a, b) => b.pop - a.pop);
  const A = live[0];
  const B = live.find((s) => s.nation !== A.nation) ?? live[1];
  const m = formArmy(world, A.id, B.id, A.nation >= 0 ? A.nation : 0, A.race);
  if (m) {
    world.armies.push(m);
    for (let i = 0; i < 200; i++) { world.tick++; updateArmies(world); }
    await crop('war-march', m.x, m.y, 40, 380, 260, 3);
    probe('march40');
  }
}
