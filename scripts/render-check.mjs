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

// 情绪系统诊断
const moodCount = { happy: 0, normal: 0, sad: 0, angry: 0, undef: 0 };
for (const s of live) moodCount[s.mood ?? 'undef']++;
const withStatus = live.filter((s) => s.status).length;
const foodKinds = {};
for (const s of live) foodKinds[s.foodKind] = (foodKinds[s.foodKind] ?? 0) + 1;
console.log('情绪分布', JSON.stringify(moodCount), '| 带可见状态', withStatus, '| 主食分布', JSON.stringify(foodKinds));
console.log('单位数', world.units.length, '| 职业分布', JSON.stringify(
  world.units.reduce((a, u) => { a[u.job] = (a[u.job] ?? 0) + 1; return a; }, {})
));
console.log('最爱食物匹配数', live.filter((s) => s.foodKind === s.favFood).length, '/', live.length);

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

// ---- 情绪图标专项验证：强制四种情绪各截一张 ----
async function moodShot(idx, mood, status, name) {
  const s = live[idx];
  if (!s) return;
  s.mood = mood;
  s.status = status;
  s.statusUntil = 1e9;
  if (mood === 'angry') s.damage = 0.85;
  r.cam.zoom = 24;
  r.cam.x = s.x;
  r.cam.y = s.y;
  r.markDirty();
  r.camDirty = true;
  r.render(world);
  writeFileSync(`/tmp/${name}.png`, await display.encode('png'));
  console.log(`  → /tmp/${name}.png  (${s.name} ${mood}/${status})`);
}
await moodShot(0, 'happy', 'sing', 'mood-happy');
await moodShot(1, 'sad', 'cry', 'mood-sad');
await moodShot(2, 'angry', 'tantrum', 'mood-angry');

// 行军特写：让一队兵从 A 城开往 B 城
{
  const { formArmy, updateArmies } = await import('../src/sim/units.ts');
  const sorted = live.sort((a, b) => b.pop - a.pop);
  const A = sorted[0], B = sorted[1];
  const m = formArmy(world, A.id, B.id, A.nation >= 0 ? A.nation : 0, A.race);
  if (m) {
    world.armies.push(m);
    for (let i = 0; i < 30; i++) { world.tick++; updateArmies(world); }
    const { loadImage } = await import('@napi-rs/canvas');
    const us = m.units.map((uid) => world.units.find((u) => u.id === uid)).filter(Boolean);
    const mx = us.length ? us.reduce((acc, u) => acc + u.x, 0) / us.length : A.x;
    const my = us.length ? us.reduce((acc, u) => acc + u.y, 0) / us.length : A.y;
    r.cam.zoom = 40;
    r.cam.x = mx;
    r.cam.y = my;
    r.markDirty(); r.camDirty = true; r.render(world);
    const f3 = await display.encode('png');
    const i3 = await loadImage(f3);
    const w3 = 480, h3 = 420;
    const c4 = createCanvas(w3, h3);
    const g4 = c4.getContext('2d');
    g4.imageSmoothingEnabled = false;
    g4.drawImage(i3, (1200 - w3) / 2, (800 - h3) / 2, w3, h3, 0, 0, w3, h3);
    writeFileSync('/tmp/march.png', c4.toBuffer('image/png'));
    console.log('  → /tmp/march.png  (' + A.name + ' → ' + B.name + ')');
  }
}

// 地形取样：自动找一块地形最丰富的位置
{
  let best = null, bestN = 0;
  for (let y = 10; y < world.h - 10; y += 4) {
    for (let x = 10; x < world.w - 10; x += 4) {
      const kinds = new Set();
      let water = 0;
      for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) {
        const tt = world.terrain[(y + dy) * world.w + (x + dx)];
        kinds.add(tt);
        if (tt === 0 || tt === 1) water++;
      }
      if (water < 20) continue;
      // 排除城内
      const inTown = world.settlements.some((sc) => sc.alive && Math.hypot(sc.x - x, sc.y - y) < 5);
      if (inTown) continue;
      if (kinds.size > bestN) { bestN = kinds.size; best = { x, y }; }
    }
  }
  if (best) {
    const { loadImage } = await import('@napi-rs/canvas');
    r.cam.zoom = 40; r.cam.x = best.x + 0.5; r.cam.y = best.y + 0.5;
    r.markDirty(); r.camDirty = true; r.render(world);
    const fullT = await display.encode('png');
    const imgT = await loadImage(fullT);
    const tw = 420, th = 420;
    const cT = createCanvas(tw, th);
    const gT = cT.getContext('2d');
    gT.imageSmoothingEnabled = false;
    gT.drawImage(imgT, (1200 - tw) / 2, (800 - th) / 2, tw, th, 0, 0, tw, th);
    writeFileSync('/tmp/terrain.png', cT.toBuffer('image/png'));
    console.log('  → /tmp/terrain.png  (地形种类 ' + bestN + ' 种)');
  }
}

