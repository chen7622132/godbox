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
  // zoom 必须是 ZOOM_STEPS 里的档位值（1/2/3/4/8/12/16/20/24/32）
  r.cam.zoom = zoom;
  if (cx !== undefined) {
    r.cam.x = cx;
    r.cam.y = cy;
  }
  r.markDirty();
  r.camDirty = true;
  r.render(world);
  const buf = await display.encode('png');
  writeFileSync(`/tmp/${name}.png`, buf);
  console.log(`  → /tmp/${name}.png  (zoom=${r.cam.zoom}, tile=${r.tile})`);
}

// 1) 全景
r.fit(world);
await shot('art-overview', r.cam.zoom);

// 2) 找一座最大的城市，拉近看细节
const big = live.reduce((a, b) => (a.pop > b.pop ? a : b), live[0]);
await shot('art-region', 8, big.x + 0.5, big.y + 0.5);
await shot('art-city-close', 16, big.x + 0.5, big.y + 0.5);
await shot('art-max', 32, big.x + 0.5, big.y + 0.5);
console.log(`  最大城市：${big.name} 人口 ${Math.round(big.pop)} 等级 ${big.tier} 城墙 ${big.walls}`);

// 4) 城市裁切特写：把屏幕上一块区域放大 4 倍，方便看清像素级细节
{
  r.cam.zoom = 16;
  r.cam.x = big.x + 0.5;
  r.cam.y = big.y + 0.5;
  r.markDirty();
  r.camDirty = true;
  r.render(world);
  const [cx, cy] = r.worldToScreen(big.x + 0.5, big.y + 0.5);
  const cropW = 120;
  const cropH = 90;
  const zf = 8;
  const out = createCanvas(cropW * zf, cropH * zf);
  const octx = out.getContext('2d');
  octx.imageSmoothingEnabled = false;
  octx.drawImage(
    display,
    Math.round(cx - cropW / 2), Math.round(cy - cropH / 2), cropW, cropH,
    0, 0, cropW * zf, cropH * zf,
  );
  writeFileSync('/tmp/art-crop.png', await out.encode('png'));
  console.log('  → /tmp/art-crop.png  (城市特写，放大 4 倍)');

  // 诊断：统计画面里"肤色"（小人头部）和"亮米白"（墙体）的像素数，确认小人真的画出来了
  const d = display.getContext('2d').getImageData(0, 0, W, H).data;
  let skin = 0;
  let wall = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    if (Math.abs(r - 242) < 14 && Math.abs(g - 207) < 14 && Math.abs(b - 168) < 16) skin++;
    if (Math.abs(r - 242) < 10 && Math.abs(g - 233) < 10 && Math.abs(b - 210) < 12) wall++;
  }
  console.log(`  诊断：小人头部像素 ${skin} 个 | 墙体像素 ${wall} 个`);
}
