/**
 * 战争系统诊断：军队有没有真的成形、队形有多紧、抵达后打没打。
 * 用法：npx esbuild scripts/armytest.ts --bundle --platform=node --format=esm --outfile=/tmp/armytest.mjs && node /tmp/armytest.mjs
 */
import { generateWorld } from '../src/core/world';
import { seedRaces } from '../src/sim/seed';
import { stepWorld } from '../src/sim/simulation';
import { updateFire, updatePlague } from '../src/sim/disasters';

const world = generateWorld({
  size: 'medium',
  seed: Number(process.env.SEED ?? 20261030),
  landRatio: 0.45,
  fragmentation: 0.35,
});
seedRaces(world, [0, 1, 2, 3]);

const TICKS = Number(process.env.TICKS ?? 6000);
let maxW = 0;
let maxH = 0;
let armySeen = 0;
let clashes = 0;
const seenArmies = new Set<number>();

for (let i = 0; i < TICKS; i++) {
  stepWorld(world);
  if (world.tick % 3 === 0) updateFire(world);
  if (world.tick % 12 === 0) updatePlague(world);

  for (const a of world.armies) {
    if (!seenArmies.has(a.id)) { seenArmies.add(a.id); armySeen++; }
    if (a.state === 'clash') clashes++;
    const us = world.units.filter((u) => a.units.includes(u.id));
    if (us.length < 2) continue;
    const xs = us.map((u) => u.x);
    const ys = us.map((u) => u.y);
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...ys) - Math.min(...ys);
    maxW = Math.max(maxW, w);
    maxH = Math.max(maxH, h);
    if (i % 400 === 0 && a.state === 'march') {
      console.log(
        `tick ${String(world.tick).padStart(5)} 军${a.id} ${a.state} n=${us.length} ` +
        `幅面 ${w.toFixed(2)}x${h.toFixed(2)} 阵心(${a.x.toFixed(1)},${a.y.toFixed(1)}) -> 城${a.to}`,
      );
    }
  }
}

const live = world.settlements.filter((s) => s.alive && !s.ruin).length;
console.log('---');
console.log(`总 tick ${world.tick} | 城 ${live} | 国 ${world.nations.filter((n) => n.alive).length}`);
console.log(`出现过 ${armySeen} 支军队 | 队形最大幅面 ${maxW.toFixed(2)} x ${maxH.toFixed(2)} 格`);
console.log(`军队单位数 ${world.units.filter((u) => u.army !== undefined).length} | 总单位 ${world.units.length}`);
console.log(`战斗统计 battles=${world.stats.battles} wars=${world.stats.warsDeclared}`);