// 四族城池特写
const { loadImage } = await import('@napi-rs/canvas');
const RACE_CN = ['人类', '精灵', '矮人', '兽人'];
for (let ri = 0; ri < 4; ri++) {
  const c = live.filter((x) => x.race === ri && x.walls > 0).sort((a, b) => b.pop - a.pop)[0]
    ?? live.filter((x) => x.race === ri).sort((a, b) => b.pop - a.pop)[0];
  if (!c) continue;
  r.cam.zoom = 48;
  r.cam.x = c.x + 0.5;
  r.cam.y = c.y + 0.5;
  r.markDirty();
  r.camDirty = true;
  r.render(world);
  const full = await display.encode('png');
  const img = await loadImage(full);
  const cw = 400, chh = 360;
  const c2 = createCanvas(cw, chh);
  const g = c2.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(img, (1200 - cw) / 2, (800 - chh) / 2 - 10, cw, chh, 0, 0, cw, chh);
  writeFileSync('/tmp/city-r' + ri + '.png', c2.toBuffer('image/png'));
  console.log('  → /tmp/city-r' + ri + '.png  (' + RACE_CN[ri] + ' ' + c.name + ')');
}

// 战斗特写：在城下打一场
{
  const { spawnBattle, updateUnits } = await import('../src/sim/units.ts');
  const city = live.sort((a, b) => b.pop - a.pop)[0];
  spawnBattle(world, city.id, 0, 1, true);
  for (let i = 0; i < 10; i++) { world.tick++; updateUnits(world); }
  r.cam.zoom = 22;
  r.cam.x = city.x + 0.5;
  r.cam.y = city.y + 0.5;
  r.markDirty(); r.camDirty = true; r.render(world);
  const full2 = await display.encode('png');
  const img2 = await loadImage(full2);
  const cw2 = 500, ch2 = 440;
  const c3 = createCanvas(cw2, ch2);
  const g3 = c3.getContext('2d');
  g3.imageSmoothingEnabled = false;
  g3.drawImage(img2, (1200 - cw2) / 2, (800 - ch2) / 2, cw2, ch2, 0, 0, cw2, ch2);
  writeFileSync('/tmp/battle.png', c3.toBuffer('image/png'));
  console.log('  → /tmp/battle.png  (' + city.name + ' 城下交战)');
}

// 单位特写：强制摆放 4 族 × 3 职业 = 12 个样本
const spot = live[0];
const demo = [];
const jobs = ['soldier', 'farmer', 'priest'];
for (let r = 0; r < 4; r++) {
  for (let j = 0; j < 3; j++) {
    demo.push({
      id: 90000 + r * 10 + j, race: r, job: jobs[j], nation: 0, home: spot.id,
      x: spot.x + 1.0 + j * 1.1, y: spot.y + 2.0 + r * 1.1,
      tx: 0, ty: 0, state: 'idle', timer: 0, anim: 0, hp: 100, dir: 2,
    });
  }
}
world.units = [...world.units, ...demo];
r.cam.zoom = 64; r.cam.x = spot.x + 2.7; r.cam.y = spot.y + 4.55;
r.markDirty(); r.camDirty = true; r.render(world);
{
  const full = await display.encode('png');
  const { loadImage } = await import('@napi-rs/canvas');
  const img = await loadImage(full);
  const cw = 460, chh = 480;
  const c2 = createCanvas(cw, chh);
  const cx2 = c2.getContext('2d');
  cx2.imageSmoothingEnabled = false;
  cx2.drawImage(img, (1200 - cw) / 2, (800 - chh) / 2, cw, chh, 0, 0, cw, chh);
  writeFileSync('/tmp/units-close.png', c2.toBuffer('image/png'));
}
console.log('  → /tmp/units-close.png  (4族×3职业 样本)');
world.units = world.units.filter((u) => u.id < 90000);

// 奇观特写：手动放一座已建成的世界之树
const ws = live[0];
world.wonders = [{ kind: 1, name: '月桂母树', nation: ws.nation, city: ws.id, progress: 1, built: true, started: 100, finished: 300, ruined: false }];
r.cam.zoom = 12; r.cam.x = ws.x + 0.5; r.cam.y = ws.y + 0.5;
r.markDirty(); r.camDirty = true; r.render(world);
writeFileSync('/tmp/wonder-tree.png', await display.encode('png'));
console.log('  → /tmp/wonder-tree.png');
world.wonders = [{ kind: 2, name: '深炉', nation: ws.nation, city: ws.id, progress: 1, built: true, started: 100, finished: 300, ruined: false }];
r.markDirty(); r.camDirty = true; r.render(world);
writeFileSync('/tmp/wonder-forge.png', await display.encode('png'));
console.log('  → /tmp/wonder-forge.png');
world.wonders = [{ kind: 0, name: '万卷之城', nation: ws.nation, city: ws.id, progress: 1, built: true, started: 100, finished: 300, ruined: false }];
r.markDirty(); r.camDirty = true; r.render(world);
writeFileSync('/tmp/wonder-lib.png', await display.encode('png'));
console.log('  → /tmp/wonder-lib.png');

// 巨兽特写：把一只巨兽挪到城边，确认画得出来
if (world.beasts.length) {
  const b0 = world.beasts[0];
  b0.x = Math.round(big.x + 4);
  b0.y = Math.round(big.y + 3);
  b0.alive = true;
  r.cam.zoom = 12;
  r.cam.x = big.x;
  r.cam.y = big.y;
  r.markDirty();
  r.camDirty = true;
  r.render(world);
  writeFileSync('/tmp/beast-close.png', await display.encode('png'));
  console.log('  → /tmp/beast-close.png  (' + b0.name + ' tier' + b0.tier + ')');
}
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
