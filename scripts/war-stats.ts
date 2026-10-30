import { generateWorld } from '../src/core/world';
import { seedRaces } from '../src/sim/seed';
import { stepWorld } from '../src/sim/simulation';
import { updateFire, updatePlague } from '../src/sim/disasters';

const world = generateWorld({ size: 'medium', seed: Number(process.env.SEED ?? 20261030), landRatio: 0.45, fragmentation: 0.35 });
seedRaces(world, [0, 1, 2, 3]);

const TICKS = Number(process.env.TICKS ?? 12000);
let retreats = 0;
let rallies = 0;
let remarches = 0;
let clashTicks = 0;
let peakUnits = 0;
let peakArrows = 0;
let deaths = 0;
const seenState = new Map<number, string>();

for (let i = 0; i < TICKS; i++) {
  stepWorld(world);
  if (world.tick % 3 === 0) updateFire(world);
  if (world.tick % 12 === 0) updatePlague(world);
  peakUnits = Math.max(peakUnits, world.units.length);
  peakArrows = Math.max(peakArrows, world.arrows.filter((a) => a.active).length);
  for (const a of world.armies) {
    const prev = seenState.get(a.id);
    if (prev !== a.state) {
      if (a.state === 'retreat') retreats++;
      if (a.state === 'rally') rallies++;
      if (a.state === 'march' && prev === 'rally') remarches++;
      seenState.set(a.id, a.state);
    }
    if (a.state === 'clash') clashTicks++;
  }
  if (world.tick % 300 === 0) deaths = Math.max(deaths, world.corpses.length);
}

const live = world.settlements.filter((s) => s.alive && !s.ruin);
console.log(`tick=${world.tick} 城=${live.length} 国=${world.nations.filter((n) => n.alive).length}`);
console.log(`战役=${world.stats.battles} 撤退=${retreats} 重整=${rallies} 补员再战=${remarches}`);
console.log(`交战 tick 合计=${clashTicks} | 峰值单位=${peakUnits} 峰值箭=${peakArrows} 尸体峰值=${deaths}`);
console.log(`当前单位=${world.units.length} 军队=${world.armies.length}`);
