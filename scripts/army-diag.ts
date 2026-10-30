import { generateWorld } from '../src/core/world';
import { seedRaces } from '../src/sim/seed';
import { stepWorld } from '../src/sim/simulation';
import { formArmy, updateArmies } from '../src/sim/units';

const world = generateWorld({ size: 'medium', seed: 20261030, landRatio: 0.45, fragmentation: 0.35 });
seedRaces(world, [0, 1, 2, 3]);
for (let i = 0; i < 1500; i++) stepWorld(world);

const live = world.settlements.filter((s) => s.alive && !s.ruin).sort((a, b) => b.pop - a.pop);
const A = live[0];
const B = live.find((s) => s.nation !== A.nation) ?? live[1];
const a = formArmy(world, A.id, B.id, A.nation >= 0 ? A.nation : 0, A.race);
if (!a) throw new Error('formArmy 返回 null');
world.armies.push(a);
for (let i = 0; i < 30; i++) { world.tick++; updateArmies(world); }

console.log(`军 ${a.id} state=${a.state} 方向(${a.fx.toFixed(2)},${a.fy.toFixed(2)}) 阵心(${a.x.toFixed(2)},${a.y.toFixed(2)})`);
const us = world.units.filter((u) => a.units.includes(u.id));
for (const u of us) {
  console.log(
    `${(u.role ?? '?').padEnd(8)} ax=${(u.ax ?? 0).toFixed(2)} ay=${(u.ay ?? 0).toFixed(2)} ` +
    `dx=${(u.x - a.x).toFixed(2)} dy=${(u.y - a.y).toFixed(2)}`,
  );
}
const xs = us.map((u) => u.x);
const ys = us.map((u) => u.y);
console.log(`幅面 x=${(Math.max(...xs) - Math.min(...xs)).toFixed(2)} y=${(Math.max(...ys) - Math.min(...ys)).toFixed(2)}`);

for (const ar of world.armies) {
  const n = world.units.filter((u) => u.army === ar.id).length;
  console.log(`army ${ar.id} units[]=${ar.units.length} 实际匹配=${n} state=${ar.state} strength=${ar.strength}`);
}
console.log('有 army 字段的单位数', world.units.filter((u) => u.army !== undefined).length);
