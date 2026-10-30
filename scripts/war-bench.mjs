/**
 * 性能实测：模拟步进 + 渲染帧，各跑一轮，报毫秒。
 */
import { createCanvas } from '@napi-rs/canvas';

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

const world = generateWorld({ size: 'medium', seed: 20261030, landRatio: 0.45, fragmentation: 0.35 });
seedRaces(world, [0, 1, 2, 3]);

// 跑到有很多单位、正在打仗的时候再测
for (let i = 0; i < 5000; i++) {
  stepWorld(world);
  if (world.tick % 3 === 0) updateFire(world);
  if (world.tick % 12 === 0) updatePlague(world);
}
console.log(`测温基线：单位=${world.units.length} 军队=${world.armies.length} 尸体=${world.corpses.length} 箭=${world.arrows.filter((a) => a.active).length}`);

const N = 600;
let t0 = performance.now();
for (let i = 0; i < N; i++) stepWorld(world);
let simMs = (performance.now() - t0) / N;

const display = createCanvas(1280, 860);
const r = new Renderer(display, world);
r.cam.zoom = 16;
r.cam.x = world.w / 2;
r.cam.y = world.h / 2;

// 预热
for (let i = 0; i < 20; i++) { r.markDirty(); r.camDirty = true; r.render(world); }

t0 = performance.now();
const M = 120;
for (let i = 0; i < M; i++) {
  // 每帧都重画地形（最坏情况：镜头一直在动）
  r.camDirty = true;
  r.render(world);
}
const renderMs = (performance.now() - t0) / M;

// 只重绘标注层（地形缓存命中，最常见的情况）
t0 = performance.now();
for (let i = 0; i < M; i++) r.render(world);
const renderCachedMs = (performance.now() - t0) / M;

t0 = performance.now();
for (let i = 0; i < 300; i++) stepWorld(world);
const sim2 = (performance.now() - t0) / 300;

// 分段计时：找出到底是谁在吃帧
const parts = [
  ['drawSettlements', () => r.drawSettlements(world)],
  ['armyBounds', () => r.armyBounds(world)],
  ['drawUnits', () => r.drawUnits(world)],
  ['drawCorpses', () => r.drawCorpses(world)],
  ['drawArrows', () => r.drawArrows(world)],
  ['drawSparks', () => r.drawSparks(world)],
  ['drawArmyGround', () => r.drawArmyGround(r.armyBounds(world))],
];
const rows = [];
for (const [name, fn] of parts) {
  for (let i = 0; i < 5; i++) fn();
  const t = performance.now();
  for (let i = 0; i < 60; i++) fn();
  rows.push(`${name}=${((performance.now() - t) / 60).toFixed(2)}ms`);
}
console.log('分段：' + rows.join('  '));

console.log(`模拟一 tick：${simMs.toFixed(3)} ms（战斗高峰期 ${sim2.toFixed(3)} ms）`);
console.log(`渲染一帧（全量重画）：${renderMs.toFixed(2)} ms | 仅标注层：${renderCachedMs.toFixed(2)} ms`);
console.log(`60fps 预算 16.7ms → 全量重画占用 ${((renderMs / 16.7) * 100).toFixed(0)}%`);
