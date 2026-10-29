/**
 * 离线渲染验证：在 Node 里用真实 Canvas 实现跑一遍渲染，导出 PNG 看美术效果。
 * 用法：node scripts/render-check.mjs（需先 esbuild 打包到 /tmp）
 */
import { createCanvas } from '@napi-rs/canvas';

// ---- 最小 DOM 桩，让 Renderer 能在 Node 里跑 ----
const proto = Object.getPrototypeOf(createCanvas(1, 1));
proto.getBoundingClientRect = function () {
  return { width: this.width || 1200, height: this.height || 800 };
};
globalThis.window = { devicePixelRatio: 1, addEventListener() {} };
globalThis.document = { createElement: () => createCanvas(1, 1) };

const { generateWorld } = await import('../src/core/world.ts');
const { seedRaces } = await import('../src/sim/seed.ts');
const { stepWorld } = await import('../src/sim/simulation.ts');
const { updateFire, updatePlague } = await import('../src/sim/disasters.ts');
const { Renderer } = await import('../src/render/renderer.ts');
const { writeFileSync } = await import('node:fs');

const W = 1200;
const H = 800;

const world = generateWorld({ size: 'medium', seed: 20261029, landRatio: 0.45, fragmentation: 0.35 });
seedRaces(world, [0, 1, 2, 3]);
for (let i = 0; i < 2600; i++) {
  stepWorld(world);
  if (world.tick % 3 === 0) updateFire(world);
  if (world.tick % 12 === 0) updatePlague(world);
}

const live = world.settlements.filter((s) => s.alive && !s.ruin);
console.log(`世界状态：tick=${world.tick} 城=${live.length} 国=${world.nations.filter((n) => n.alive).length}`);

const display = createCanvas(W, H);
const r = new Renderer(display, world);

async function shot(name, zoom, cx, cy) {
  // 和游戏内一致：>=4 时吸附到 4 的整数倍，保证像素不被非整数比例拉伸
  r.cam.zoom = zoom >= 4 ? Math.round(zoom / 4) * 4 : zoom;
  if (cx !== undefined) {
    r.cam.x = cx;
    r.cam.y = cy;
  }
  r.markDirty();
  r.render(world);
  const buf = await display.encode('png');
  writeFileSync(`/tmp/${name}.png`, buf);
  console.log(`  → /tmp/${name}.png  (zoom=${r.cam.zoom})`);
}

// 1) 全景
r.fit(world);
await shot('art-overview', r.cam.zoom);

// 2) 找一座最大的城市，拉近看细节
const big = live.reduce((a, b) => (a.pop > b.pop ? a : b), live[0]);
await shot('art-city-close', 14, big.x + 0.5, big.y + 0.5);
console.log(`  最大城市：${big.name} 人口 ${Math.round(big.pop)} 等级 ${big.tier} 城墙 ${big.walls}`);

// 3) 中等缩放看一片区域
await shot('art-region', 8, big.x + 0.5, big.y + 0.5);
