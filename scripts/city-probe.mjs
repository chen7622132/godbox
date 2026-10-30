/**
 * 城内特写：看游戏里实际大小的居民/士兵能不能分清种族和职业。
 */
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { writeFileSync } from 'node:fs';

const proto = Object.getPrototypeOf(createCanvas(1, 1));
proto.getBoundingClientRect = function () {
  return { width: this.width || 1100, height: this.height || 800 };
};
globalThis.window = { devicePixelRatio: 1, addEventListener() {} };
globalThis.document = { createElement: () => createCanvas(1, 1) };

const { generateWorld } = await import('../src/core/world.ts');
const { seedRaces } = await import('../src/sim/seed.ts');
const { stepWorld } = await import('../src/sim/simulation.ts');
const { updateFire, updatePlague } = await import('../src/sim/disasters.ts');
const { Renderer } = await import('../src/render/renderer.ts');

const W = 1100;
const H = 800;
const display = createCanvas(W, H);
const world = generateWorld({ size: 'medium', seed: Number(process.env.SEED ?? 20261030), landRatio: 0.45, fragmentation: 0.35 });
seedRaces(world, [0, 1, 2, 3]);
for (let i = 0; i < Number(process.env.TICKS ?? 2200); i++) {
  stepWorld(world);
  if (world.tick % 3 === 0) updateFire(world);
  if (world.tick % 12 === 0) updatePlague(world);
}

const r = new Renderer(display, world);

async function shot(name, cx, cy, zoom, cw, chh, zf) {
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
  console.log(`  → /tmp/${name}.png zoom=${zoom}`);
}

// 找人口最多、且四个种族里最"混合"的城
const live = world.settlements.filter((s) => s.alive && !s.ruin);
for (const race of [0, 1, 2, 3]) {
  const pick = live.filter((s) => s.race === race).sort((a, b) => b.pop - a.pop)[0];
  if (!pick) continue;
  const units = world.units.filter((u) => Math.hypot(u.x - pick.x, u.y - pick.y) < 5);
  console.log(`种族${race} ${pick.name}: ${units.length} 人`);
  await shot(`city-race${race}`, pick.x + 0.5, pick.y + 0.5, 32, 260, 190, 4);
}
